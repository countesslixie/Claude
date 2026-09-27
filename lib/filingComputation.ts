import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeFiling, computeQuarterlyForm, computeAnnualForm, roundToWholePesoCents, resolveFormType } from "@/lib/tax/compute";
import { sumCwtThroughPeriod } from "@/lib/tax/cwt";
import {
  ALL_PERIODS,
  periodEndDate,
  priorPeriodsOf,
  cumulativeSalesQuartersThroughPeriod,
  ownSalesQuarterOf,
  outsideSalesQuartersFor,
  outsidePeriodsFor,
} from "@/lib/tax/periods";
import { getStartingFigures } from "@/lib/startingFigures";
import type { FilingComputationResult, LatestOutsideReturn, Period, SalesQuarter } from "@/lib/tax/types";

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

/**
 * This quarter's own declared sales row (D26/D33) — never the cumulative
 * sum. Brief #5f §8 — a quarter covered by starting figures ("filed
 * outside the app") always contributes zero here, even if a stray
 * QuarterlySales row exists for it (e.g. leftover seed data): the
 * starting figures replace it, never add to it (lib/actions/
 * quarterlySales.ts refuses to let one be entered in the first place, but
 * this is the defensive backstop the brief asks for).
 */
async function ownQuarterFigures(
  clientId: string,
  taxableYear: number,
  quarter: SalesQuarter,
  outsideSalesQuarters: ReadonlySet<SalesQuarter>,
): Promise<{ grossSalesCents: number; nonOperatingIncomeCents: number }> {
  if (outsideSalesQuarters.has(quarter)) return { grossSalesCents: 0, nonOperatingIncomeCents: 0 };
  const row = await prisma.quarterlySales.findUnique({
    where: { clientId_taxableYear_quarter: { clientId, taxableYear, quarter } },
  });
  return { grossSalesCents: row?.grossSalesCents ?? 0, nonOperatingIncomeCents: row?.nonOperatingIncomeCents ?? 0 };
}

async function priorPeriodPaymentsCentsThrough(
  clientId: string,
  taxableYear: number,
  period: Period,
  outsidePeriods: ReadonlySet<Period> = new Set(),
): Promise<number> {
  const priorPeriods = priorPeriodsOf(period).filter((p) => !outsidePeriods.has(p));
  if (priorPeriods.length === 0) return 0;
  const priorFilings = await prisma.filing.findMany({
    where: { clientId, taxableYear, period: { in: [...priorPeriods] }, filedOutsideApp: false },
  });
  return priorFilings.reduce((sum, f) => sum + (f.amountPaidCents ?? 0), 0);
}

async function priorYearExcessCreditCentsFor(clientId: string, taxableYear: number): Promise<number> {
  const clientTaxYear = await prisma.clientTaxYear.findUnique({
    where: { clientId_taxableYear: { clientId, taxableYear } },
  });
  return clientTaxYear?.priorYearExcessCreditCents ?? 0;
}

async function certificatesForCwt(clientId: string, taxableYear: number, outsidePeriods: ReadonlySet<Period> = new Set()) {
  const certificates = await prisma.form2307.findMany({
    where: { clientId, taxableYear, deletedAt: null },
    include: { claimedOnFiling: { select: { period: true } } },
  });
  return certificates
    .map((c) => ({
      id: c.id,
      taxWithheldCents: c.taxWithheldCents,
      status: c.status,
      claimedOnFilingPeriod: c.claimedOnFiling?.period ?? null,
    }))
    // Brief #5f §8 — defensive: a certificate can never actually be
    // entered under an outside period's step 2 (no such filing exists to
    // enter it under), but this guards against a stray row all the same.
    .filter((c) => c.claimedOnFilingPeriod == null || !outsidePeriods.has(c.claimedOnFilingPeriod));
}

/**
 * Brief #5f §8 — the starting-figures "base" a mid-year client brings
 * into the app, or all-zero for a client with no starting figures (or
 * whose latestOutsideReturn is NONE — a from-Q1 client). Item 55 (prior-
 * year excess credit) is NOT part of this: it's read separately, straight
 * off ClientTaxYear, since it's entered via starting figures but stored
 * there permanently regardless of latestOutsideReturn (brief #5f §4).
 */
