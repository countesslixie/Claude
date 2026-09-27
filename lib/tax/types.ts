/**
 * Plain types for the tax computation engine. No Prisma imports here —
 * /lib/tax/ takes plain objects in and returns plain objects out
 * (SPEC.md section 4, 6).
 */

export type Period = "Q1" | "Q2" | "Q3" | "ANNUAL";
/**
 * A quarter of declared sales (QuarterlySales.quarter, D26). Deliberately
 * a different type from Period — sales quarters include Q4 (October
 * through December is real income, picked up by the ANNUAL return, not a
 * filing period of its own), while Period never does. Never conflate the
 * two: see lib/tax/periods.ts's cumulativeSalesQuartersThroughPeriod for
 * the mapping between them.
 */
export type SalesQuarter = "Q1" | "Q2" | "Q3" | "Q4";
export type TaxpayerType = "PURELY_SELF_EMPLOYED" | "MIXED_INCOME";
export type FormType = "F1701Q" | "F1701A" | "F1701";

export interface TaxRuleSetForCompute {
  /** Basis points, e.g. 800 = 8.00%. */
  incomeTaxRateBps: number;
  /** Integer centavos, e.g. 25_000_000 = PHP 250,000.00. */
  allowableDeductionCents: number;
}

export interface BreakdownLine {
  label: string;
  amountCents: number;
  sourceNote: string;
}

/**
 * Brief #5d — the 8% computation now follows the BIR form's own line
 * items and whole-peso rounding (locked rule #1, changed with the
 * bookkeeper's explicit approval 2026-09-27). Only 1701Q (quarterly,
 * either taxpayer type) and 1701A (annual, PURELY_SELF_EMPLOYED) got a
 * form-line-shaped result — no 1701 sheet is built for MIXED_INCOME's
 * annual return, so that path keeps the old cumulative-centavo shape
 * below unchanged. `FilingComputationResult` is a union of the three;
 * `formType`, `breakdown`, `isOverpayment`, `overpaymentCents`, and
 * `taxPayableCents` are common to every variant, so code that only needs
 * those (the computation sheet renderer, the amendment-alert delta check)
 * needs no per-form branching.
 */

/**
 * The OLD cumulative, centavo-exact computation — still used for
 * MIXED_INCOME's annual return (Form 1701), which has no form-line sheet
 * built (brief #5d explicitly scopes out of building one). Also the shape
 * of any computationSnapshot frozen before brief #5d shipped, for a
 * filing whose formType happened to be F1701Q/F1701A at the time — those
 * frozen snapshots are never rewritten (locked rule #3) and so may not
 * match the new per-form shape below despite sharing a formType value.
 */
export interface LegacyFilingComputationInput {
  taxableYear: number;
  period: Period;
  taxpayerType: TaxpayerType;
  ruleSet: TaxRuleSetForCompute;
  /** YTD operating gross sales/receipts, Jan 1 through the end of this period. */
  cumulativeGrossSalesCents: number;
  /** YTD other non-operating income, Jan 1 through the end of this period. */
  cumulativeNonOperatingCents: number;
  /** YTD creditable withholding tax, certificates with status Recorded/Claimed. */
  cumulativeCwtCents: number;
  /** Amounts actually remitted on earlier returns for this same taxable year. */
  priorPeriodPaymentsCents: number;
  /** Excess credit carried over from the prior taxable year's election. */
  priorYearExcessCreditCents: number;
}

export interface LegacyFilingComputationResult {
  formType: FormType;
  cumulativeGrossSalesCents: number;
  cumulativeNonOperatingCents: number;
  cumulativeGrossCents: number;
  allowableDeductionCents: number;
  taxableBaseCents: number;
  incomeTaxDueCents: number;
  cumulativeCwtCents: number;
  priorPeriodPaymentsCents: number;
  priorYearExcessCreditCents: number;
  /** Never negative — a negative raw result becomes an overpayment instead. */
  taxPayableCents: number;
  isOverpayment: boolean;
  overpaymentCents: number;
  breakdown: BreakdownLine[];
}

/**
 * 1701Q — quarterly return, items 47-63 (59/60 don't apply and are left
 * out entirely, brief #5d §2). Filed by either taxpayer type: mixed
 * income earners still file 1701Q quarterly (only the ANNUAL return
 * differs by type — 1701 vs 1701A), so item52's allowable deduction is 0
 * for them, same rule as before.
 */
