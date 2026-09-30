import { describe, it, expect } from "vitest";
import {
  eafsDueDate,
  shiftToNextBusinessDay,
  shiftToPreviousBusinessDay,
  clientPaymentDueDate,
  resolveStatutoryDueDate,
  resolveAdjustedDueDate,
  deriveWorkingCalendar,
  clientDocsDueDate,
  type DueDateRuleSet,
} from "@/lib/tax/deadlines";

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

  it("still detects a weekend correctly for a real (non-midnight) timestamp, e.g. eafsDueDate's filedAt input", () => {
    // 2026-08-15 (Sat) 23:00 Manila = 2026-08-15T15:00:00.000Z -- a raw
    // getUTCDay() on this instant still reads Saturday here, but the
    // adjacent case below (early-Manila-morning) is where a naive
    // UTC-component read breaks.
    const satNightManila = new Date("2026-08-15T15:00:00.000Z");
    expect(shiftToNextBusinessDay(satNightManila, [])).toEqual(D("2026-08-17"));

    // 2026-08-17 (Mon) 03:00 Manila = 2026-08-16T19:00:00.000Z -- UTC still
    // reads Sunday the 16th here. A raw getUTCDay()-based isWeekend would
    // wrongly shift this Monday instant forward to Tuesday. The result is
    // normalized to clean UTC midnight of the correct Manila day (Aug 17),
    // not the original instant's time-of-day.
    const earlyMondayManila = new Date("2026-08-16T19:00:00.000Z");
    expect(shiftToNextBusinessDay(earlyMondayManila, [])).toEqual(D("2026-08-17"));
  });

  it("still detects a seeded holiday correctly for a real (non-midnight) timestamp, not just an exact-instant match", () => {
    // Holiday seeded as clean UTC midnight; filedAt-style input for the
    // same Manila calendar day carries a real time-of-day. A raw
    // holidayTimes.has(current.getTime()) exact match would never fire.
    const holiday = D("2026-08-21"); // Friday, a weekday -- isolates the holiday check
    const filedAtStyleSameDay = new Date("2026-08-21T05:00:00.000Z"); // Manila 13:00
    expect(shiftToNextBusinessDay(filedAtStyleSameDay, [holiday])).toEqual(D("2026-08-24")); // -> next Monday
  });
});

/**
 * Phase 3: general statutory-due-date generation, wired into real filing
 * generation (lib/workflow/filingGeneration.ts) — not just eAFS anymore.
 * Cross-checked against prisma/seed.ts's independently hand-verified
 * TY2026 DUE table (SPEC.md 3.6, Phase 2b P6).
 */
describe("resolveStatutoryDueDate / resolveAdjustedDueDate", () => {
  const RULE_SET: DueDateRuleSet = {
    q1DueMonthDay: "05-15",
    q2DueMonthDay: "08-15",
    q3DueMonthDay: "11-15",
    annualDueMonthDay: "04-15",
  };

  it("Q1 2026: statutory May 15 (Friday), no shift", () => {
    const statutory = resolveStatutoryDueDate(2026, "Q1", RULE_SET);
    expect(statutory).toEqual(D("2026-05-15"));
    expect(resolveAdjustedDueDate(statutory, [])).toEqual(D("2026-05-15"));
  });

  it("Q2 2026: statutory Aug 15 (Saturday) shifts to adjusted Aug 17", () => {
    const statutory = resolveStatutoryDueDate(2026, "Q2", RULE_SET);
    expect(statutory).toEqual(D("2026-08-15"));
    expect(resolveAdjustedDueDate(statutory, [])).toEqual(D("2026-08-17"));
  });

  it("Q3 2026: statutory Nov 15 (Sunday) shifts to adjusted Nov 16", () => {
    const statutory = resolveStatutoryDueDate(2026, "Q3", RULE_SET);
    expect(statutory).toEqual(D("2026-11-15"));
    expect(resolveAdjustedDueDate(statutory, [])).toEqual(D("2026-11-16"));
  });

  it("ANNUAL 2026: statutory due date falls in 2027, not 2026 (of the following year)", () => {
    const statutory = resolveStatutoryDueDate(2026, "ANNUAL", RULE_SET);
    expect(statutory).toEqual(D("2027-04-15"));
  });

  it("statutory due date shifts against a seeded holiday even when not a weekend", () => {
    // A hypothetical mid-week holiday landing exactly on the statutory date.
    const statutory = resolveStatutoryDueDate(2026, "Q1", RULE_SET); // Friday, no weekend shift
    expect(resolveAdjustedDueDate(statutory, [D("2026-05-15")])).toEqual(D("2026-05-18")); // -> Monday
  });
});

