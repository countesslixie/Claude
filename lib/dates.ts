import { DateTime } from "luxon";

/**
 * All date arithmetic in this app uses Asia/Manila. Timestamps are stored
 * as UTC in SQLite (Prisma default); conversion happens only at this
 * boundary. Never use the host's local timezone (see SPEC.md section 3.6).
 */
export const MANILA_ZONE = "Asia/Manila";

export function nowManila(): DateTime {
  return DateTime.now().setZone(MANILA_ZONE);
}

/** Parses a "YYYY-MM-DD" form input (interpreted as a Manila calendar date) into a JS Date for Prisma. */
export function manilaDateInputToJsDate(value: string): Date {
  const dt = DateTime.fromISO(value, { zone: MANILA_ZONE }).startOf("day");
  if (!dt.isValid) {
    throw new Error(`Invalid date: ${value}`);
  }
  return dt.toJSDate();
}

/** Formats a stored Date/DateTime for display as a Manila calendar date, e.g. "Apr 15, 2026". */
export function formatManilaDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const dt =
    typeof value === "string"
      ? DateTime.fromISO(value, { zone: "utc" }).setZone(MANILA_ZONE)
      : DateTime.fromJSDate(value, { zone: "utc" }).setZone(MANILA_ZONE);
  return dt.isValid ? dt.toFormat("MMM d, yyyy") : "—";
}

/**
 * The Asia/Manila calendar day a stored instant falls on, as "yyyy-MM-dd"
 * -- for comparing two dates by calendar day rather than raw instant. Two
 * Dates that fall on the same Manila day but carry different times-of-day
 * (e.g. a clean UTC-midnight due-date marker vs. a real `filedAt`
 * timestamp) are NOT equal under `.getTime()`, and a raw `a.getTime() >
 * b.getTime()` comparison between them does not mean "a is a later
 * calendar day" -- it can trip on the same day depending on time-of-day.
 * String comparison on this format sorts correctly (ISO 8601 date order).
 */
export function manilaCalendarDay(value: Date): string {
  return DateTime.fromJSDate(value).setZone(MANILA_ZONE).toFormat("yyyy-MM-dd");
}

/** Formats a stored Date/DateTime as a "YYYY-MM-DD" string for date input defaultValue. */
export function toManilaDateInputValue(value: Date | string | null | undefined): string {
  if (!value) return "";
  const dt =
    typeof value === "string"
      ? DateTime.fromISO(value, { zone: "utc" }).setZone(MANILA_ZONE)
      : DateTime.fromJSDate(value, { zone: "utc" }).setZone(MANILA_ZONE);
  return dt.isValid ? dt.toFormat("yyyy-MM-dd") : "";
}

export function currentTaxableYearManila(): number {
  return nowManila().year;
}

/**
 * The taxable year and quarter a transaction date falls in, by its Asia/
 * Manila calendar date. `transactionDate` is normally
 * manilaDateInputToJsDate()'s output -- Manila midnight, which is always
 * UTC 16:00 the PREVIOUS day -- so reading getUTCFullYear()/getUTCMonth()
 * straight off it reads the wrong Manila calendar month/year whenever the
 * 1st of a month is involved (any date's Manila midnight crosses a UTC
 * month/year boundary exactly when the date itself is the 1st): a
 * transaction dated Manila Apr 1 would read UTC Mar 31 and be misfiled as
 * Q1, and one dated Manila Jan 1 would read UTC Dec 31 of the PREVIOUS
 * year and be misfiled into Q4 of the wrong taxable year -- a period this
 * app has no filing type for (SPEC.md 3.6: no Q4 return). Extract the
 * Manila calendar date instead. Exported (not just used inline in
 * lib/actions/salesTransactions.ts) so scripts/ can re-derive and audit
 * already-stored SalesTransaction.taxableYear/quarter values against it.
 */
export function deriveTaxableYearAndQuarter(transactionDate: Date): { taxableYear: number; quarter: number } {
  const manila = DateTime.fromJSDate(transactionDate).setZone(MANILA_ZONE);
  const taxableYear = manila.year;
  const quarter = Math.ceil(manila.month / 3);
  return { taxableYear, quarter };
}
