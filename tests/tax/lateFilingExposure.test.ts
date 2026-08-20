import { describe, it, expect } from "vitest";
import { computeLateFilingExposure } from "@/lib/tax/lateFilingExposure";

describe("SPEC.md 3.7 — late filing exposure calculator", () => {
  it("disables itself (not a zero estimate) when surchargeRateBps is null", () => {
    const result = computeLateFilingExposure({
      ruleSet: { surchargeRateBps: null, interestRateBpsPerAnnum: 1200 },
      taxDueCents: 1_000_000,
      daysLate: 30,
    });
    expect(result.enabled).toBe(false);
    expect(result.surchargeCents).toBeUndefined();
    expect(result.disabledReason).toBeTruthy();
  });

  it("disables itself when interestRateBpsPerAnnum is null", () => {
    const result = computeLateFilingExposure({
      ruleSet: { surchargeRateBps: 2500, interestRateBpsPerAnnum: null },
      taxDueCents: 1_000_000,
      daysLate: 30,
    });
    expect(result.enabled).toBe(false);
  });

  it("computes when both rates are configured, always carries the disclaimer", () => {
    const result = computeLateFilingExposure({
      ruleSet: { surchargeRateBps: 2500, interestRateBpsPerAnnum: 1200 },
      taxDueCents: 1_000_000,
      daysLate: 365,
    });
    expect(result.enabled).toBe(true);
    expect(result.surchargeCents).toBe(250_000); // 25% of 1,000,000
    expect(result.interestCents).toBe(120_000); // 12% per annum, exactly 1 year
    expect(result.disclaimer).toMatch(/planning only/i);
  });
});
