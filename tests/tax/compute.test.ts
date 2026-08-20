import { describe, it, expect } from "vitest";
import { computeFiling } from "@/lib/tax/compute";
import {
  sumCwtThroughPeriod,
  assertCertificateClaimable,
  CertificateAlreadyClaimedError,
} from "@/lib/tax/cwt";
import { ALL_PERIODS } from "@/lib/tax/periods";
import type { FilingComputationInput, TaxRuleSetForCompute } from "@/lib/tax/types";

/**
 * SPEC.md section 16 acceptance tests, items 1-8, plus Examples A-E from
 * section 6, encoded exactly as tabulated. Money in centavos throughout;
 * `P()` converts a peso amount to centavos for test readability.
 */
const P = (pesos: number) => Math.round(pesos * 100);

const RULE_SET_8PCT: TaxRuleSetForCompute = {
  incomeTaxRateBps: 800, // 8.00%
  allowableDeductionCents: P(250_000),
};

function baseInput(overrides: Partial<FilingComputationInput>): FilingComputationInput {
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
    // P5: pass-through metadata, not exercised by these compute-math tests —
    // see tests/tax/cwt.test.ts for resolveCertificateCutoffDate coverage.
    certificateCutoffDate: new Date("2026-12-31"),
    certificateCutoffSource: "TODAY",
    ...overrides,
  };
}

describe("SPEC.md Example A — purely self-employed, 8%, 5% CWT, TY2026", () => {
  it("Q1: cumulative 450,000 -> 0 due, 6,500 overpayment", () => {
    const result = computeFiling(
      baseInput({
        period: "Q1",
        cumulativeGrossSalesCents: P(450_000),
        cumulativeCwtCents: P(22_500),
      }),
    );
    expect(result.taxableBaseCents).toBe(P(200_000));
    expect(result.incomeTaxDueCents).toBe(P(16_000));
    expect(result.taxPayableCents).toBe(0);
    expect(result.isOverpayment).toBe(true);
    expect(result.overpaymentCents).toBe(P(6_500));
    expect(result.formType).toBe("F1701Q");
  });

  it("Q2: cumulative 1,050,000 -> 11,500 payable", () => {
    const result = computeFiling(
      baseInput({
        period: "Q2",
        cumulativeGrossSalesCents: P(1_050_000),
        cumulativeCwtCents: P(52_500),
        priorPeriodPaymentsCents: 0,
      }),
    );
    expect(result.taxableBaseCents).toBe(P(800_000));
    expect(result.incomeTaxDueCents).toBe(P(64_000));
    expect(result.taxPayableCents).toBe(P(11_500));
    expect(result.isOverpayment).toBe(false);
  });

  it("Q3: cumulative 1,550,000 -> 15,000 payable", () => {
    const result = computeFiling(
      baseInput({
        period: "Q3",
        cumulativeGrossSalesCents: P(1_550_000),
        cumulativeCwtCents: P(77_500),
        priorPeriodPaymentsCents: P(11_500),
      }),
    );
    expect(result.taxableBaseCents).toBe(P(1_300_000));
    expect(result.incomeTaxDueCents).toBe(P(104_000));
    expect(result.taxPayableCents).toBe(P(15_000));
  });

  it("Annual: cumulative 2,100,000 -> 16,500 payable, formType F1701A", () => {
    const result = computeFiling(
      baseInput({
        period: "ANNUAL",
        cumulativeGrossSalesCents: P(2_100_000),
        cumulativeCwtCents: P(105_000),
        priorPeriodPaymentsCents: P(26_500),
      }),
    );
    expect(result.taxableBaseCents).toBe(P(1_850_000));
    expect(result.incomeTaxDueCents).toBe(P(148_000));
    expect(result.taxPayableCents).toBe(P(16_500));
    expect(result.formType).toBe("F1701A");
  });

  it("Q1 overpayment is absorbed automatically by the cumulative mechanism (no manual carry-forward)", () => {
    // Q1 alone shows an overpayment; Q2's payable of 11,500 already reflects
    // that absorption purely through the cumulative formula, with no
    // separate carry-forward term added by the caller.
    const q2 = computeFiling(
      baseInput({
        period: "Q2",
        cumulativeGrossSalesCents: P(1_050_000),
        cumulativeCwtCents: P(52_500),
        priorPeriodPaymentsCents: 0, // Q1's actual payment was 0
      }),
    );
    expect(q2.taxPayableCents).toBe(P(11_500));
  });
});

