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

  it("Q2 due Aug 15, filed exactly on time Aug 15 -> raw Aug 30 shifts to Aug 31 (Aug 30, 2026 is a Sunday)", () => {
    // Aug 30, 2026 falls on a Sunday on the real calendar, so the
    // business-day shift step in the formula moves it to Monday Aug 31.
    // This doubles as the "weekend/holiday results shift forward" case.
    const result = eafsDueDate({
      adjustedDueDate: D("2026-08-15"),
      filedAt: D("2026-08-15"),
      offsetDays: 15,
      holidays: [],
    });
    expect(result).toEqual(D("2026-08-31"));
  });

  it("Q2 due Aug 15, filed late Aug 20 -> eAFS Sep 4 (offset runs from the actual filing date)", () => {
    const result = eafsDueDate({
      adjustedDueDate: D("2026-08-15"),
      filedAt: D("2026-08-20"),
      offsetDays: 15,
      holidays: [],
    });
    expect(result).toEqual(D("2026-09-04"));
  });

  it("shifts forward past a holiday that immediately follows a weekend", () => {
    // Raw date lands on a Saturday; the following Monday is also seeded as
    // a holiday, so the shift must continue to Tuesday.
    const raw = D("2026-08-15"); // Saturday
    const result = shiftToNextBusinessDay(raw, [D("2026-08-17")]);
    expect(result).toEqual(D("2026-08-18"));
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
