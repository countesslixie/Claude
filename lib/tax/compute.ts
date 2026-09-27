import Decimal from "decimal.js";
import type {
  LegacyFilingComputationInput,
  LegacyFilingComputationResult,
  QuarterlyFormComputationInput,
  QuarterlyFormComputationResult,
  AnnualFormComputationInput,
  AnnualFormComputationResult,
  FilingComputationResult,
  FormType,
  BreakdownLine,
} from "./types";

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

/**
 * Rounds integer centavos to the nearest whole peso, half-up (brief #5d
 * §1) — the result is always a multiple of 100, still stored as integer
 * centavos (locked rule #4: money is integer centavos, no floats
 * anywhere). Used only by the two BIR-form-shaped computations below; the
 * old cumulative computeFiling (MIXED_INCOME's annual 1701, and the VAT
 * threshold monitor / annual reconciliation elsewhere) stays centavo-exact
 * and never calls this.
 */
export function roundToWholePesoCents(cents: number): number {
  return new Decimal(cents).dividedBy(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).times(100).toNumber();
}

/**
 * SPEC.md section 3.2 — the 8% income tax computation, cumulative
 * year-to-date for every period. Pure function: plain object in, plain
 * object out, zero I/O, no Prisma imports (SPEC.md section 4, 6).
 *
 * Brief #5d — kept exactly as it was, centavo-exact and cumulative, for
 * MIXED_INCOME's annual return (Form 1701) only: no 1701 sheet is built,
 * so that path never adopted the form-line/whole-peso rounding the two
 * new functions below implement for 1701Q/1701A. Every quarterly filing
 * (either taxpayer type) and every PURELY_SELF_EMPLOYED annual filing now
 * goes through computeQuarterlyForm/computeAnnualForm instead.
 *
 * The caller is responsible for assembling the cumulative input figures
 * (see lib/tax/cwt.ts for the CWT side of that assembly) — this function
 * does not know about individual transactions or certificates, only the
 * cumulative totals for the period being computed.
 */
export function computeFiling(input: LegacyFilingComputationInput): LegacyFilingComputationResult {
  const cumulativeGrossCents = input.cumulativeGrossSalesCents + input.cumulativeNonOperatingCents;

  // ₱250,000 deduction, purely self-employed only, applied in full every
  // period (never prorated per quarter — SPEC.md 16 item 2). Mixed income
  // earners get none, since it's already embedded in the graduated table
  // applied to their compensation (SPEC.md 3.2).
  const allowableDeductionCents =
    input.taxpayerType === "PURELY_SELF_EMPLOYED" ? input.ruleSet.allowableDeductionCents : 0;

  const taxableBaseCents = Math.max(0, cumulativeGrossCents - allowableDeductionCents);

  const incomeTaxDueCents = new Decimal(taxableBaseCents)
    .times(input.ruleSet.incomeTaxRateBps)
    .dividedBy(10000)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();

  const rawPayableCents =
    incomeTaxDueCents -
    input.cumulativeCwtCents -
    input.priorPeriodPaymentsCents -
    input.priorYearExcessCreditCents;

  // Negative payable renders as an overpayment, never a negative amount
  // due (SPEC.md 16 item 4). The cumulative mechanism absorbs an earlier
  // period's overpayment automatically — no separate carry-forward term.
  const taxPayableCents = Math.max(0, rawPayableCents);
  const overpaymentCents = rawPayableCents < 0 ? -rawPayableCents : 0;

  const formType = resolveFormType(input);

  const breakdown: LegacyFilingComputationResult["breakdown"] = [
    {
      label: "Cumulative gross sales/receipts",
      amountCents: input.cumulativeGrossSalesCents,
      sourceNote: `YTD operating income, Jan 1 through end of ${input.period}`,
    },
    {
      label: "Cumulative non-operating income",
      amountCents: input.cumulativeNonOperatingCents,
      sourceNote: `YTD non-operating income, Jan 1 through end of ${input.period}`,
    },
    {
      label: "Cumulative gross",
      amountCents: cumulativeGrossCents,
      sourceNote: "Sum of the above",
    },
    {
      label: "Less: allowable deduction",
      amountCents: -allowableDeductionCents,
      sourceNote:
        input.taxpayerType === "PURELY_SELF_EMPLOYED"
          ? "PHP 250,000, applied in full from Q1 (not prorated)"
          : "None — mixed income earner (SPEC.md 3.2)",
    },
    {
      label: "Taxable base",
      amountCents: taxableBaseCents,
      sourceNote: "MAX(0, cumulative gross - allowable deduction)",
    },
    {
      label: "Income tax due",
      amountCents: incomeTaxDueCents,
      sourceNote: `${(input.ruleSet.incomeTaxRateBps / 100).toFixed(2)}% of taxable base, half-up rounded to the centavo`,
    },
    {
      label: "Less: cumulative creditable withholding tax",
      amountCents: -input.cumulativeCwtCents,
      sourceNote: "Sum of Form 2307 certificates, status Recorded/Claimed, year-to-date",
    },
    {
      label: "Less: prior-period payments",
      amountCents: -input.priorPeriodPaymentsCents,
      sourceNote: "Amounts actually remitted on earlier returns this taxable year",
    },
    {
      label: "Less: prior-year excess credit",
      amountCents: -input.priorYearExcessCreditCents,
      sourceNote: "Carried over from the prior taxable year's election, if any",
    },
    {
      label: overpaymentCents > 0 ? "Overpayment" : "Tax payable",
      amountCents: overpaymentCents > 0 ? overpaymentCents : taxPayableCents,
      sourceNote: "This is a preparation aid. The filed return and BIR's own assessment govern (SPEC.md 17.6).",
    },
  ];

  return {
    formType,
    cumulativeGrossSalesCents: input.cumulativeGrossSalesCents,
    cumulativeNonOperatingCents: input.cumulativeNonOperatingCents,
    cumulativeGrossCents,
    allowableDeductionCents,
    taxableBaseCents,
    incomeTaxDueCents,
    cumulativeCwtCents: input.cumulativeCwtCents,
    priorPeriodPaymentsCents: input.priorPeriodPaymentsCents,
    priorYearExcessCreditCents: input.priorYearExcessCreditCents,
    taxPayableCents,
    isOverpayment: overpaymentCents > 0,
    overpaymentCents,
    breakdown,
  };
}