interface StartingFiguresBase {
  outsideSalesQuarters: ReadonlySet<SalesQuarter>;
  outsidePeriods: ReadonlySet<Period>;
  cumulativeIncomeCents: number;
  nonOperatingIncomeCents: number;
  /** Payments for previous quarters + amount paid for the latest outside return, combined (item 56's starting half). */
  paymentsBaseCents: number;
  /** Withholding for previous quarters + withholding for the latest outside return's own quarter, combined (item 57's starting half). */
  cwtBaseCents: number;
}

async function startingFiguresBaseFor(clientId: string, taxableYear: number): Promise<StartingFiguresBase> {
  const startingFigures = await getStartingFigures(clientId, taxableYear);
  const latest: LatestOutsideReturn = startingFigures?.latestOutsideReturn ?? "NONE";
  const hasOutsidePeriods = startingFigures != null && latest !== "NONE";

  return {
    outsideSalesQuarters: new Set(outsideSalesQuartersFor(latest)),
    outsidePeriods: new Set(outsidePeriodsFor(latest)),
    cumulativeIncomeCents: hasOutsidePeriods ? startingFigures!.cumulativeIncomeCents : 0,
    nonOperatingIncomeCents: hasOutsidePeriods ? startingFigures!.nonOperatingIncomeCents : 0,
    paymentsBaseCents: hasOutsidePeriods
      ? startingFigures!.paymentsPreviousQuartersCents + startingFigures!.amountPaidThisReturnCents
      : 0,
    cwtBaseCents: hasOutsidePeriods
      ? startingFigures!.withholdingPreviousQuartersCents + startingFigures!.withholdingThisQuarterCents
      : 0,
  };
}

export interface OtherCreditsInheritance {
  /** Item 61 (1701Q) / item 63 (1701A) — the value this filing's computation actually uses. */
  effectiveCents: number;
  effectiveDescription: string;
  /** False when this filing has its own saved value (Filing.otherCreditsCents is not null). */
  isInherited: boolean;
  /** "Q2", "starting figures", or null (nothing to inherit — this is the year's own first return with no starting figures). */
  sourceLabel: string | null;
}

/**
 * Brief #5f §3 — item 61/63's inheritance chain. Until a filing's own
 * item 61 is saved (Filing.otherCreditsCents is null), it uses the item
 * 61 of the return before it in the same taxable year that DOES exist —
 * walking forward from the starting-figures baseline (or 0, if none)
 * through every existing Filing in period order, each one either
 * supplying its own saved value (breaking the chain from there on) or
 * passing the running value through unchanged. Outside periods carry no
 * Filing row (or, in the rare case one predates starting figures being
 * entered, are excluded via filedOutsideApp) and so are simply skipped —
 * they never break or restart the chain.
 */
