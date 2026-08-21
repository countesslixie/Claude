import type { Period } from "./types";

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
 * Shifts `date` forward, day by day, until it lands on a weekday that is
 * not in `holidays`. Weekend = Saturday/Sunday.
 */
export function shiftToNextBusinessDay(date: Date, holidays: readonly Date[]): Date {
  const holidayTimes = new Set(holidays.map((h) => h.getTime()));
  let current = date;
  while (isWeekend(current) || holidayTimes.has(current.getTime())) {
    current = addDays(current, 1);
  }
  return current;
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function addDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
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
  const base =
    input.filedAt === null || input.filedAt.getTime() <= input.adjustedDueDate.getTime()
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
