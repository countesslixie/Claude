import { describe, it, expect } from "vitest";
import { computeFiling, computeQuarterlyForm, computeAnnualForm, resolveFormType } from "@/lib/tax/compute";
import {
  sumCwtThroughPeriod,
  assertCertificateClaimable,
  CertificateAlreadyClaimedError,
} from "@/lib/tax/cwt";
import { ALL_PERIODS } from "@/lib/tax/periods";
import type {
  LegacyFilingComputationInput,
  TaxRuleSetForCompute,
  QuarterlyFormComputationInput,
  AnnualFormComputationInput,
} from "@/lib/tax/types";

/**
 * SPEC.md section 16 acceptance tests, items 1-8, plus Examples A-E from
 * section 6, encoded exactly as tabulated — updated under brief #5d for
 * the BIR form's own whole-peso rounding (locked rule #1, changed with
 * the bookkeeper's explicit approval 2026-09-27). Every PURELY_SELF_EMPLOYED
 * quarter/annual figure below now goes through computeQuarterlyForm/
 * computeAnnualForm, the same functions the production engine calls
 * (lib/filingComputation.ts) — Example B (mixed income) is the one case
 * still on the old computeFiling, since MIXED_INCOME's annual return
 * (1701) has no form-line sheet built.
 *
 * Money in centavos throughout; `P()` converts a peso amount to centavos
 * for test readability.
 */
const P = (pesos: number) => Math.round(pesos * 100);

const RULE_SET_8PCT: TaxRuleSetForCompute = {
  incomeTaxRateBps: 800, // 8.00%
  allowableDeductionCents: P(250_000),
};

function legacyBaseInput(overrides: Partial<LegacyFilingComputationInput>): LegacyFilingComputationInput {
  return {
    taxableYear: 2026,
    period: "Q1",
    taxpayerType: "PURELY_SELF_EMPLOYED",
    ruleSet: RULE_SET_8PCT,
    cumulativeGrossSalesCents: 0,
    cumulativeNonOperatingCents: 0,
    cumulativeCwtCents: 0,
    priorPeriodPaymentsCents: 0,
    priorYearExcessCreditCents: 0,
    ...overrides,
  };
}

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

describe("SPEC.md Example A — purely self-employed, 8%, 5% CWT, TY2026", () => {
  it("Q1: period receipts 450,000, cumulative 450,000 -> 0 due, 6,500 overpayment", () => {
    const q1 = computeQuarterlyForm(
      quarterlyBaseInput({ period: "Q1", ownGrossSalesCents: P(450_000), cwtThisQuarterCents: P(22_500) }),
    );
    expect(q1.item49TotalIncomeCents).toBe(P(450_000));
    expect(q1.item51CumulativeTaxableIncomeCents).toBe(P(450_000));
    expect(q1.item53TaxableIncomeCents).toBe(P(200_000));
    expect(q1.item54TaxDueCents).toBe(P(16_000));
    expect(q1.item63PayableCents).toBe(0);
    expect(q1.isOverpayment).toBe(true);
    expect(q1.overpaymentCents).toBe(P(6_500));
    expect(q1.formType).toBe("F1701Q");
  });

  it("Q2: period receipts 600,000, cumulative 1,050,000 -> 11,500 payable", () => {
    const q1 = computeQuarterlyForm(
      quarterlyBaseInput({ period: "Q1", ownGrossSalesCents: P(450_000), cwtThisQuarterCents: P(22_500) }),
    );
    const q2 = computeQuarterlyForm(
      quarterlyBaseInput({
        period: "Q2",
        ownGrossSalesCents: P(600_000),
        previousCumulativeTaxableIncomeCents: q1.item51CumulativeTaxableIncomeCents,
        cwtPriorQuartersCents: P(22_500),
        cwtThisQuarterCents: P(30_000),
        priorPeriodPaymentsCents: 0, // Q1's actual payment was 0 (it overpaid)
      }),
    );
    expect(q2.item51CumulativeTaxableIncomeCents).toBe(P(1_050_000));
    expect(q2.item53TaxableIncomeCents).toBe(P(800_000));
    expect(q2.item54TaxDueCents).toBe(P(64_000));
    expect(q2.item63PayableCents).toBe(P(11_500));
    expect(q2.isOverpayment).toBe(false);
  });

  it("Q3: period receipts 500,000, cumulative 1,550,000 -> 15,000 payable", () => {
    const q3 = computeQuarterlyForm(
      quarterlyBaseInput({
        period: "Q3",
        ownGrossSalesCents: P(500_000),
        previousCumulativeTaxableIncomeCents: P(1_050_000),
        cwtPriorQuartersCents: P(52_500),
        cwtThisQuarterCents: P(25_000),
        priorPeriodPaymentsCents: P(11_500),
      }),
    );
    expect(q3.item51CumulativeTaxableIncomeCents).toBe(P(1_550_000));
    expect(q3.item53TaxableIncomeCents).toBe(P(1_300_000));
    expect(q3.item54TaxDueCents).toBe(P(104_000));
    expect(q3.item63PayableCents).toBe(P(15_000));
  });

  it("Annual: full-year gross 2,100,000 -> 16,500 payable, formType F1701A", () => {
    const annual = computeAnnualForm(
      annualBaseInput({
        fullYearGrossSalesCents: P(2_100_000),
        priorPeriodPaymentsQ1ToQ3Cents: P(26_500),
        cwtQ1ToQ3Cents: P(77_500),
        cwtQ4Cents: P(27_500),
      }),
    );
    expect(annual.item53TotalTaxableIncomeCents).toBe(P(2_100_000));
    expect(annual.item55TaxableIncomeCents).toBe(P(1_850_000));
    expect(annual.item56TaxDueCents).toBe(P(148_000));
    expect(annual.item65PayableCents).toBe(P(16_500));
    expect(annual.formType).toBe("F1701A");
  });

  it("Q1 overpayment is absorbed automatically by the cumulative mechanism (no manual carry-forward)", () => {
    // Q1 alone shows an overpayment; Q2's payable of 11,500 already reflects
    // that absorption purely through the cumulative formula, with no
    // separate carry-forward term added by the caller.
    const q2 = computeQuarterlyForm(
      quarterlyBaseInput({
        period: "Q2",
        ownGrossSalesCents: P(600_000),
        previousCumulativeTaxableIncomeCents: P(450_000),
        cwtPriorQuartersCents: P(22_500),
        cwtThisQuarterCents: P(30_000),
        priorPeriodPaymentsCents: 0, // Q1's actual payment was 0
      }),
    );
    expect(q2.item63PayableCents).toBe(P(11_500));
  });
});

