import type { Period } from "./types";

/**
 * The only valid periods for a taxable year. There is no Q4 quarterly
 * return — the annual return covers the fourth quarter (SPEC.md 3.6).
 * Anything that enumerates periods to generate filings must iterate this
 * constant, never a hand-rolled list, so a Q4 filing is never possible
 * to construct by accident (SPEC.md 16 item 6).
 */
export const ALL_PERIODS: readonly Period[] = ["Q1", "Q2", "Q3", "ANNUAL"] as const;

/**
 * The first calendar day (UTC midnight) of a period. Q1-Q3 are calendar
 * quarters; ANNUAL spans the whole taxable year (there is no Q4 return —
 * the annual return covers it, see ALL_PERIODS above), so its start is
 * Jan 1, not Oct 1.
 */
export function periodStartDate(taxableYear: number, period: Period): Date {
  switch (period) {
    case "Q1":
      return new Date(Date.UTC(taxableYear, 0, 1));
    case "Q2":
      return new Date(Date.UTC(taxableYear, 3, 1));
    case "Q3":
      return new Date(Date.UTC(taxableYear, 6, 1));
    case "ANNUAL":
      return new Date(Date.UTC(taxableYear, 0, 1));
  }
}

/**
 * The last calendar day (UTC midnight) of a period, used as the cutoff
 * for cumulative "year-to-date through this period" aggregation. Pure
 * and deterministic — no timezone conversion here (that happens once, at
 * the display/input boundary, in lib/dates.ts).
 */
export function periodEndDate(taxableYear: number, period: Period): Date {
  switch (period) {
    case "Q1":
      return new Date(Date.UTC(taxableYear, 2, 31));
    case "Q2":
      return new Date(Date.UTC(taxableYear, 5, 30));
    case "Q3":
      return new Date(Date.UTC(taxableYear, 8, 30));
    case "ANNUAL":
      return new Date(Date.UTC(taxableYear, 11, 31));
  }
}

/** The periods strictly before `period` within the same taxable year. */
export function priorPeriodsOf(period: Period): readonly Period[] {
  const index = ALL_PERIODS.indexOf(period);
  return ALL_PERIODS.slice(0, index);
}