/**
 * Quarterly periods are always 1701Q. At ANNUAL, a mixed income earner
 * files 1701 (not 1701A) — SPEC.md 3.2, Example B. Exported so filing
 * generation (lib/workflow/filingGeneration.ts) can pick the right
 * formType before a computation even exists yet.
 */
export function resolveFormType(input: { period: LegacyFilingComputationInput["period"]; taxpayerType: LegacyFilingComputationInput["taxpayerType"] }): FormType {
  if (input.period !== "ANNUAL") return "F1701Q";
  return input.taxpayerType === "MIXED_INCOME" ? "F1701" : "F1701A";
}

/**
 * 1701Q — items 47-63 (brief #5d §2). Items 59/60 don't apply to the
 * quarterly form and are left out entirely. Cumulative income is built by
 * chaining each quarter's own separately-rounded item 49 forward (item 50
 * is simply the previous quarter's own item 51) — never by rounding a raw
 * multi-quarter total instead. The caller (lib/filingComputation.ts)
 * assembles `previousCumulativeTaxableIncomeCents` by summing each prior
 * quarter's own rounded item 49; see that file for why this telescopes
 * correctly with no running state needed here.
 */
export function computeQuarterlyForm(input: QuarterlyFormComputationInput): QuarterlyFormComputationResult {
  const item47GrossSalesCents = input.ownGrossSalesCents;
  const item48NonOperatingCents = input.ownNonOperatingCents;
  const item49TotalIncomeCents = roundToWholePesoCents(item47GrossSalesCents + item48NonOperatingCents);
  const item50PreviousCumulativeCents = input.previousCumulativeTaxableIncomeCents;
  const item51CumulativeTaxableIncomeCents = item49TotalIncomeCents + item50PreviousCumulativeCents;

  const item52AllowableDeductionCents =
    input.taxpayerType === "PURELY_SELF_EMPLOYED" ? input.ruleSet.allowableDeductionCents : 0;
  const item53TaxableIncomeCents = Math.max(0, item51CumulativeTaxableIncomeCents - item52AllowableDeductionCents);
  const item54TaxDueCents = roundToWholePesoCents(
    new Decimal(item53TaxableIncomeCents).times(input.ruleSet.incomeTaxRateBps).dividedBy(10000).toNumber(),
  );

  const item55PriorYearExcessCreditCents = input.priorYearExcessCreditCents;
  const item56PriorPeriodPaymentsCents = input.priorPeriodPaymentsCents;
  const item57CwtPriorQuartersCents = input.cwtPriorQuartersCents;
  const item58CwtThisQuarterCents = input.cwtThisQuarterCents;
  const item61OtherCreditsCents = input.otherCreditsCents;
  const item62TotalCreditsCents = roundToWholePesoCents(
    item55PriorYearExcessCreditCents +
      item56PriorPeriodPaymentsCents +
      item57CwtPriorQuartersCents +
      item58CwtThisQuarterCents +
      item61OtherCreditsCents,
  );

  const rawItem63Cents = item54TaxDueCents - item62TotalCreditsCents;
  const item63PayableCents = Math.max(0, rawItem63Cents);
  const overpaymentCents = rawItem63Cents < 0 ? -rawItem63Cents : 0;

  const breakdown: BreakdownLine[] = [
    { label: "47. Sales/Revenues/Receipts/Fees", amountCents: item47GrossSalesCents, sourceNote: "This quarter's own declared gross sales" },
    { label: "48. Add: Non-Operating Income", amountCents: item48NonOperatingCents, sourceNote: "This quarter's own non-operating income" },
    { label: "49. Total Income for the Quarter", amountCents: item49TotalIncomeCents, sourceNote: "47 + 48, rounded to the whole peso" },
    { label: "50. Add: Total Taxable Income/(Loss) Previous Quarter", amountCents: item50PreviousCumulativeCents, sourceNote: "The previous quarter's own item 51; zero for Q1" },
    { label: "51. Cumulative Taxable Income/(Loss) as of This Quarter", amountCents: item51CumulativeTaxableIncomeCents, sourceNote: "49 + 50" },
    {
      label: "52. Less: Allowable Reduction",
      amountCents: item52AllowableDeductionCents,
      sourceNote:
        input.taxpayerType === "PURELY_SELF_EMPLOYED"
          ? "PHP 250,000, applied in full from Q1 (not prorated)"
          : "None — mixed income earner",
    },
    { label: "53. Taxable Income/(Loss) To Date", amountCents: item53TaxableIncomeCents, sourceNote: "MAX(0, 51 - 52)" },
    { label: "54. Tax Due", amountCents: item54TaxDueCents, sourceNote: `53 × ${(input.ruleSet.incomeTaxRateBps / 100).toFixed(2)}%, rounded to the whole peso` },
    { label: "55. Prior Year's Excess Credits", amountCents: item55PriorYearExcessCreditCents, sourceNote: "Carried over from the prior taxable year's election, if any" },
    { label: "56. Tax Payment/s for the Previous Quarter/s", amountCents: item56PriorPeriodPaymentsCents, sourceNote: "Amounts actually remitted on earlier returns this taxable year" },
    { label: "57. Creditable Tax Withheld for the Previous Quarter/s", amountCents: item57CwtPriorQuartersCents, sourceNote: "Certificates claimed on earlier filings of this taxable year" },
    { label: "58. Creditable Tax Withheld per BIR Form No. 2307 for this Quarter", amountCents: item58CwtThisQuarterCents, sourceNote: "Certificates claimed on this filing" },
    { label: "61. Other Tax Credits/Payments", amountCents: item61OtherCreditsCents, sourceNote: "As entered for this taxable year" },
    { label: "62. Total Tax Credits/Payments", amountCents: item62TotalCreditsCents, sourceNote: "55 + 56 + 57 + 58 + 61, rounded to the whole peso" },
    {
      label: "63. Tax Payable/(Overpayment)",
      amountCents: overpaymentCents > 0 ? overpaymentCents : item63PayableCents,
      sourceNote: "54 - 62. This is a preparation aid — the filed return and BIR's own assessment govern.",
    },
  ];

  return {
    formType: "F1701Q",
    item47GrossSalesCents,
    item48NonOperatingCents,
    item49TotalIncomeCents,
    item50PreviousCumulativeCents,
    item51CumulativeTaxableIncomeCents,
    item52AllowableDeductionCents,
    item53TaxableIncomeCents,
    item54TaxDueCents,
    item55PriorYearExcessCreditCents,
    item56PriorPeriodPaymentsCents,
    item57CwtPriorQuartersCents,
    item58CwtThisQuarterCents,
    item61OtherCreditsCents,
    item62TotalCreditsCents,
    item63PayableCents,
    taxPayableCents: item63PayableCents,
    isOverpayment: overpaymentCents > 0,
    overpaymentCents,
    breakdown,
  };
}