/**
 * Phase 3: deriveWorkingCalendar generalizes the pattern prisma/seed.ts's
 * WORKING_CALENDAR literals hand-encoded for TY2026 only (Phase 2b P7) —
 * cross-checked against those exact figures here.
 */
describe("deriveWorkingCalendar", () => {
  // D106 (brief #5s): certificatesExpectedBy is the client's document deadline from her engagement letter --
  // the 20th of the month after the period ends, for every period, with no weekend/holiday shift.
  it("Q1: documents due Apr 20; internalFilingTarget is the adjusted due date (D14)", () => {
    const result = deriveWorkingCalendar("Q1", 2026, D("2026-05-15"), D("2026-05-15"), 20);
    expect(result).toEqual({ certificatesExpectedBy: D("2026-04-20"), internalFilingTarget: D("2026-05-15") });
  });

  it("Q2: documents due Jul 20; internalFilingTarget is the ADJUSTED due date (Aug 17), no internal buffer", () => {
    const result = deriveWorkingCalendar("Q2", 2026, D("2026-08-15"), D("2026-08-17"), 20);
    expect(result).toEqual({ certificatesExpectedBy: D("2026-07-20"), internalFilingTarget: D("2026-08-17") });
  });

  it("Q3: documents due Oct 20; internalFilingTarget is the adjusted due date (Nov 16)", () => {
    const result = deriveWorkingCalendar("Q3", 2026, D("2026-11-15"), D("2026-11-16"), 20);
    expect(result).toEqual({ certificatesExpectedBy: D("2026-10-20"), internalFilingTarget: D("2026-11-16") });
  });

  it("ANNUAL 2026: documents due Jan 20, 2027; internalFilingTarget stays Mar 31 (D14)", () => {
    const result = deriveWorkingCalendar("ANNUAL", 2026, D("2027-04-15"), D("2027-04-15"), 20);
    expect(result).toEqual({ certificatesExpectedBy: D("2027-01-20"), internalFilingTarget: D("2027-03-31") });
  });

  it("changing the setting moves all four dates", () => {
    expect(clientDocsDueDate("Q1", 2026, 18)).toEqual(D("2026-04-18"));
    expect(clientDocsDueDate("Q2", 2026, 18)).toEqual(D("2026-07-18"));
    expect(clientDocsDueDate("Q3", 2026, 18)).toEqual(D("2026-10-18"));
    expect(clientDocsDueDate("ANNUAL", 2026, 18)).toEqual(D("2027-01-18"));
  });

  it("does not shift for a weekend: Oct 20, 2029 is a Saturday and stays Oct 20", () => {
    expect(clientDocsDueDate("Q3", 2029, 20)).toEqual(D("2029-10-20"));
  });
});

/**
 * Brief #5e §9 -- the CLIENT-facing due date shown in step 4's advice
 * message: adjustedDueDate minus TaxRuleSet.clientPaymentLeadDays calendar
 * days, shifted EARLIER (never later) on a weekend/holiday. Display-only:
 * never changes adjustedDueDate/internalFilingTarget themselves.
 */
describe("clientPaymentDueDate", () => {
  it("Q3 2026: BIR due date Nov 16, 2026 minus 10 days -> Nov 6, 2026 (a Friday, no shift needed)", () => {
    const result = clientPaymentDueDate(D("2026-11-16"), 10, []);
    expect(result).toEqual(D("2026-11-06"));
  });

  it("a raw date landing on a Sunday moves back to the preceding Friday", () => {
    // 2026-11-25 minus 10 days = 2026-11-15, a Sunday (the same Sunday
    // Q3's own statutory due date falls on and shifts forward from).
    const result = clientPaymentDueDate(D("2026-11-25"), 10, []);
    expect(result).toEqual(D("2026-11-13")); // Sunday 15th -> Saturday 14th -> Friday 13th
  });

  it("a raw date landing on a seeded holiday moves back to the preceding working day", () => {
    // 2026-04-19 minus 10 days = 2026-04-09, Araw ng Kagitingan (a real
    // seeded national holiday, a Thursday) -> shifts back to Wednesday
    // 2026-04-08, which is neither a weekend nor a holiday.
    const result = clientPaymentDueDate(D("2026-04-19"), 10, [D("2026-04-09")]);
    expect(result).toEqual(D("2026-04-08"));
  });

  it("never shifts later -- shiftToPreviousBusinessDay only ever moves a date backward", () => {
    const result = shiftToPreviousBusinessDay(D("2026-11-15"), []); // a Sunday
    expect(result.getTime()).toBeLessThanOrEqual(D("2026-11-15").getTime());
    expect(result).toEqual(D("2026-11-13"));
  });
});
