import { describe, it, expect } from "vitest";
import { eafsDueDate, shiftToNextBusinessDay } from "@/lib/tax/deadlines";

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

/**
 * P6 (Phase 2b): eafsDueDate = (filedAt is null or on-time ? adjustedDueDate
 * : filedAt) + offsetDays, then business-day shift. Filing early never
 * moves the deadline earlier.
 */
describe("eafsDueDate", () => {
  it("unfiled Annual, due Apr 15 -> eAFS Apr 30 (offset from the due date)", () => {
    const result = eafsDueDate({
      adjustedDueDate: D("2026-04-15"),
      filedAt: null,
      offsetDays: 15,
      holidays: [],
    });
    expect(result).toEqual(D("2026-04-30"));
  });

  it("Annual due Apr 15, filed early Mar 31 -> eAFS Apr 30, not Apr 15 (early filing doesn't move it earlier)", () => {
    const result = eafsDueDate({
      adjustedDueDate: D("2026-04-15"),
      filedAt: D("2026-03-31"),
      offsetDays: 15,
      holidays: [],
    });
    expect(result).toEqual(D("2026-04-30"));
  });

  it("Q2 statutory Aug 15 (Saturday) shifts to adjusted Aug 17; filed exactly on time -> eAFS Sep 1", () => {
    // The eafsDueDate formula anchors on adjustedDueDate, not the
    // statutory date — Aug 15, 2026 is a Saturday, so the real adjusted
    // due date is Mon Aug 17 (matching prisma/seed.ts's DUE.Q2.adjusted).
    // Passing the statutory date here instead was a test bug in an
    // earlier revision, not a bug in eafsDueDate() itself, which always
    // took adjustedDueDate as its parameter (lib/tax/deadlines.ts:57-60).
    // Sep 1, 2026 is a Tuesday and not a seeded holiday, so no shift.
    const result = eafsDueDate({
      adjustedDueDate: D("2026-08-17"),
      filedAt: D("2026-08-17"),
      offsetDays: 15,
      holidays: [],
    });
    expect(result).toEqual(D("2026-09-01"));
    expect(result).not.toEqual(D("2026-08-30"));
    expect(result).not.toEqual(D("2026-08-31"));
  });

  it("Q2 adjusted due Aug 17, filed late Aug 20 -> eAFS Sep 4 (offset runs from the actual filing date)", () => {
    const result = eafsDueDate({
      adjustedDueDate: D("2026-08-17"),
      filedAt: D("2026-08-20"),
      offsetDays: 15,
      holidays: [],
    });
    expect(result).toEqual(D("2026-09-04"));
  });

  it("Q3 statutory Nov 15 (Sunday) shifts to adjusted Nov 16; filed exactly on time -> eAFS Dec 1", () => {
    // Same anchoring check as Q2 above, for TY2026 Q3 (DUE.Q3.adjusted in
    // prisma/seed.ts). Dec 1, 2026 is a Tuesday and not a seeded holiday.
    const result = eafsDueDate({
      adjustedDueDate: D("2026-11-16"),
      filedAt: D("2026-11-16"),
      offsetDays: 15,
      holidays: [],
    });
    expect(result).toEqual(D("2026-12-01"));
  });

  it("shifts forward past a holiday that immediately follows a weekend", () => {
    // Raw date lands on a Saturday; the following Monday is also seeded as
    // a holiday, so the shift must continue to Tuesday.
    const raw = D("2026-08-15"); // Saturday
    const result = shiftToNextBusinessDay(raw, [D("2026-08-17")]);
    expect(result).toEqual(D("2026-08-18"));
  });

  it("applies the business-day shift end-to-end when the raw offset date itself lands on a holiday", () => {
    // None of the Q2/Q3/Annual cases above happen to need a shift on the
    // real calendar, so this proves eafsDueDate() actually wires the
    // shift step in, not just shiftToNextBusinessDay() in isolation:
    // Aug 17 + 15 = Sep 1, seeded here as a holiday, so it must move to
    // Sep 2 (Wednesday).
    const result = eafsDueDate({
      adjustedDueDate: D("2026-08-17"),
      filedAt: D("2026-08-17"),
      offsetDays: 15,
      holidays: [D("2026-09-01")],
    });
    expect(result).toEqual(D("2026-09-02"));
  });
});

describe("shiftToNextBusinessDay", () => {
  it("leaves a weekday non-holiday date unchanged", () => {
    expect(shiftToNextBusinessDay(D("2026-05-15"), [])).toEqual(D("2026-05-15")); // Friday
  });

  it("shifts a Saturday forward to Monday", () => {
    expect(shiftToNextBusinessDay(D("2026-08-15"), [])).toEqual(D("2026-08-17")); // Sat -> Mon
  });

  it("shifts a Sunday forward to Monday", () => {
    expect(shiftToNextBusinessDay(D("2026-08-30"), [])).toEqual(D("2026-08-31")); // Sun -> Mon
  });

  it("shifts past a holiday that falls on a weekday", () => {
    expect(shiftToNextBusinessDay(D("2026-11-15"), [D("2026-11-15")])).toEqual(D("2026-11-16")); // Sun, also treated as holiday -> Mon
  });
});