/**
 * 1701A — Parts IV.B/IV.C, column A only (brief #5d §3). PURELY_SELF_EMPLOYED
 * only; MIXED_INCOME's annual return stays on the old computeFiling (no
 * 1701 sheet is built). Item 47 is the rounded FULL-YEAR gross — not the
 * sum of the quarters' own rounded item 49s (the form does not chain
 * quarterly figures the way 1701Q's item 50/51 do). Items 47, 52, 57, 58,
 * 59, 60 and 63 (brief #5e §8 — "Other Tax Credits/Payments," now typed
 * rather than always 0) are rounded to the whole peso first; 49, 53, 55,
 * 56, 64 and 65 are then computed from those already-whole figures (56 is
 * rounded again after the × 8%, since multiplying two whole numbers by a
 * rate can still produce a fraction of a peso).
 */
export function computeAnnualForm(input: AnnualFormComputationInput): AnnualFormComputationResult {
  const item47GrossSalesCents = roundToWholePesoCents(input.fullYearGrossSalesCents);
  const item48SalesReturnsCents = 0;
  const item49NetSalesCents = item47GrossSalesCents - item48SalesReturnsCents;

  const item52NonOperatingCents = roundToWholePesoCents(input.fullYearNonOperatingCents);
  const item53TotalTaxableIncomeCents = item49NetSalesCents + item52NonOperatingCents;

  const item54AllowableDeductionCents = input.ruleSet.allowableDeductionCents;
  const item55TaxableIncomeCents = Math.max(0, item53TotalTaxableIncomeCents - item54AllowableDeductionCents);
  const item56TaxDueCents = roundToWholePesoCents(
    new Decimal(item55TaxableIncomeCents).times(input.ruleSet.incomeTaxRateBps).dividedBy(10000).toNumber(),
  );

  const item57PriorYearExcessCreditCents = roundToWholePesoCents(input.priorYearExcessCreditCents);
  const item58PriorPeriodPaymentsCents = roundToWholePesoCents(input.priorPeriodPaymentsQ1ToQ3Cents);
  const item59CwtQ1ToQ3Cents = roundToWholePesoCents(input.cwtQ1ToQ3Cents);
  const item60CwtQ4Cents = roundToWholePesoCents(input.cwtQ4Cents);
  const item63OtherCreditsCents = roundToWholePesoCents(input.otherCreditsCents);
  const item64TotalCreditsCents = roundToWholePesoCents(
    item57PriorYearExcessCreditCents +
      item58PriorPeriodPaymentsCents +
      item59CwtQ1ToQ3Cents +
      item60CwtQ4Cents +
      item63OtherCreditsCents,
  );

  const rawItem65Cents = item56TaxDueCents - item64TotalCreditsCents;
  const item65PayableCents = Math.max(0, rawItem65Cents);
  const overpaymentCents = rawItem65Cents < 0 ? -rawItem65Cents : 0;

  const breakdown: BreakdownLine[] = [
    { label: "47. Sales/Revenues/Receipts/Fees", amountCents: item47GrossSalesCents, sourceNote: "Full-year declared gross sales, Q1-Q4, rounded to the whole peso" },
    { label: "48. Less: Sales Returns, Allowances and Discounts", amountCents: item48SalesReturnsCents, sourceNote: "Not used" },
    { label: "49. Net Sales/Revenues/Receipts/Fees", amountCents: item49NetSalesCents, sourceNote: "47 - 48" },
    { label: "52. Total Other Non-operating Income", amountCents: item52NonOperatingCents, sourceNote: "Full-year non-operating income, Q1-Q4, rounded to the whole peso" },
    { label: "53. Total Taxable Income", amountCents: item53TotalTaxableIncomeCents, sourceNote: "49 + 52" },
    { label: "54. Less: Allowable Reduction", amountCents: item54AllowableDeductionCents, sourceNote: "PHP 250,000, applied in full" },
    { label: "55. Taxable Income/(Loss)", amountCents: item55TaxableIncomeCents, sourceNote: "MAX(0, 53 - 54)" },
    { label: "56. Tax Due", amountCents: item56TaxDueCents, sourceNote: `55 × ${(input.ruleSet.incomeTaxRateBps / 100).toFixed(2)}%, rounded to the whole peso` },
    { label: "57. Prior Year's Excess Credits", amountCents: item57PriorYearExcessCreditCents, sourceNote: "Carried over from the prior taxable year's election, if any, rounded to the whole peso" },
    { label: "58. Tax Payments for the First Three (3) Quarters", amountCents: item58PriorPeriodPaymentsCents, sourceNote: "Amounts actually remitted on this year's Q1-Q3 returns, rounded to the whole peso" },
    { label: "59. Creditable Tax Withheld for the First Three (3) Quarters", amountCents: item59CwtQ1ToQ3Cents, sourceNote: "Certificates claimed on this year's Q1-Q3 filings, rounded to the whole peso" },
    { label: "60. Creditable Tax Withheld per BIR Form No. 2307 for the 4th Quarter", amountCents: item60CwtQ4Cents, sourceNote: "Certificates claimed on the Annual filing itself, rounded to the whole peso" },
    { label: "63. Other Tax Credits/Payments", amountCents: item63OtherCreditsCents, sourceNote: "As entered for this taxable year, rounded to the whole peso" },
    { label: "64. Total Tax Credits/Payments", amountCents: item64TotalCreditsCents, sourceNote: "57 + 58 + 59 + 60 + 63" },
    {
      label: "65. Net Tax Payable/(Overpayment)",
      amountCents: overpaymentCents > 0 ? overpaymentCents : item65PayableCents,
      sourceNote: "56 - 64. This is a preparation aid — the filed return and BIR's own assessment govern.",
    },
  ];

  return {
    formType: "F1701A",
    item47GrossSalesCents,
    item48SalesReturnsCents,
    item49NetSalesCents,
    item52NonOperatingCents,
    item53TotalTaxableIncomeCents,
    item54AllowableDeductionCents,
    item55TaxableIncomeCents,
    item56TaxDueCents,
    item57PriorYearExcessCreditCents,
    item58PriorPeriodPaymentsCents,
    item59CwtQ1ToQ3Cents,
    item60CwtQ4Cents,
    item63OtherCreditsCents,
    item64TotalCreditsCents,
    item65PayableCents,
    taxPayableCents: item65PayableCents,
    isOverpayment: overpaymentCents > 0,
    overpaymentCents,
    breakdown,
  };
}