describe("SPEC.md Example B — mixed income earner (Form 1701, no form-line sheet built)", () => {
  it("no 250,000 deduction; tax due 80,000; formType F1701", () => {
    const result = computeFiling(
      legacyBaseInput({
        taxpayerType: "MIXED_INCOME",
        period: "ANNUAL",
        cumulativeGrossSalesCents: P(1_000_000),
      }),
    );
    expect(result.allowableDeductionCents).toBe(0);
    expect(result.taxableBaseCents).toBe(P(1_000_000));
    expect(result.incomeTaxDueCents).toBe(P(80_000));
    expect(result.taxPayableCents).toBe(P(80_000));
    expect(result.formType).toBe("F1701");
  });

  it("mixed income still files 1701Q quarterly, with zero allowable deduction", () => {
    const q1 = computeQuarterlyForm(
      quarterlyBaseInput({ taxpayerType: "MIXED_INCOME", period: "Q1", ownGrossSalesCents: P(500_000) }),
    );
    expect(q1.item52AllowableDeductionCents).toBe(0);
    expect(q1.formType).toBe("F1701Q");
  });
});

describe("SPEC.md Example C — below threshold", () => {
  it("base 0, tax due 0, overpayment 10,000 (never a negative amount due)", () => {
    const result = computeQuarterlyForm(
      quarterlyBaseInput({ ownGrossSalesCents: P(200_000), cwtThisQuarterCents: P(10_000) }),
    );
    expect(result.item53TaxableIncomeCents).toBe(0);
    expect(result.item54TaxDueCents).toBe(0);
    expect(result.item63PayableCents).toBe(0);
    expect(result.item63PayableCents).toBeGreaterThanOrEqual(0);
    expect(result.isOverpayment).toBe(true);
    expect(result.overpaymentCents).toBe(P(10_000));
  });
});

describe("SPEC.md Example D — non-operating income", () => {
  it("operating + non-operating both enter item 49; 2,000,000 + 100,000 = 2,100,000", () => {
    const result = computeQuarterlyForm(
      quarterlyBaseInput({ ownGrossSalesCents: P(2_000_000), ownNonOperatingCents: P(100_000) }),
    );
    expect(result.item49TotalIncomeCents).toBe(P(2_100_000));
  });
});

