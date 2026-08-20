import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeFiling } from "@/lib/tax/compute";
import { sumCwtThroughPeriod, resolveCertificateCutoffDate } from "@/lib/tax/cwt";
import { periodEndDate, priorPeriodsOf } from "@/lib/tax/periods";
import { nowManila } from "@/lib/dates";
import type { FilingComputationResult, Period } from "@/lib/tax/types";

/**
 * Assembles a FilingComputationInput from the database and runs it
 * through the pure lib/tax/compute.ts engine. This is the I/O boundary —
 * lib/tax/ itself never touches Prisma; this is where the plain objects
 * it needs get built.
 */
export async function assembleAndComputeFiling(
  clientId: string,
  taxableYear: number,
  period: Period,
): Promise<FilingComputationResult> {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  const ruleSet = await prisma.taxRuleSet.findUniqueOrThrow({ where: { taxableYear } });
  const clientTaxYear = await prisma.clientTaxYear.findUnique({
    where: { clientId_taxableYear: { clientId, taxableYear } },
  });
  const filing = await prisma.filing.findUnique({
    where: { clientId_taxableYear_period: { clientId, taxableYear, period } },
  });

  // Transactions belong to their actual period, so gross sales stays keyed
  // to the period's own end date. The CWT cutoff is a separate concern
  // (SPEC.md 3.5) — see resolveCertificateCutoffDate.
  const periodCutoff = periodEndDate(taxableYear, period);

  const transactions = await prisma.salesTransaction.findMany({
    where: { clientId, taxableYear, transactionDate: { lte: periodCutoff }, deletedAt: null },
  });
  const cumulativeGrossSalesCents = transactions
    .filter((t) => t.incomeType === "OPERATING")
    .reduce((sum, t) => sum + t.grossAmountCents, 0);
  const cumulativeNonOperatingCents = transactions
    .filter((t) => t.incomeType === "NON_OPERATING")
    .reduce((sum, t) => sum + t.grossAmountCents, 0);

  const certificateCutoff = resolveCertificateCutoffDate({
    filedAt: filing?.filedAt ?? null,
    manualOverride: filing?.certificateCutoffOverride ?? null,
    today: nowManila().startOf("day").toJSDate(),
  });

  const certificates = await prisma.form2307.findMany({
    where: { clientId, taxableYear, deletedAt: null },
  });
  const cumulativeCwtCents = sumCwtThroughPeriod(
    certificates.map((c) => ({
      id: c.id,
      taxWithheldCents: c.taxWithheldCents,
      dateReceived: c.dateReceived,
      status: c.status,
      claimedOnFilingId: c.claimedOnFilingId,
    })),
    certificateCutoff.date,
  );

  const priorPeriods = priorPeriodsOf(period);
  const priorFilings =
    priorPeriods.length > 0
      ? await prisma.filing.findMany({
          where: { clientId, taxableYear, period: { in: [...priorPeriods] } },
        })
      : [];
  const priorPeriodPaymentsCents = priorFilings.reduce((sum, f) => sum + (f.amountPaidCents ?? 0), 0);

  const priorYearExcessCreditCents = clientTaxYear?.priorYearExcessCreditCents ?? 0;

  return computeFiling({
    taxableYear,
    period,
    taxpayerType: client.taxpayerType,
    ruleSet: {
      incomeTaxRateBps: ruleSet.incomeTaxRateBps,
      allowableDeductionCents: ruleSet.allowableDeductionCents,
    },
    cumulativeGrossSalesCents,
    cumulativeNonOperatingCents,
    cumulativeCwtCents,
    priorPeriodPaymentsCents,
    priorYearExcessCreditCents,
    certificateCutoffDate: certificateCutoff.date,
    certificateCutoffSource: certificateCutoff.source,
  });
}

/**
 * The integrity rule (SPEC.md 5): a frozen Filing's computationSnapshot
 * is never silently rewritten. When a transaction dated on or before a
 * frozen filing's period end is created or edited, this raises an
 * AmendmentAlert on that filing showing the delta between the frozen
 * snapshot and a live recomputation — and does NOT touch
 * computationSnapshot itself. The bookkeeper decides whether to amend.
 *
 * `affectedDate` should be the EARLIEST of a transaction's old/new dates
 * when editing (a lower bound is always safe here: periodEndDate only
 * grows Q1 -> Q2 -> Q3 -> ANNUAL, so using the earliest date means every
 * filing that could possibly be impacted gets checked; one whose figures
 * turn out unchanged just produces a zero delta and no alert).
 */
export async function checkAndRecordAmendments(
  clientId: string,
  taxableYear: number,
  affectedDate: Date,
  reason: string,
): Promise<number> {
  const frozenFilings = await prisma.filing.findMany({
    where: {
      clientId,
      taxableYear,
      filedAt: { not: null },
      computationSnapshot: { not: Prisma.DbNull },
      deletedAt: null,
    },
  });

  let alertsCreated = 0;

  for (const filing of frozenFilings) {
    const periodEnd = periodEndDate(taxableYear, filing.period);
    if (affectedDate.getTime() > periodEnd.getTime()) continue; // outside this filing's cumulative window

    const live = await assembleAndComputeFiling(clientId, taxableYear, filing.period);
    const frozen = JSON.parse(filing.computationSnapshot as string) as FilingComputationResult;

    const frozenNetCents = frozen.taxPayableCents - frozen.overpaymentCents;
    const liveNetCents = live.taxPayableCents - live.overpaymentCents;
    const deltaCents = liveNetCents - frozenNetCents;
    if (deltaCents === 0) continue;

    await prisma.amendmentAlert.create({
      data: {
        filingId: filing.id,
        reason,
        snapshotJson: filing.computationSnapshot as string,
        recomputedJson: JSON.stringify(live),
        deltaCents,
      },
    });
    alertsCreated += 1;
  }

  return alertsCreated;
}
