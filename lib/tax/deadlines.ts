import { DateTime } from "luxon";
import { manilaCalendarDay } from "@/lib/dates";
import type { Period } from "./types";

const MANILA_ZONE = "Asia/Manila";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Deadline derivation (SPEC.md 3.6). Pure functions, plain object in,
 * plain object out (SPEC.md section 4, 6) — the caller supplies rule-set
 * values, holiday dates, and "today" as plain data; this module never
 * touches Prisma or the clock itself.
 *
 * prisma/seed.ts's own DUE table for the TY2026 demo cycle stays
 * hand-computed rather than switching to resolveStatutoryDueDate() below
 * — it's an independent, hand-verified cross-check of this module, the
 * same reasoning as the seed's money literals (Phase 2b P2). Real filing
 * generation (Phase 3, lib/workflow/filingGeneration.ts) uses these
 * functions; "never compute holidays algorithmically" (SPEC.md 3.6) still
 * holds — the Holiday table itself is always seeded/hand-maintained, only
 * the shifting logic against that table is computed.
 */

/**
 * Shifts `date` forward, day by day (by Asia/Manila calendar day), until
 * it lands on a weekday that is not in `holidays`. Weekend = Saturday/
 * Sunday. Callers in this codebase normally pass UTC-midnight-aligned
 * dates, but `eafsDueDate` below can pass `filedAt` -- a real timestamp
 * that, once wired to a "mark as filed" action, will carry a genuine
 * time-of-day. The result is always normalized to a clean UTC-midnight
 * value representing the correct Manila calendar day it lands on --
 * consistent with how every other due date in this app is stored --
 * rather than carrying forward `date`'s original time-of-day. Comparing
 * calendar day/weekday via Manila-zone conversion (not raw UTC components
 * or exact-instant Set membership) keeps this correct regardless of
 * input: a raw `.getTime()` holiday match would silently never fire for a
 * non-midnight instant, and raw `.getUTCDay()` can read the wrong weekday
 * for anything in Manila's 00:00-07:59 window (still the previous UTC
 * day).
 */
export function shiftToNextBusinessDay(date: Date, holidays: readonly Date[]): Date {
  const holidayManilaDays = new Set(holidays.map(manilaCalendarDay));
  let current = toManilaMidnightUtc(date);
  while (isWeekend(current) || holidayManilaDays.has(manilaCalendarDay(current))) {
    current = addDays(current, 1);
  }
  return current;
}

/** The UTC-midnight instant representing `date`'s Asia/Manila calendar day. */
function toManilaMidnightUtc(date: Date): Date {
  const manila = DateTime.fromJSDate(date).setZone(MANILA_ZONE);
  return new Date(Date.UTC(manila.year, manila.month - 1, manila.day));
}

function isWeekend(date: Date): boolean {
  const weekday = DateTime.fromJSDate(date).setZone(MANILA_ZONE).weekday; // Luxon: 1=Mon...7=Sun
  return weekday === 6 || weekday === 7;
}

// Plain millisecond arithmetic. Correct for any input, midnight-aligned
// or not: the Philippines observes no DST, so a calendar day is always
// exactly 24h and this always lands on the right Manila calendar day N
// days later. (shiftToNextBusinessDay separately normalizes its result to
// a clean UTC-midnight value -- see toManilaMidnightUtc -- for output
// consistency, not because this arithmetic would otherwise be wrong.)
function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/**
 * Derives a filing's eAFS submission deadline.
 *
 *   base = (filedAt is null OR filedAt <= adjustedDueDate) ? adjustedDueDate : filedAt
 *   raw  = base + offsetDays
 *   return shiftToNextBusinessDay(raw, holidays)
 *
 * Filing EARLY never moves the deadline earlier: an unfiled filing, or one
 * filed on or before its adjusted due date, still counts the offset from
 * the due date itself. Only filing LATE (after the due date) pushes the
 * eAFS deadline out further, counting the offset from the actual filing
 * date instead. offsetDays comes from TaxRuleSet.eafsDeadlineOffsetDays —
 * never hardcoded here.
 */