describe("SPEC.md Example E — rounding (brief #5d — whole-peso, half-up)", () => {
  it("333,333.33 -> item 49 333,333.00 -> item 53 83,333.00 -> item 54 tax due 6,667.00", () => {
    const result = computeQuarterlyForm(quarterlyBaseInput({ ownGrossSalesCents: P(333_333.33) }));
    expect(result.item49TotalIncomeCents).toBe(P(333_333));
    expect(result.item53TaxableIncomeCents).toBe(P(83_333));
    expect(result.item54TaxDueCents).toBe(P(6_667)); // was 6,666.67 before brief #5d's whole-peso rounding
  });
});

describe("Brief #5d — cumulative rounding chains each quarter's own separately-rounded item 49, never a rounded raw total", () => {
  it("three quarters of 100,000.40 each round individually to 100,000.00, summing to 300,000.00 — not 300,001.00 (rounding the raw 300,000.40*3=300,001.20 total instead)", () => {
    const perQuarterOwnGross = P(100_000.4);
    const q1 = computeQuarterlyForm(quarterlyBaseInput({ period: "Q1", ownGrossSalesCents: perQuarterOwnGross }));
    expect(q1.item49TotalIncomeCents).toBe(P(100_000));
    expect(q1.item51CumulativeTaxableIncomeCents).toBe(P(100_000));

    const q2 = computeQuarterlyForm(
      quarterlyBaseInput({
        period: "Q2",
        ownGrossSalesCents: perQuarterOwnGross,
        previousCumulativeTaxableIncomeCents: q1.item51CumulativeTaxableIncomeCents,
      }),
    );
    expect(q2.item51CumulativeTaxableIncomeCents).toBe(P(200_000));

    const q3 = computeQuarterlyForm(
      quarterlyBaseInput({
        period: "Q3",
        ownGrossSalesCents: perQuarterOwnGross,
        previousCumulativeTaxableIncomeCents: q2.item51CumulativeTaxableIncomeCents,
      }),
    );
    // Sum of three separately-rounded item 49s: 100,000 + 100,000 + 100,000 = 300,000.
    expect(q3.item51CumulativeTaxableIncomeCents).toBe(P(300_000));
    expect(q3.item51CumulativeTaxableIncomeCents).not.toBe(P(300_001)); // what rounding the raw 300,001.20 total would have given
  });

  it("item 8 (was): rounding is stable across four periods repeating the same figure, no float drift", () => {
    const perPeriod = P(333_333.33);
    const q1 = computeQuarterlyForm(quarterlyBaseInput({ period: "Q1", ownGrossSalesCents: perPeriod }));
    const q2 = computeQuarterlyForm(
      quarterlyBaseInput({ period: "Q2", ownGrossSalesCents: perPeriod, previousCumulativeTaxableIncomeCents: q1.item51CumulativeTaxableIncomeCents }),
    );
    const q3 = computeQuarterlyForm(
      quarterlyBaseInput({ period: "Q3", ownGrossSalesCents: perPeriod, previousCumulativeTaxableIncomeCents: q2.item51CumulativeTaxableIncomeCents }),
    );
    const annual = computeAnnualForm(annualBaseInput({ fullYearGrossSalesCents: perPeriod * 4 }));

    // Q1: item51 333,333.00, base 83,333.00, tax 6,666.64 -> rounds to 6,667.00
    expect(q1.item54TaxDueCents).toBe(P(6_667));
    // Q2: item51 666,666.00, base 416,666.00, tax 33,333.28 -> rounds to 33,333.00
    expect(q2.item54TaxDueCents).toBe(P(33_333));
    // Q3: item51 999,999.00, base 749,999.00, tax 59,999.92 -> rounds to 60,000.00
    expect(q3.item54TaxDueCents).toBe(P(60_000));
    // Annual: full-year gross 1,333,333.32 -> item47 1,333,333.00, base 1,083,333.00, tax 86,666.64 -> rounds to 86,667.00
    expect(annual.item56TaxDueCents).toBe(P(86_667));
  });
});

describe("SPEC.md 16 item 2 — 250,000 deduction applied in full from Q1, never prorated", () => {
  it("Q1 gets the full deduction, not 62,500 (a quarter of it)", () => {
    const result = computeQuarterlyForm(quarterlyBaseInput({ period: "Q1", ownGrossSalesCents: P(250_000) }));
    expect(result.item52AllowableDeductionCents).toBe(P(250_000));
    expect(result.item53TaxableIncomeCents).toBe(0); // not 187,500 (250,000 - 62,500)
  });

  it("the deduction does not change across Q1/Q2/Q3/Annual for the same rule set", () => {
    for (const period of ALL_PERIODS) {
      if (period === "ANNUAL") {
        const annual = computeAnnualForm(annualBaseInput({ fullYearGrossSalesCents: P(1_000_000) }));
        expect(annual.item54AllowableDeductionCents).toBe(P(250_000));
      } else {
        const result = computeQuarterlyForm(quarterlyBaseInput({ period, ownGrossSalesCents: P(1_000_000) }));
        expect(result.item52AllowableDeductionCents).toBe(P(250_000));
      }
    }
  });
});