export async function effectiveOtherCreditsFor(
  clientId: string,
  taxableYear: number,
  period: Period,
): Promise<OtherCreditsInheritance> {
  const startingFigures = await getStartingFigures(clientId, taxableYear);
  const hasStartingOtherCredits = startingFigures != null && startingFigures.latestOutsideReturn !== "NONE";

  const filings = await prisma.filing.findMany({
    where: { clientId, taxableYear, deletedAt: null, filedOutsideApp: false },
    select: { period: true, otherCreditsCents: true, otherCreditsDescription: true },
  });
  const orderedFilings = ALL_PERIODS.map((p) => filings.find((f) => f.period === p)).filter(
    (f): f is NonNullable<typeof f> => f != null,
  );

  let runningCents = hasStartingOtherCredits ? startingFigures!.otherCreditsCents : 0;
  let runningDescription = hasStartingOtherCredits ? (startingFigures!.otherCreditsDescription ?? "") : "";
  let runningSourceLabel: string | null = hasStartingOtherCredits ? "starting figures" : null;

  for (const f of orderedFilings) {
    if (f.period === period) {
      if (f.otherCreditsCents != null) {
        return {
          effectiveCents: f.otherCreditsCents,
          effectiveDescription: f.otherCreditsDescription ?? "",
          isInherited: false,
          sourceLabel: null,
        };
      }
      return {
        effectiveCents: runningCents,
        effectiveDescription: runningDescription,
        isInherited: true,
        sourceLabel: runningSourceLabel,
      };
    }
    if (f.otherCreditsCents != null) {
      runningCents = f.otherCreditsCents;
      runningDescription = f.otherCreditsDescription ?? "";
      runningSourceLabel = f.period;
    }
  }

  // This filing's own row wasn't in the list yet (e.g. called before the
  // Filing exists) — fall back to the running baseline.
  return {
    effectiveCents: runningCents,
    effectiveDescription: runningDescription,
    isInherited: true,
    sourceLabel: runningSourceLabel,
  };
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
  const base = await startingFiguresBaseFor(clientId, taxableYear);
  const priorPeriods = (priorPeriodsOf(period) as readonly ("Q1" | "Q2")[]).filter((p) => !base.outsidePeriods.has(p));

  // Brief #5f §8 — item 50 starts from the starting-figures baseline
  // (already "cumulative through the last outside quarter") instead of 0,
  // then adds every strictly-prior IN-APP quarter's own rounded item 49 on
  // top, exactly as before. Outside quarters are skipped here since
  // they're already folded into the baseline.
  let previousCumulativeTaxableIncomeCents = base.cumulativeIncomeCents;
  for (const priorPeriod of priorPeriods) {
    const figures = await ownQuarterFigures(clientId, taxableYear, ownSalesQuarterOf(priorPeriod), base.outsideSalesQuarters);
    previousCumulativeTaxableIncomeCents += roundToWholePesoCents(
      figures.grossSalesCents + figures.nonOperatingIncomeCents,
    );
  }

  const ownFigures = await ownQuarterFigures(clientId, taxableYear, ownSalesQuarterOf(period), base.outsideSalesQuarters);

  const certificates = await certificatesForCwt(clientId, taxableYear, base.outsidePeriods);
  const lastPriorPeriod = priorPeriods[priorPeriods.length - 1];
  // Item 57 — every certificate withheld before this filing's own quarter:
  // the starting-figures baseline (both of its lines, per §8's table) plus
  // whatever's been claimed on in-app prior filings.
  const cwtPriorQuartersCents = base.cwtBaseCents + (lastPriorPeriod ? sumCwtThroughPeriod(certificates, lastPriorPeriod) : 0);
  // Item 58 — this filing's own certificates only, never the starting base.
  const cwtThisQuarterCents =
    sumCwtThroughPeriod(certificates, period) - (lastPriorPeriod ? sumCwtThroughPeriod(certificates, lastPriorPeriod) : 0);

  const priorPeriodPaymentsCents =
    base.paymentsBaseCents + (await priorPeriodPaymentsCentsThrough(clientId, taxableYear, period, base.outsidePeriods));
  const priorYearExcessCreditCents = await priorYearExcessCreditCentsFor(clientId, taxableYear);
  const { effectiveCents: otherCreditsCents } = await effectiveOtherCreditsFor(clientId, taxableYear, period);

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
  const base = await startingFiguresBaseFor(clientId, taxableYear);

  // Brief #5f §8 — item 47/52: the starting gross-sales-only portion
  // (cumulative income minus its own non-operating slice) plus the
  // IN-APP quarters' own declared sales; outside quarters are excluded
  // even if a stray row exists for one (the starting figures replace it).
  const salesQuarters = cumulativeSalesQuartersThroughPeriod("ANNUAL").filter((q) => !base.outsideSalesQuarters.has(q));
  const salesRows = await prisma.quarterlySales.findMany({
    where: { clientId, taxableYear, quarter: { in: [...salesQuarters] } },
  });
  const startingGrossOnlyCents = base.cumulativeIncomeCents - base.nonOperatingIncomeCents;
  const fullYearGrossSalesCents = startingGrossOnlyCents + salesRows.reduce((sum, r) => sum + r.grossSalesCents, 0);
  const fullYearNonOperatingCents = base.nonOperatingIncomeCents + salesRows.reduce((sum, r) => sum + r.nonOperatingIncomeCents, 0);

  const certificates = await certificatesForCwt(clientId, taxableYear, base.outsidePeriods);
  // Item 59 — starting withholding (both lines) plus certificates claimed
  // on in-app Q1-Q3 returns; item 60 (the Annual's own certificates) is
  // unaffected by starting figures.
  const cwtQ1ToQ3Cents = base.cwtBaseCents + sumCwtThroughPeriod(certificates, "Q3");
  const cwtQ4Cents = sumCwtThroughPeriod(certificates, "ANNUAL") - sumCwtThroughPeriod(certificates, "Q3");

  const priorPeriodPaymentsQ1ToQ3Cents =
    base.paymentsBaseCents + (await priorPeriodPaymentsCentsThrough(clientId, taxableYear, "ANNUAL", base.outsidePeriods));
  const priorYearExcessCreditCents = await priorYearExcessCreditCentsFor(clientId, taxableYear);
  const { effectiveCents: otherCreditsCents } = await effectiveOtherCreditsFor(clientId, taxableYear, "ANNUAL");

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
