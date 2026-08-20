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