describe("SPEC.md 16 item 3 — mixed income: zero deduction; formType selection", () => {
  it("allowableDeductionCents is 0 for MIXED_INCOME even if the rule set configures 250,000", () => {
    const result = computeQuarterlyForm(
      quarterlyBaseInput({ taxpayerType: "MIXED_INCOME", ownGrossSalesCents: P(500_000) }),
    );
    expect(result.item52AllowableDeductionCents).toBe(0);
  });

  it("formType is F1701 (not F1701A) for mixed income at ANNUAL", () => {
    expect(resolveFormType({ period: "ANNUAL", taxpayerType: "MIXED_INCOME" })).toBe("F1701");
  });

  it("formType is F1701A (not F1701) for purely self-employed at ANNUAL", () => {
    expect(resolveFormType({ period: "ANNUAL", taxpayerType: "PURELY_SELF_EMPLOYED" })).toBe("F1701A");
  });

  it("formType is F1701Q for every quarterly period, either taxpayer type", () => {
    for (const taxpayerType of ["PURELY_SELF_EMPLOYED", "MIXED_INCOME"] as const) {
      for (const period of ["Q1", "Q2", "Q3"] as const) {
        expect(resolveFormType({ period, taxpayerType })).toBe("F1701Q");
      }
    }
  });
});

describe("SPEC.md 16 item 4 — negative payable renders as overpayment, never negative due", () => {
  it("item 63 is never negative", () => {
    const result = computeQuarterlyForm(
      quarterlyBaseInput({ ownGrossSalesCents: P(100_000), cwtThisQuarterCents: P(50_000) }),
    );
    expect(result.item63PayableCents).toBeGreaterThanOrEqual(0);
    expect(result.isOverpayment).toBe(true);
  });
});

describe("SPEC.md 16 item 5 — cumulative CWT never double-counts a certificate across periods", () => {
  it("summing through Q2 includes the Q1-claimed certificate once, not twice", () => {
    const certificates = [
      { id: "c1", taxWithheldCents: P(1_000), status: "RECORDED" as const, claimedOnFilingPeriod: "Q1" as const },
      { id: "c2", taxWithheldCents: P(2_000), status: "RECORDED" as const, claimedOnFilingPeriod: "Q2" as const },
    ];
    const throughQ1 = sumCwtThroughPeriod(certificates, "Q1");
    const throughQ2 = sumCwtThroughPeriod(certificates, "Q2");
    expect(throughQ1).toBe(P(1_000));
    expect(throughQ2).toBe(P(3_000)); // 1,000 + 2,000, not 1,000 + 1,000 + 2,000
  });

  it("only RECORDED/CLAIMED_ON_RETURN certificates count (per SPEC.md 3.2)", () => {
    const certificates = [
      { id: "c1", taxWithheldCents: P(1_000), status: "RECEIVED" as const, claimedOnFilingPeriod: "Q1" as const },
      { id: "c2", taxWithheldCents: P(2_000), status: "RECORDED" as const, claimedOnFilingPeriod: "Q1" as const },
      { id: "c3", taxWithheldCents: P(3_000), status: "CLAIMED_ON_RETURN" as const, claimedOnFilingPeriod: "Q1" as const },
    ];
    const total = sumCwtThroughPeriod(certificates, "Q1");
    expect(total).toBe(P(5_000)); // RECEIVED (not yet recorded) excluded
  });

  it("a duplicate array entry (same id twice) is only summed once", () => {
    const cert = { id: "c1", taxWithheldCents: P(1_000), status: "RECORDED" as const, claimedOnFilingPeriod: "Q1" as const };
    const total = sumCwtThroughPeriod([cert, { ...cert }], "Q1");
    expect(total).toBe(P(1_000)); // not 2,000
  });

  it("D34 — a certificate entered under Q3's step 2 is excluded from Q1's cumulative and included in Q3 (and ANNUAL) exactly once", () => {
    // Economically a Q1 certificate, but not entered until Q3's step 2
    // (it physically arrived in August).
    const lateArrivingCert = {
      id: "late",
      taxWithheldCents: P(5_000),
      status: "RECORDED" as const,
      claimedOnFilingPeriod: "Q3" as const,
    };
    const q3OwnCert = {
      id: "q3-cert",
      taxWithheldCents: P(2_000),
      status: "RECORDED" as const,
      claimedOnFilingPeriod: "Q3" as const,
    };
    const allCerts = [lateArrivingCert, q3OwnCert];

    // Q1's cumulative excludes it — claimedOnFilingPeriod is a fixed
    // fact set once, at entry, never reassigned (D11: no amended
    // returns), so Q1's frozen snapshot is never retroactively altered.
    const q1 = sumCwtThroughPeriod(allCerts, "Q1");
    expect(q1).toBe(0);

    // Q3's cumulative includes it exactly once, in the period it was
    // actually entered.
    const q3 = sumCwtThroughPeriod(allCerts, "Q3");
    expect(q3).toBe(P(7_000));
  });
});

