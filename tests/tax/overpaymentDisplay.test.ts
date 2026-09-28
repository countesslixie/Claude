import { describe, it, expect } from "vitest";
import { computeQuarterlyForm, computeAnnualForm } from "@/lib/tax/compute";
import { formatBreakdownAmount } from "@/lib/money";
import type { QuarterlyFormComputationInput, AnnualFormComputationInput, TaxRuleSetForCompute } from "@/lib/tax/types";

/**
 * Brief #5g §7 — regression test for the walkthrough finding: item 63
 * (1701Q) showed a plain positive figure for an overpayment, identical to
 * tax payable, even though the sheet's own heading already said
 * "Overpayment". Fails under the old code because the breakdown line
 * carried no isOverpaymentLine flag and formatBreakdownAmount did not
 * exist, so the amount rendered unparenthesized and the label carried no
 * "— overpayment" suffix.
 */
const P = (pesos: number) => Math.round(pesos * 100);

const RULE_SET_8PCT: TaxRuleSetForCompute = {
  incomeTaxRateBps: 800,
  allowableDeductionCents: P(250_000),
};

function quarterlyBaseInput(overrides: Partial<QuarterlyFormComputationInput>): QuarterlyFormComputationInput {
  return {
    taxableYear: 2026,
    period: "Q1",
    taxpayerType: "PURELY_SELF_EMPLOYED",
    ruleSet: RULE_SET_8PCT,
    ownGrossSalesCents: 0,
    ownNonOperatingCents: 0,
    previousCumulativeTaxableIncomeCents: 0,
    priorYearExcessCreditCents: 0,
    priorPeriodPaymentsCents: 0,
    cwtPriorQuartersCents: 0,
    cwtThisQuarterCents: 0,
    otherCreditsCents: 0,
    ...overrides,
  };
}

function annualBaseInput(overrides: Partial<AnnualFormComputationInput>): AnnualFormComputationInput {
  return {
    taxableYear: 2026,
    ruleSet: RULE_SET_8PCT,
    fullYearGrossSalesCents: 0,
    fullYearNonOperatingCents: 0,
    priorYearExcessCreditCents: 0,
    priorPeriodPaymentsQ1ToQ3Cents: 0,
    cwtQ1ToQ3Cents: 0,
    cwtQ4Cents: 0,
    otherCreditsCents: 0,
    ...overrides,
  };
}

function item<T extends { label: string }>(breakdown: T[], prefix: string): T {
  const line = breakdown.find((l) => l.label.startsWith(prefix));
  if (!line) throw new Error(`No breakdown line starting with "${prefix}"`);
  return line;
}

describe("1701Q item 63 — overpayment shown distinctly from tax payable", () => {
  it("flags the row and appends the suffix when it's an overpayment", () => {
    const result = computeQuarterlyForm(
      quarterlyBaseInput({ ownGrossSalesCents: P(450_000), cwtThisQuarterCents: P(22_500) }),
    );
    expect(result.isOverpayment).toBe(true);

    const line = item(result.breakdown, "63.");
    expect(line.label).toBe("63. Tax Payable/(Overpayment) — overpayment");
    expect(line.isOverpaymentLine).toBe(true);
    expect(formatBreakdownAmount(line.amountCents, line.isOverpaymentLine)).toBe(
      `(${"₱"}6,500.00)`,
    );
  });

  it("shows tax due unparenthesized and unsuffixed when not an overpayment", () => {
    const result = computeQuarterlyForm(
      quarterlyBaseInput({ ownGrossSalesCents: P(1_000_000), cwtThisQuarterCents: 0 }),
    );
    expect(result.isOverpayment).toBe(false);

    const line = item(result.breakdown, "63.");
    expect(line.label).toBe("63. Tax Payable/(Overpayment)");
    expect(line.isOverpaymentLine).toBeFalsy();
    expect(formatBreakdownAmount(line.amountCents, line.isOverpaymentLine)).not.toMatch(/^\(/);
  });
});

describe("1701A item 65 — overpayment shown distinctly from tax payable", () => {
  it("flags the row and appends the suffix when it's an overpayment", () => {
    const result = computeAnnualForm(
      annualBaseInput({
        fullYearGrossSalesCents: P(1_424_056),
        cwtQ1ToQ3Cents: P(54_556),
        cwtQ4Cents: P(1_670_000),
      }),
    );
    expect(result.isOverpayment).toBe(true);

    const line = item(result.breakdown, "65.");
    expect(line.label).toBe("65. Net Tax Payable/(Overpayment) — overpayment");
    expect(line.isOverpaymentLine).toBe(true);
    expect(formatBreakdownAmount(line.amountCents, line.isOverpaymentLine)).toMatch(/^\(.*\)$/);
  });

  it("shows tax due unparenthesized and unsuffixed when not an overpayment", () => {
    const result = computeAnnualForm(
      annualBaseInput({
        fullYearGrossSalesCents: P(1_424_056),
        cwtQ1ToQ3Cents: P(54_556),
        cwtQ4Cents: P(16_647),
      }),
    );
    expect(result.isOverpayment).toBe(false);

    const line = item(result.breakdown, "65.");
    expect(line.label).toBe("65. Net Tax Payable/(Overpayment)");
    expect(line.isOverpaymentLine).toBeFalsy();
    expect(formatBreakdownAmount(line.amountCents, line.isOverpaymentLine)).not.toMatch(/^\(/);
  });
});

describe("formatBreakdownAmount", () => {
  it("parenthesizes only when isOverpaymentLine is true; other lines are unaffected", () => {
    expect(formatBreakdownAmount(P(16_700), true)).toBe(`(${"₱"}16,700.00)`);
    expect(formatBreakdownAmount(P(16_700), false)).toBe(`${"₱"}16,700.00`);
    expect(formatBreakdownAmount(P(16_700))).toBe(`${"₱"}16,700.00`);
    expect(formatBreakdownAmount(-P(250_000))).toBe(`${"₱"}-250,000.00`);
  });
});
