import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeFiling, computeQuarterlyForm, computeAnnualForm, roundToWholePesoCents, resolveFormType } from "@/lib/tax/compute";
import { sumCwtThroughPeriod } from "@/lib/tax/cwt";
import { periodEndDate, priorPeriodsOf, cumulativeSalesQuartersThroughPeriod, ownSalesQuarterOf } from "@/lib/tax/periods";
import type { FilingComputationResult, Period, SalesQuarter } from "@/lib/tax/types";

/**
 * Assembles a FilingComputationInput from the database and runs it
 * through the pure lib/tax/compute.ts engine. This is the I/O boundary —
 * lib/tax/ itself never touches Prisma; this is where the plain objects
 * it needs get built.
 *
 * Brief #5d — branches by the filing's own formType: 1701Q (either
 * taxpayer type, any quarter) and 1701A (PURELY_SELF_EMPLOYED, annual) go
 * through the new form-line/whole-peso-rounded engine; MIXED_INCOME's
 * annual return (1701) stays on the old cumulative/centavo-exact engine
 * unchanged — no 1701 sheet is built.
 */
export async function assembleAndComputeFiling(
  clientId: string,
  taxableYear: number,
  period: Period,
): Promise<FilingComputationResult> {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  const formType = resolveFormType({ period, taxpayerType: client.taxpayerType });

  if (formType === "F1701Q") {
    return assembleQuarterlyForm(clientId, taxableYear, period as "Q1" | "Q2" | "Q3", client.taxpayerType);
  }
  if (formType === "F1701A") {
    return assembleAnnualForm(clientId, taxableYear);
  }
  return assembleLegacyAnnual(clientId, taxableYear, period, client.taxpayerType);
}

/** This quarter's own declared sales row (D26/D33) — never the cumulative sum. */
async function ownQuarterFigures(
  clientId: string,
  taxableYear: number,
  quarter: SalesQuarter,
): Promise<{ grossSalesCents: number; nonOperatingIncomeCents: number }> {
  const row = await prisma.quarterlySales.findUnique({
    where: { clientId_taxableYear_quarter: { clientId, taxableYear, quarter } },
  });
  return { grossSalesCents: row?.grossSalesCents ?? 0, nonOperatingIncomeCents: row?.nonOperatingIncomeCents ?? 0 };
}

async function priorPeriodPaymentsCentsThrough(clientId: string, taxableYear: number, period: Period): Promise<number> {
  const priorPeriods = priorPeriodsOf(period);
  if (priorPeriods.length === 0) return 0;
  const priorFilings = await prisma.filing.findMany({
    where: { clientId, taxableYear, period: { in: [...priorPeriods] } },
  });
  return priorFilings.reduce((sum, f) => sum + (f.amountPaidCents ?? 0), 0);
}

async function priorYearExcessCreditCentsFor(clientId: string, taxableYear: number): Promise<number> {
  const clientTaxYear = await prisma.clientTaxYear.findUnique({
    where: { clientId_taxableYear: { clientId, taxableYear } },
  });
  return clientTaxYear?.priorYearExcessCreditCents ?? 0;
}

/**
 * Brief #5e §8 — items 55/57 (prior-year excess credit) and 61/63 (other
 * tax credits/payments) are both single client-year figures stored on
 * ClientTaxYear, entered once and appearing in full on every return of
 * that year (same rule as the existing prior-year credit, locked rule #1 /
 * SPEC §16 item 7 — this file already never lowers or "uses up" that
 * figure across periods, since every call re-reads the same stored value).
 */
async function yearLevelCreditsFor(
  clientId: string,
  taxableYear: number,
): Promise<{ priorYearExcessCreditCents: number; otherCreditsCents: number }> {
  const clientTaxYear = await prisma.clientTaxYear.findUnique({
    where: { clientId_taxableYear: { clientId, taxableYear } },
  });
  return {
    priorYearExcessCreditCents: clientTaxYear?.priorYearExcessCreditCents ?? 0,
    otherCreditsCents: clientTaxYear?.otherCreditsCents ?? 0,
  };
}