describe("assertCertificateClaimable — structural guard against re-claiming a certificate", () => {
  it("allows claiming an unclaimed certificate", () => {
    expect(() =>
      assertCertificateClaimable({ id: "c1", claimedOnFilingId: null }, "filing-a"),
    ).not.toThrow();
  });

  it("is a no-op when claiming onto the same filing it's already on", () => {
    expect(() =>
      assertCertificateClaimable({ id: "c1", claimedOnFilingId: "filing-a" }, "filing-a"),
    ).not.toThrow();
  });

  it("throws when a certificate already claimed on one filing is claimed onto a different one", () => {
    expect(() =>
      assertCertificateClaimable({ id: "c1", claimedOnFilingId: "filing-a" }, "filing-b"),
    ).toThrow(CertificateAlreadyClaimedError);
  });
});

describe("SPEC.md 16 item 6 — no Q4 filing is ever generated", () => {
  it("the valid period set is exactly Q1, Q2, Q3, ANNUAL", () => {
    expect(ALL_PERIODS).toEqual(["Q1", "Q2", "Q3", "ANNUAL"]);
    expect(ALL_PERIODS).not.toContain("Q4");
    expect(ALL_PERIODS.length).toBe(4);
  });
});

describe("SPEC.md 16 item 7 — prior-year carry-over credit applies once per period, consistently", () => {
  it("the same year-constant credit reduces each period's own cumulative payable exactly once", () => {
    const creditCents = P(10_000);
    const q1 = computeQuarterlyForm(
      quarterlyBaseInput({
        period: "Q1",
        ownGrossSalesCents: P(450_000),
        cwtThisQuarterCents: P(22_500),
        priorYearExcessCreditCents: creditCents,
      }),
    );
    // Q1: base 200,000 -> tax 16,000; 16,000 - 22,500 - 0 - 10,000 = -16,500 overpayment
    expect(q1.item63PayableCents).toBe(0);
    expect(q1.overpaymentCents).toBe(P(16_500));

    const q2 = computeQuarterlyForm(
      quarterlyBaseInput({
        period: "Q2",
        ownGrossSalesCents: P(600_000),
        previousCumulativeTaxableIncomeCents: q1.item51CumulativeTaxableIncomeCents,
        cwtPriorQuartersCents: P(22_500),
        cwtThisQuarterCents: P(30_000),
        priorPeriodPaymentsCents: 0, // Q1 actually paid 0
        priorYearExcessCreditCents: creditCents, // same year-constant value, not doubled
      }),
    );
    // Q2: base 800,000 -> tax 64,000; 64,000 - 52,500 - 0 - 10,000 = 1,500
    expect(q2.item63PayableCents).toBe(P(1_500));
  });

  it("Q2 in isolation: 10,000 credit brings 64,000 due down to 1,500 payable, not 11,500", () => {
    // Same figures as the combined Q1+Q2 test above, but computed as a
    // single standalone call — proves the credit is applied directly off
    // QuarterlyFormComputationInput.priorYearExcessCreditCents on every
    // call, not something that only takes effect after a prior
    // computeQuarterlyForm() call for the same year has "used" it.
    const result = computeQuarterlyForm(
      quarterlyBaseInput({
        period: "Q2",
        ownGrossSalesCents: P(600_000), // cumulative through Q2 -> income tax due 64,000
        previousCumulativeTaxableIncomeCents: P(450_000),
        cwtPriorQuartersCents: P(22_500),
        cwtThisQuarterCents: P(30_000),
        priorPeriodPaymentsCents: 0,
        priorYearExcessCreditCents: P(10_000),
      }),
    );
    expect(result.item54TaxDueCents).toBe(P(64_000));
    expect(result.item63PayableCents).toBe(P(1_500));
    expect(result.item63PayableCents).not.toBe(P(11_500));
  });
});