export interface QuarterlyFormComputationInput {
  taxableYear: number;
  period: "Q1" | "Q2" | "Q3";
  taxpayerType: TaxpayerType;
  ruleSet: TaxRuleSetForCompute;
  /** Item 47 — this quarter's OWN declared gross sales (not cumulative). */
  ownGrossSalesCents: number;
  /** Item 48 — this quarter's OWN non-operating income (not cumulative). */
  ownNonOperatingCents: number;
  /**
   * Item 50 — the previous quarter's own item 51 (already whole-peso); 0
   * for Q1. Cumulative income is built by chaining each quarter's own
   * separately-rounded item 49 forward, never by rounding a raw
   * cumulative total (brief #5d §2).
   */
  previousCumulativeTaxableIncomeCents: number;
  /** Item 55 — existing prior-year excess credit, unrounded. */
  priorYearExcessCreditCents: number;
  /** Item 56 — amounts actually remitted on earlier returns this taxable year, unrounded. */
  priorPeriodPaymentsCents: number;
  /** Item 57 — certificates claimed on earlier filings of this taxable year, unrounded. */
  cwtPriorQuartersCents: number;
  /** Item 58 — certificates claimed on this filing, unrounded. */
  cwtThisQuarterCents: number;
}

export interface QuarterlyFormComputationResult {
  formType: "F1701Q";
  item47GrossSalesCents: number;
  item48NonOperatingCents: number;
  item49TotalIncomeCents: number;
  item50PreviousCumulativeCents: number;
  item51CumulativeTaxableIncomeCents: number;
  item52AllowableDeductionCents: number;
  item53TaxableIncomeCents: number;
  item54TaxDueCents: number;
  item55PriorYearExcessCreditCents: number;
  item56PriorPeriodPaymentsCents: number;
  item57CwtPriorQuartersCents: number;
  item58CwtThisQuarterCents: number;
  /** Item 61 — always 0, shown with no input field. */
  item61OtherCreditsCents: number;
  item62TotalCreditsCents: number;
  /** Item 63 — 0 when the filing is an overpayment instead. */
  item63PayableCents: number;
  taxPayableCents: number;
  isOverpayment: boolean;
  overpaymentCents: number;
  breakdown: BreakdownLine[];
}

/**
 * 1701A — annual return, Parts IV.B/IV.C column A only (brief #5d §3).
 * PURELY_SELF_EMPLOYED only — MIXED_INCOME's annual return is Form 1701
 * and keeps using LegacyFilingComputationResult/Input unchanged (no 1701
 * sheet is built). Items 50/51 (itemised non-operating lines), 61
 * (amended return) and 62 (foreign tax credits) are left out entirely.
 */
export interface AnnualFormComputationInput {
  taxableYear: number;
  ruleSet: TaxRuleSetForCompute;
  /** Item 47 input — full-year declared gross sales, Q1-Q4, unrounded. */
  fullYearGrossSalesCents: number;
  /** Item 52 input — full-year non-operating income, Q1-Q4, unrounded. */
  fullYearNonOperatingCents: number;
  /** Item 57 input — existing prior-year excess credit, unrounded. */
  priorYearExcessCreditCents: number;
  /** Item 58 input — amounts actually remitted on the year's Q1-Q3 returns, unrounded. */
  priorPeriodPaymentsQ1ToQ3Cents: number;
  /** Item 59 input — certificates claimed on this year's Q1-Q3 filings, unrounded. */
  cwtQ1ToQ3Cents: number;
  /** Item 60 input — certificates claimed on the ANNUAL filing itself, unrounded. */
  cwtQ4Cents: number;
}

export interface AnnualFormComputationResult {
  formType: "F1701A";
  item47GrossSalesCents: number;
  /** Item 48 — always 0, shown with no input field. */
  item48SalesReturnsCents: number;
  item49NetSalesCents: number;
  item52NonOperatingCents: number;
  item53TotalTaxableIncomeCents: number;
  item54AllowableDeductionCents: number;
  item55TaxableIncomeCents: number;
  item56TaxDueCents: number;
  item57PriorYearExcessCreditCents: number;
  item58PriorPeriodPaymentsCents: number;
  item59CwtQ1ToQ3Cents: number;
  item60CwtQ4Cents: number;
  /** Item 63 — always 0, shown with no input field. */
  item63OtherCreditsCents: number;
  item64TotalCreditsCents: number;
  /** Item 65 — 0 when the filing is an overpayment instead. */
  item65PayableCents: number;
  taxPayableCents: number;
  isOverpayment: boolean;
  overpaymentCents: number;
  breakdown: BreakdownLine[];
}

export type FilingComputationResult =
  | LegacyFilingComputationResult
  | QuarterlyFormComputationResult
  | AnnualFormComputationResult;
