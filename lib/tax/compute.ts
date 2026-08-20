import Decimal from "decimal.js";
import type { FilingComputationInput, FilingComputationResult, FormType } from "./types";

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

/**
 * SPEC.md section 3.2 — the 8% income tax computation, cumulative
 * year-to-date for every period. Pure function: plain object in, plain
 * object out, zero I/O, no Prisma imports (SPEC.md section 4, 6).
 *
 * The caller is responsible for assembling the cumulative input figures
 * (see lib/tax/cwt.ts for the CWT side of that assembly) — this function
 * does not know about individual transactions or certificates, only the
 * cumulative totals for the period being computed.
 */
export function computeFiling(input: FilingComputationInput): FilingComputationResult {
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

  const breakdown: FilingComputationResult["breakdown"] = [
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
      sourceNote: "This is a preparation aid. The filed return and BIR's own assessment govern (SPEC.md 17.7).",
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
 * files 1701 (not 1701A) — SPEC.md 3.2, Example B.
 */
function resolveFormType(input: FilingComputationInput): FormType {
  if (input.period !== "ANNUAL") return "F1701Q";
  return input.taxpayerType === "MIXED_INCOME" ? "F1701" : "F1701A";
}