async function certificatesForCwt(clientId: string, taxableYear: number) {
  const certificates = await prisma.form2307.findMany({
    where: { clientId, taxableYear, deletedAt: null },
    include: { claimedOnFiling: { select: { period: true } } },
  });
  return certificates.map((c) => ({
    id: c.id,
    taxWithheldCents: c.taxWithheldCents,
    status: c.status,
    claimedOnFilingPeriod: c.claimedOnFiling?.period ?? null,
  }));
}

/**
 * 1701Q assembly (brief #5d §2). Item 50 (the previous quarter's own item
 * 51) is built by summing each strictly-prior quarter's own item 49,
 * rounded separately — never by rounding a raw multi-quarter total — so
 * item 51 always equals the sum of every quarter's own separately-rounded
 * item 49 through this one.
 */
async function assembleQuarterlyForm(
  clientId: string,
  taxableYear: number,
  period: "Q1" | "Q2" | "Q3",
  taxpayerType: "PURELY_SELF_EMPLOYED" | "MIXED_INCOME",
): Promise<FilingComputationResult> {
  const ruleSet = await prisma.taxRuleSet.findUniqueOrThrow({ where: { taxableYear } });
  const priorPeriods = priorPeriodsOf(period) as readonly ("Q1" | "Q2")[];

  let previousCumulativeTaxableIncomeCents = 0;
  for (const priorPeriod of priorPeriods) {
    const figures = await ownQuarterFigures(clientId, taxableYear, ownSalesQuarterOf(priorPeriod));
    previousCumulativeTaxableIncomeCents += roundToWholePesoCents(
      figures.grossSalesCents + figures.nonOperatingIncomeCents,
    );
  }

  const ownFigures = await ownQuarterFigures(clientId, taxableYear, ownSalesQuarterOf(period));

  const certificates = await certificatesForCwt(clientId, taxableYear);
  const lastPriorPeriod = priorPeriods[priorPeriods.length - 1];
  const cwtPriorQuartersCents = lastPriorPeriod ? sumCwtThroughPeriod(certificates, lastPriorPeriod) : 0;
  const cwtThisQuarterCents = sumCwtThroughPeriod(certificates, period) - cwtPriorQuartersCents;

  const priorPeriodPaymentsCents = await priorPeriodPaymentsCentsThrough(clientId, taxableYear, period);
  const { priorYearExcessCreditCents, otherCreditsCents } = await yearLevelCreditsFor(clientId, taxableYear);

  return computeQuarterlyForm({
    taxableYear,
    period,
    taxpayerType,
    ruleSet: { incomeTaxRateBps: ruleSet.incomeTaxRateBps, allowableDeductionCents: ruleSet.allowableDeductionCents },
    ownGrossSalesCents: ownFigures.grossSalesCents,
    ownNonOperatingCents: ownFigures.nonOperatingIncomeCents,
    previousCumulativeTaxableIncomeCents,
    priorYearExcessCreditCents,
    priorPeriodPaymentsCents,
    cwtPriorQuartersCents,
    cwtThisQuarterCents,
    otherCreditsCents,
  });
}

/**
 * 1701A assembly (brief #5d §3), PURELY_SELF_EMPLOYED only. Item 47 is the
 * rounded full-year gross, not the sum of the quarters' own rounded item
 * 49s — the form does not chain quarterly figures.
 */
