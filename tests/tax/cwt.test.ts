import { describe, it, expect } from "vitest";
import { sumCwtThroughPeriod } from "@/lib/tax/cwt";

/**
 * D34 (brief #4b, supersedes D10) — a certificate's credit period is the
 * period of the filing whose step 2 it was entered under
 * (claimedOnFilingPeriod), never dateReceived against a cutoff date.
 * sumCwtThroughPeriod sums every claimable certificate whose claimed
 * period is `period` or an earlier period in the same taxable year.
 */
describe("sumCwtThroughPeriod — cumulative by claimed filing period (D34)", () => {
  it("a certificate claimed on Q1 counts in Q1, Q2, Q3 and ANNUAL", () => {
    const certs = [{ id: "c1", taxWithheldCents: 5_000_00, status: "RECORDED", claimedOnFilingPeriod: "Q1" as const }];
    expect(sumCwtThroughPeriod(certs, "Q1")).toBe(5_000_00);
    expect(sumCwtThroughPeriod(certs, "Q2")).toBe(5_000_00);
    expect(sumCwtThroughPeriod(certs, "Q3")).toBe(5_000_00);
    expect(sumCwtThroughPeriod(certs, "ANNUAL")).toBe(5_000_00);
  });

  it("a certificate claimed on Q2 does not count in Q1, but counts in Q2 onward", () => {
    const certs = [{ id: "c1", taxWithheldCents: 3_000_00, status: "RECORDED", claimedOnFilingPeriod: "Q2" as const }];
    expect(sumCwtThroughPeriod(certs, "Q1")).toBe(0);
    expect(sumCwtThroughPeriod(certs, "Q2")).toBe(3_000_00);
    expect(sumCwtThroughPeriod(certs, "Q3")).toBe(3_000_00);
    expect(sumCwtThroughPeriod(certs, "ANNUAL")).toBe(3_000_00);
  });

  it("summing through Q2 includes the Q1-claimed certificate once, not twice, alongside the Q2-claimed one", () => {
    const certificates = [
      { id: "c1", taxWithheldCents: 1_000_00, status: "RECORDED", claimedOnFilingPeriod: "Q1" as const },
      { id: "c2", taxWithheldCents: 2_000_00, status: "RECORDED", claimedOnFilingPeriod: "Q2" as const },
    ];
    expect(sumCwtThroughPeriod(certificates, "Q1")).toBe(1_000_00);
    expect(sumCwtThroughPeriod(certificates, "Q2")).toBe(3_000_00); // 1,000 + 2,000, not 1,000 + 1,000 + 2,000
  });

  it("only RECORDED/CLAIMED_ON_RETURN certificates count (per SPEC.md 3.2)", () => {
    const certificates = [
      { id: "c1", taxWithheldCents: 1_000_00, status: "RECEIVED", claimedOnFilingPeriod: "Q1" as const },
      { id: "c2", taxWithheldCents: 2_000_00, status: "RECORDED", claimedOnFilingPeriod: "Q1" as const },
      { id: "c3", taxWithheldCents: 3_000_00, status: "CLAIMED_ON_RETURN", claimedOnFilingPeriod: "Q1" as const },
    ];
    const total = sumCwtThroughPeriod(certificates, "Q1");
    expect(total).toBe(5_000_00); // RECEIVED (not yet recorded) excluded
  });

  it("a duplicate array entry (same id twice) is only summed once", () => {
    const cert = { id: "c1", taxWithheldCents: 1_000_00, status: "RECORDED", claimedOnFilingPeriod: "Q1" as const };
    const total = sumCwtThroughPeriod([cert, { ...cert }], "Q1");
    expect(total).toBe(1_000_00); // not 2,000
  });

  it("a certificate with no claimed period yet (not yet entered under any filing) is excluded", () => {
    const certs = [{ id: "c1", taxWithheldCents: 5_000_00, status: "RECORDED", claimedOnFilingPeriod: null }];
    expect(sumCwtThroughPeriod(certs, "ANNUAL")).toBe(0);
  });

  it("a certificate claimed on ANNUAL (e.g. a late arrival) counts only in ANNUAL, not in any quarter", () => {
    const certs = [{ id: "c1", taxWithheldCents: 4_000_00, status: "RECORDED", claimedOnFilingPeriod: "ANNUAL" as const }];
    expect(sumCwtThroughPeriod(certs, "Q3")).toBe(0);
    expect(sumCwtThroughPeriod(certs, "ANNUAL")).toBe(4_000_00);
  });
});
