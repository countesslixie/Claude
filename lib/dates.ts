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