/**
 * Normalizes the figures a client-facing message needs (brief #5d §8's
 * step 4 advice message, and the existing step 16 client package email)
 * out of any FilingComputationResult shape, including a pre-brief-#5d
 * frozen snapshot whose formType happens to be F1701Q/F1701A but whose
 * actual JSON still has the old cumulative shape (duck-typed by field
 * presence, not by formType, for exactly that reason).
 */
export function extractFormSummary(sheet: FilingComputationResult): {
  grossSalesCents: number;
  taxDueCents: number;
  cwtCents: number;
  totalCreditsCents: number;
} {
  if ("item54TaxDueCents" in sheet) {
    return {
      grossSalesCents: sheet.item47GrossSalesCents,
      taxDueCents: sheet.item54TaxDueCents,
      cwtCents: sheet.item57CwtPriorQuartersCents + sheet.item58CwtThisQuarterCents,
      totalCreditsCents: sheet.item62TotalCreditsCents,
    };
  }
  if ("item56TaxDueCents" in sheet) {
    return {
      grossSalesCents: sheet.item47GrossSalesCents,
      taxDueCents: sheet.item56TaxDueCents,
      cwtCents: sheet.item59CwtQ1ToQ3Cents + sheet.item60CwtQ4Cents,
      totalCreditsCents: sheet.item64TotalCreditsCents,
    };
  }
  return {
    grossSalesCents: sheet.cumulativeGrossSalesCents,
    taxDueCents: sheet.incomeTaxDueCents,
    cwtCents: sheet.cumulativeCwtCents,
    totalCreditsCents: sheet.cumulativeCwtCents + sheet.priorPeriodPaymentsCents + sheet.priorYearExcessCreditCents,
  };
}