export function eafsDueDate(input: {
  adjustedDueDate: Date;
  filedAt: Date | null;
  offsetDays: number;
  holidays: readonly Date[];
}): Date {
  // Calendar-day comparison, not raw instant: adjustedDueDate is a clean
  // UTC-midnight marker (Manila 08:00), but filedAt is a real timestamp
  // once wired to a "mark as filed" action. Filing at any time on the due
  // date itself -- including Manila evening, a LATER instant than the due
  // date's UTC-midnight marker -- must still count as "on or before," not
  // "late," per this function's own doc comment above. Note: because
  // shiftToNextBusinessDay's result is always normalized to a clean
  // Manila-day value (see toManilaMidnightUtc), the two possible base
  // choices only ever disagree within the SAME Manila calendar day, and a
  // same-day base + a whole-day offsetDays always lands on the same final
  // calendar day either way -- so this comparison has no independently
  // observable effect on eafsDueDate's return value today. It stays
  // calendar-day-correct anyway: relying on a downstream normalization
  // step to silently paper over an upstream instant-vs-calendar-day bug
  // is fragile, and this is what the function's own contract states.
  const base =
    input.filedAt === null || manilaCalendarDay(input.filedAt) <= manilaCalendarDay(input.adjustedDueDate)
      ? input.adjustedDueDate
      : input.filedAt;
  const raw = addDays(base, input.offsetDays);
  return shiftToNextBusinessDay(raw, input.holidays);
}

export interface DueDateRuleSet {
  /** "MM-DD" strings, e.g. "05-15" (SPEC.md 3.6, TaxRuleSet.q1DueMonthDay etc). */
  q1DueMonthDay: string;
  q2DueMonthDay: string;
  q3DueMonthDay: string;
  /** "MM-DD" of the FOLLOWING taxable year (SPEC.md 5: TaxRuleSet.annualDueMonthDay). */
  annualDueMonthDay: string;
}

function parseMonthDay(monthDay: string, year: number): Date {
  const [month, day] = monthDay.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * The statutory due date for a period, before any business-day shift.
 * ANNUAL's due date falls in taxableYear + 1 (SPEC.md 3.6: "April 15 of
 * the following year") — every other period is in taxableYear itself.
 */
export function resolveStatutoryDueDate(taxableYear: number, period: Period, ruleSet: DueDateRuleSet): Date {
  switch (period) {
    case "Q1":
      return parseMonthDay(ruleSet.q1DueMonthDay, taxableYear);
    case "Q2":
      return parseMonthDay(ruleSet.q2DueMonthDay, taxableYear);
    case "Q3":
      return parseMonthDay(ruleSet.q3DueMonthDay, taxableYear);
    case "ANNUAL":
      return parseMonthDay(ruleSet.annualDueMonthDay, taxableYear + 1);
  }
}

/**
 * A filing's adjusted (legally authoritative) due date: the statutory due
 * date, business-day shifted against the Holiday table (SPEC.md 3.6).
 * General-purpose — this is the same shiftToNextBusinessDay() eafsDueDate()
 * uses above, just applied to the statutory date instead of an eAFS offset.
 */
export function resolveAdjustedDueDate(statutoryDueDate: Date, holidays: readonly Date[]): Date {
  return shiftToNextBusinessDay(statutoryDueDate, holidays);
}

export interface WorkingCalendar {
  certificatesExpectedBy: Date;
  internalFilingTarget: Date;
}

/**
 * The bookkeeper's working-calendar practice targets for a period
 * (SPEC.md 3.6, Phase 2b P7) — distinct from and never overriding the
 * statutory/adjusted due date. Quarterly returns: internalFilingTarget is
 * the ADJUSTED (business-day-shifted) due date itself — no internal buffer
 * by design, the bookkeeper works to the normal deadline for quarterlies —
 * and certificatesExpectedBy is 10 days before the STATUTORY due date
 * (unshifted; a fixed lead time ahead of the normal deadline, not the
 * shifted one). ANNUAL keeps a real buffer instead: certificatesExpectedBy
 * Feb 15, internalFilingTarget Mar 31, of the same calendar year as the
 * ANNUAL statutory due date (which is itself already "of the following
 * year" relative to the taxable year — see resolveStatutoryDueDate above)
 * — ahead of the Apr 15 statutory/adjusted deadline.
 */
export function deriveWorkingCalendar(period: Period, statutoryDueDate: Date, adjustedDueDate: Date): WorkingCalendar {
  if (period === "ANNUAL") {
    const year = statutoryDueDate.getUTCFullYear();
    return {
      certificatesExpectedBy: new Date(Date.UTC(year, 1, 15)), // Feb 15
      internalFilingTarget: new Date(Date.UTC(year, 2, 31)), // Mar 31
    };
  }
  return {
    certificatesExpectedBy: addDays(statutoryDueDate, -10),
    internalFilingTarget: adjustedDueDate,
  };
}
