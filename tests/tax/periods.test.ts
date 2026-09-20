import { describe, it, expect } from "vitest";
import {
  periodStartDate,
  periodEndDate,
  priorPeriodsOf,
  ALL_PERIODS,
  cumulativeSalesQuartersThroughPeriod,
  salesQuarterEndDate,
} from "@/lib/tax/periods";

/**
 * P4 (Phase 2b): explicit, asserted period boundaries. Q1-Q3 are calendar
 * quarters; ANNUAL spans the full taxable year (Jan 1 - Dec 31), not just
 * a fourth quarter — there is no Q4 return (SPEC.md 3.6).
 */
describe("period boundaries", () => {
  const YEAR = 2026;

  it("Q1 runs Jan 1 - Mar 31", () => {
    expect(periodStartDate(YEAR, "Q1")).toEqual(new Date(Date.UTC(2026, 0, 1)));
    expect(periodEndDate(YEAR, "Q1")).toEqual(new Date(Date.UTC(2026, 2, 31)));
  });

  it("Q2 runs Apr 1 - Jun 30", () => {
    expect(periodStartDate(YEAR, "Q2")).toEqual(new Date(Date.UTC(2026, 3, 1)));
    expect(periodEndDate(YEAR, "Q2")).toEqual(new Date(Date.UTC(2026, 5, 30)));
  });

  it("Q3 runs Jul 1 - Sep 30", () => {
    expect(periodStartDate(YEAR, "Q3")).toEqual(new Date(Date.UTC(2026, 6, 1)));
    expect(periodEndDate(YEAR, "Q3")).toEqual(new Date(Date.UTC(2026, 8, 30)));
  });

  it("ANNUAL runs Jan 1 - Dec 31 (the full year, not just Q4)", () => {
    expect(periodStartDate(YEAR, "ANNUAL")).toEqual(new Date(Date.UTC(2026, 0, 1)));
    expect(periodEndDate(YEAR, "ANNUAL")).toEqual(new Date(Date.UTC(2026, 11, 31)));
  });

  it("quarters are contiguous with no gaps or overlaps", () => {
    for (const [quarter, next] of [
      ["Q1", "Q2"],
      ["Q2", "Q3"],
    ] as const) {
      const end = periodEndDate(YEAR, quarter);
      const nextStart = periodStartDate(YEAR, next);
      const dayAfterEnd = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + 1));
      expect(nextStart).toEqual(dayAfterEnd);
    }
  });

  it("priorPeriodsOf never includes ANNUAL for a quarter, since ANNUAL is not a prior period of anything", () => {
    for (const period of ALL_PERIODS) {
      expect(priorPeriodsOf(period)).not.toContain("ANNUAL");
    }
  });
});

/**
 * D26/SPEC.md 3.2 — QuarterlySales' cumulative mapping. Q2/Q3 are
 * genuinely cumulative (unlike periodToQuarters' single-quarter-per-period
 * behavior for certificates), and ANNUAL includes Q4, which has no filing
 * period of its own.
 */
describe("cumulativeSalesQuartersThroughPeriod", () => {
  it("Q1 sums only Q1", () => {
    expect(cumulativeSalesQuartersThroughPeriod("Q1")).toEqual(["Q1"]);
  });

  it("Q2 sums Q1 + Q2", () => {
    expect(cumulativeSalesQuartersThroughPeriod("Q2")).toEqual(["Q1", "Q2"]);
  });

  it("Q3 sums Q1 + Q2 + Q3", () => {
    expect(cumulativeSalesQuartersThroughPeriod("Q3")).toEqual(["Q1", "Q2", "Q3"]);
  });

  it("ANNUAL sums all four quarters, including Q4 which has no filing period of its own", () => {
    expect(cumulativeSalesQuartersThroughPeriod("ANNUAL")).toEqual(["Q1", "Q2", "Q3", "Q4"]);
  });
});

describe("salesQuarterEndDate", () => {
  it("Q1-Q3 agree with the matching filing period's own end date", () => {
    expect(salesQuarterEndDate(2026, "Q1")).toEqual(periodEndDate(2026, "Q1"));
    expect(salesQuarterEndDate(2026, "Q2")).toEqual(periodEndDate(2026, "Q2"));
    expect(salesQuarterEndDate(2026, "Q3")).toEqual(periodEndDate(2026, "Q3"));
  });

  it("Q4 has no filing period of its own — its end date is Dec 31, same as ANNUAL's", () => {
    expect(salesQuarterEndDate(2026, "Q4")).toEqual(periodEndDate(2026, "ANNUAL"));
    expect(salesQuarterEndDate(2026, "Q4")).toEqual(new Date(Date.UTC(2026, 11, 31)));
  });
});
