import type { Period } from "@/lib/tax/types";
import { periodEndDate } from "@/lib/tax/periods";
import { manilaCalendarDay } from "@/lib/dates";

/**
 * D130 — a filing is listed under the dashboard's "Waiting on client" only
 * once its period has ended (the Annual from January 1). Before that there is
 * nothing for the client to hand over yet.
 */
export function periodHasEnded(taxableYear: number, period: Period, now: Date): boolean {
  return manilaCalendarDay(now) > manilaCalendarDay(periodEndDate(taxableYear, period));
}

/** D130 — a client wait's Due is the date the client's documents are due (Filing.certificatesExpectedBy, D106). */
export function clientWaitDueDate(certificatesExpectedBy: Date | null, fallback: Date): Date {
  return certificatesExpectedBy ?? fallback;
}
