import Decimal from "decimal.js";

/**
 * SPEC.md section 3.7 — late filing exposure calculator. Optional,
 * informational only. Every output must carry the disclaimer below.
 *
 * Pure function, zero I/O — same rule as the rest of /lib/tax/.
 */

export const LATE_FILING_DISCLAIMER =
  "Estimate for internal planning only — confirm against the assessment issued by BIR.";

export interface LateFilingRuleSetInput {
  surchargeRateBps: number | null;
  interestRateBpsPerAnnum: number | null;
}

export interface LateFilingExposureInput {
  ruleSet: LateFilingRuleSetInput;
  taxDueCents: number;
  daysLate: number;
}

export interface LateFilingExposureResult {
  enabled: boolean;
  disabledReason?: string;
  surchargeCents?: number;
  interestCents?: number;
  totalExposureCents?: number;
  disclaimer: string;
}

/**
 * DISABLES itself (returns enabled: false, no computed amounts) rather
 * than silently computing a 0.00 surcharge/interest when the applicable
 * TaxRuleSet has not had these rates configured. A ₱0.00 line would read
 * as "no penalty exists" when the true answer is "not yet confirmed" —
 * those are not the same thing, and this guard keeps them from being
 * conflated.
 */
export function computeLateFilingExposure(
  input: LateFilingExposureInput,
): LateFilingExposureResult {
  const { surchargeRateBps, interestRateBpsPerAnnum } = input.ruleSet;

  if (surchargeRateBps == null || interestRateBpsPerAnnum == null) {
    return {
      enabled: false,
      disabledReason:
        "Surcharge and/or interest rates are not set on this taxable year's TaxRuleSet. " +
        "Confirm them against the current BIR issuance and set them in Settings before an estimate can be shown.",
      disclaimer: LATE_FILING_DISCLAIMER,
    };
  }

  const surchargeCents = new Decimal(input.taxDueCents)
    .times(surchargeRateBps)
    .dividedBy(10000)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();

  const interestCents = new Decimal(input.taxDueCents)
    .times(interestRateBpsPerAnnum)
    .dividedBy(10000)
    .times(input.daysLate)
    .dividedBy(365)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();

  return {
    enabled: true,
    surchargeCents,
    interestCents,
    totalExposureCents: surchargeCents + interestCents,
    disclaimer: LATE_FILING_DISCLAIMER,
  };
}
