/**
 * eAFS deadline derivation (SPEC.md 3.6, Phase 2b P6). Pure functions,
 * plain object in, plain object out (SPEC.md section 4, 6) — the caller
 * supplies holiday dates and "today" as plain Dates; this module never
 * touches Prisma or the clock itself.
 *
 * Scoped narrowly to what eafsDueDate needs. This is NOT a general
 * statutory-due-date generator — prisma/seed.ts's DUE table still
 * hand-computes statutory/adjusted due dates against the seeded Holiday
 * table (SPEC.md 3.6: "never compute holidays algorithmically"), and that
 * stays true after this change. Only the eAFS offset-and-shift logic is
 * implemented here.
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