async function assembleAnnualForm(clientId: string, taxableYear: number): Promise<FilingComputationResult> {
  const ruleSet = await prisma.taxRuleSet.findUniqueOrThrow({ where: { taxableYear } });

  const salesQuarters = cumulativeSalesQuartersThroughPeriod("ANNUAL");
  const salesRows = await prisma.quarterlySales.findMany({
    where: { clientId, taxableYear, quarter: { in: [...salesQuarters] } },
  });
  const fullYearGrossSalesCents = salesRows.reduce((sum, r) => sum + r.grossSalesCents, 0);
  const fullYearNonOperatingCents = salesRows.reduce((sum, r) => sum + r.nonOperatingIncomeCents, 0);

  const certificates = await certificatesForCwt(clientId, taxableYear);
  const cwtQ1ToQ3Cents = sumCwtThroughPeriod(certificates, "Q3");
  const cwtQ4Cents = sumCwtThroughPeriod(certificates, "ANNUAL") - cwtQ1ToQ3Cents;

  const priorPeriodPaymentsQ1ToQ3Cents = await priorPeriodPaymentsCentsThrough(clientId, taxableYear, "ANNUAL");
  const { priorYearExcessCreditCents, otherCreditsCents } = await yearLevelCreditsFor(clientId, taxableYear);

  return computeAnnualForm({
    taxableYear,
    ruleSet: { incomeTaxRateBps: ruleSet.incomeTaxRateBps, allowableDeductionCents: ruleSet.allowableDeductionCents },
    fullYearGrossSalesCents,
    fullYearNonOperatingCents,
    priorYearExcessCreditCents,
    priorPeriodPaymentsQ1ToQ3Cents,
    cwtQ1ToQ3Cents,
    cwtQ4Cents,
    otherCreditsCents,
  });
}

/**
 * The OLD cumulative/centavo-exact assembly, kept for MIXED_INCOME's
 * annual return (Form 1701) only — no 1701 sheet is built (brief #5d).
 * Identical to this function's pre-#5d body.
 */
async function assembleLegacyAnnual(
  clientId: string,
  taxableYear: number,
  period: Period,
  taxpayerType: "PURELY_SELF_EMPLOYED" | "MIXED_INCOME",
): Promise<FilingComputationResult> {
  const ruleSet = await prisma.taxRuleSet.findUniqueOrThrow({ where: { taxableYear } });

  const salesQuarters = cumulativeSalesQuartersThroughPeriod(period);
  const salesRows = await prisma.quarterlySales.findMany({
    where: { clientId, taxableYear, quarter: { in: [...salesQuarters] } },
  });
  const cumulativeGrossSalesCents = salesRows.reduce((sum, r) => sum + r.grossSalesCents, 0);
  const cumulativeNonOperatingCents = salesRows.reduce((sum, r) => sum + r.nonOperatingIncomeCents, 0);

  const certificates = await certificatesForCwt(clientId, taxableYear);
  const cumulativeCwtCents = sumCwtThroughPeriod(certificates, period);

  const priorPeriodPaymentsCents = await priorPeriodPaymentsCentsThrough(clientId, taxableYear, period);
  const priorYearExcessCreditCents = await priorYearExcessCreditCentsFor(clientId, taxableYear);

  return computeFiling({
    taxableYear,
    period,
    taxpayerType,
    ruleSet: { incomeTaxRateBps: ruleSet.incomeTaxRateBps, allowableDeductionCents: ruleSet.allowableDeductionCents },
    cumulativeGrossSalesCents,
    cumulativeNonOperatingCents,
    cumulativeCwtCents,
    priorPeriodPaymentsCents,
    priorYearExcessCreditCents,
  });
}

/**
 * Whether this filing's OWN quarter has a declared QuarterlySales row at
 * all (rework brief §3.1). Distinct from the cumulative total, which sums
 * every quarter through this period and so can be misleadingly nonzero
 * even when the current quarter itself is still blank. A filing whose own
 * quarter has nothing entered renders "no sales recorded" instead of a
 * computed ₱0.00 that reads as a real answer.
 */
export async function hasSalesRecordedForPeriod(
  clientId: string,
  taxableYear: number,
  period: Period,
): Promise<boolean> {
  const row = await prisma.quarterlySales.findUnique({
    where: {
      clientId_taxableYear_quarter: { clientId, taxableYear, quarter: ownSalesQuarterOf(period) },
    },
  });
  return row != null;
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
 *
 * Brief #5d — taxPayableCents/overpaymentCents are common to every
 * FilingComputationResult shape (legacy, 1701Q, 1701A), so this delta
 * check is unaffected by which shape a given filing's snapshot uses.
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