describe("SPEC.md Example B — mixed income earner", () => {
  it("no 250,000 deduction; tax due 80,000; formType F1701", () => {
    const result = computeFiling(
      baseInput({
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
});

describe("SPEC.md Example C — below threshold", () => {
  it("base 0, tax due 0, overpayment 10,000 (never a negative amount due)", () => {
    const result = computeFiling(
      baseInput({
        cumulativeGrossSalesCents: P(200_000),
        cumulativeCwtCents: P(10_000),
      }),
    );
    expect(result.taxableBaseCents).toBe(0);
    expect(result.incomeTaxDueCents).toBe(0);
    expect(result.taxPayableCents).toBe(0);
    expect(result.taxPayableCents).toBeGreaterThanOrEqual(0);
    expect(result.isOverpayment).toBe(true);
    expect(result.overpaymentCents).toBe(P(10_000));
  });
});

describe("SPEC.md Example D — non-operating income", () => {
  it("operating + non-operating both enter the base; cumulative gross 2,100,000", () => {
    const result = computeFiling(
      baseInput({
        cumulativeGrossSalesCents: P(2_000_000),
        cumulativeNonOperatingCents: P(100_000),
      }),
    );
    expect(result.cumulativeGrossCents).toBe(P(2_100_000));
  });
});

describe("SPEC.md Example E — rounding", () => {
  it("333,333.33 -> base 83,333.33 -> tax 6,666.67 (half-up to the centavo)", () => {
    const result = computeFiling(
      baseInput({
        cumulativeGrossSalesCents: P(333_333.33),
      }),
    );
    expect(result.taxableBaseCents).toBe(P(83_333.33));
    expect(result.incomeTaxDueCents).toBe(666_667); // P(6_666.67) rounded from 666666.64
  });

  it("item 8: rounding is stable across four cumulative periods, no float drift", () => {
    const perPeriod = P(333_333.33); // 33,333,333 centavos
    const q1 = computeFiling(baseInput({ period: "Q1", cumulativeGrossSalesCents: perPeriod * 1 }));
    const q2 = computeFiling(baseInput({ period: "Q2", cumulativeGrossSalesCents: perPeriod * 2 }));
    const q3 = computeFiling(baseInput({ period: "Q3", cumulativeGrossSalesCents: perPeriod * 3 }));
    const annual = computeFiling(baseInput({ period: "ANNUAL", cumulativeGrossSalesCents: perPeriod * 4 }));

    expect(q1.incomeTaxDueCents).toBe(666_667);
    expect(q2.incomeTaxDueCents).toBe(3_333_333);
    expect(q3.incomeTaxDueCents).toBe(6_000_000);
    expect(annual.incomeTaxDueCents).toBe(8_666_667);
  });
});

describe("SPEC.md 16 item 2 — 250,000 deduction applied in full from Q1, never prorated", () => {
  it("Q1 gets the full deduction, not 62,500 (a quarter of it)", () => {
    const result = computeFiling(
      baseInput({
        period: "Q1",
        cumulativeGrossSalesCents: P(250_000),
      }),
    );
    expect(result.allowableDeductionCents).toBe(P(250_000));
    expect(result.taxableBaseCents).toBe(0); // not 187,500 (250,000 - 62,500)
  });

  it("the deduction does not change across Q1/Q2/Q3/Annual for the same rule set", () => {
    for (const period of ALL_PERIODS) {
      const result = computeFiling(baseInput({ period, cumulativeGrossSalesCents: P(1_000_000) }));
      expect(result.allowableDeductionCents).toBe(P(250_000));
    }
  });
});

describe("SPEC.md 16 item 3 — mixed income: zero deduction, formType F1701", () => {
  it("allowableDeductionCents is 0 even if the rule set configures 250,000", () => {
    const result = computeFiling(
      baseInput({ taxpayerType: "MIXED_INCOME", cumulativeGrossSalesCents: P(500_000) }),
    );
    expect(result.allowableDeductionCents).toBe(0);
  });

  it("formType is F1701 (not F1701A) for mixed income at ANNUAL", () => {
    const result = computeFiling(
      baseInput({
        taxpayerType: "MIXED_INCOME",
        period: "ANNUAL",
        cumulativeGrossSalesCents: P(500_000),
      }),
    );
    expect(result.formType).toBe("F1701");
  });

  it("formType is F1701A (not F1701) for purely self-employed at ANNUAL", () => {
    const result = computeFiling(
      baseInput({
        taxpayerType: "PURELY_SELF_EMPLOYED",
        period: "ANNUAL",
        cumulativeGrossSalesCents: P(500_000),
      }),
    );
    expect(result.formType).toBe("F1701A");
  });
});

describe("SPEC.md 16 item 4 — negative payable renders as overpayment, never negative due", () => {
  it("taxPayableCents is never negative", () => {
    const result = computeFiling(
      baseInput({ cumulativeGrossSalesCents: P(100_000), cumulativeCwtCents: P(50_000) }),
    );
    expect(result.taxPayableCents).toBeGreaterThanOrEqual(0);
    expect(result.isOverpayment).toBe(true);
  });
});

describe("SPEC.md 16 item 5 — cumulative CWT never double-counts a certificate across periods", () => {
  it("summing through Q2 includes the Q1 certificate once, not twice", () => {
    const certificates = [
      { id: "c1", taxWithheldCents: P(1_000), dateReceived: new Date("2026-02-15"), status: "RECORDED" as const },
      { id: "c2", taxWithheldCents: P(2_000), dateReceived: new Date("2026-05-15"), status: "RECORDED" as const },
    ];
    const throughQ1 = sumCwtThroughPeriod(certificates, new Date("2026-03-31"));
    const throughQ2 = sumCwtThroughPeriod(certificates, new Date("2026-06-30"));
    expect(throughQ1).toBe(P(1_000));
    expect(throughQ2).toBe(P(3_000)); // 1,000 + 2,000, not 1,000 + 1,000 + 2,000
  });

  it("only RECORDED/CLAIMED_ON_RETURN certificates count (per SPEC.md 3.2)", () => {
    const certificates = [
      { id: "c1", taxWithheldCents: P(1_000), dateReceived: new Date("2026-01-10"), status: "RECEIVED" as const },
      { id: "c2", taxWithheldCents: P(2_000), dateReceived: new Date("2026-01-15"), status: "RECORDED" as const },
      { id: "c3", taxWithheldCents: P(3_000), dateReceived: new Date("2026-01-20"), status: "CLAIMED_ON_RETURN" as const },
    ];
    const total = sumCwtThroughPeriod(certificates, new Date("2026-03-31"));
    expect(total).toBe(P(5_000)); // RECEIVED (not yet recorded) excluded
  });

  it("a duplicate array entry (same id twice) is only summed once", () => {
    const cert = { id: "c1", taxWithheldCents: P(1_000), dateReceived: new Date("2026-01-10"), status: "RECORDED" as const };
    const total = sumCwtThroughPeriod([cert, { ...cert }], new Date("2026-03-31"));
    expect(total).toBe(P(1_000)); // not 2,000
  });

  it("a certificate arriving late (dateReceived in Q3) is excluded from a fresh Q1 recompute and included in Q3 exactly once", () => {
    // Economically a Q1 certificate, but not physically received until August.
    const lateArrivingQ1Cert = {
      id: "late-q1",
      taxWithheldCents: P(5_000),
      dateReceived: new Date("2026-08-05"),
      status: "RECORDED" as const,
    };
    const q3OnlyCert = {
      id: "q3-cert",
      taxWithheldCents: P(2_000),
      dateReceived: new Date("2026-08-20"),
      status: "RECORDED" as const,
    };
    const allCerts = [lateArrivingQ1Cert, q3OnlyCert];

    // Recomputing Q1 today, with the late certificate now sitting in the
    // system, still excludes it — filtering is on dateReceived, a fixed
    // fact, not "as of when you ask." Q1's frozen snapshot is never
    // retroactively altered by this recompute.
    const q1Recompute = sumCwtThroughPeriod(allCerts, new Date("2026-03-31"));
    expect(q1Recompute).toBe(0);

    // Q3's cumulative includes it exactly once, in the period it was
    // actually recorded.
    const q3Cumulative = sumCwtThroughPeriod(allCerts, new Date("2026-09-30"));
    expect(q3Cumulative).toBe(P(7_000));
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
    const q1 = computeFiling(
      baseInput({
        period: "Q1",
        cumulativeGrossSalesCents: P(450_000),
        cumulativeCwtCents: P(22_500),
        priorYearExcessCreditCents: creditCents,
      }),
    );
    // Q1: base 200,000 -> tax 16,000; 16,000 - 22,500 - 0 - 10,000 = -16,500 overpayment
    expect(q1.taxPayableCents).toBe(0);
    expect(q1.overpaymentCents).toBe(P(16_500));

    const q2 = computeFiling(
      baseInput({
        period: "Q2",
        cumulativeGrossSalesCents: P(1_050_000),
        cumulativeCwtCents: P(52_500),
        priorPeriodPaymentsCents: 0, // Q1 actually paid 0
        priorYearExcessCreditCents: creditCents, // same year-constant value, not doubled
      }),
    );
    // Q2: base 800,000 -> tax 64,000; 64,000 - 52,500 - 0 - 10,000 = 1,500
    expect(q2.taxPayableCents).toBe(P(1_500));
  });
});
