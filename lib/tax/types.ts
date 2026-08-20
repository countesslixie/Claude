/**
 * Plain types for the tax computation engine. No Prisma imports here —
 * /lib/tax/ takes plain objects in and returns plain objects out
 * (SPEC.md section 4, 6).
 */

export type Period = "Q1" | "Q2" | "Q3" | "ANNUAL";
export type TaxpayerType = "PURELY_SELF_EMPLOYED" | "MIXED_INCOME";
export type FormType = "F1701Q" | "F1701A" | "F1701";

/**
 * Which rule resolved a filing's certificate cutoff date (SPEC.md 3.5,
 * Phase 2b P5). Priority when resolving, highest first: MANUAL_OVERRIDE,
 * then FILED_AT, then TODAY.
 */
export type CertificateCutoffSource = "MANUAL_OVERRIDE" | "FILED_AT" | "TODAY";

export interface TaxRuleSetForCompute {
  /** Basis points, e.g. 800 = 8.00%. */
  incomeTaxRateBps: number;
  /** Integer centavos, e.g. 25_000_000 = PHP 250,000.00. */
  allowableDeductionCents: number;
}

export interface FilingComputationInput {
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
  /**
   * The cutoff date used to decide which certificates fed cumulativeCwtCents
   * (SPEC.md 3.5) — NOT the same as the period end date used for gross
   * sales. Pass-through only; computeFiling() does no date math with it.
   */
  certificateCutoffDate: Date;
  certificateCutoffSource: CertificateCutoffSource;
}

export interface BreakdownLine {
  label: string;
  amountCents: number;
  sourceNote: string;
}

export interface FilingComputationResult {
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
  /** Recorded so a frozen filing's snapshot shows which certificates it claimed and why (SPEC.md 3.5). */
  certificateCutoffDate: Date;
  certificateCutoffSource: CertificateCutoffSource;
}
