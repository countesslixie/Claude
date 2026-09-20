import type { Period, SalesQuarter } from "./types";

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

/**
 * The 1-4 quarter numbers a period covers. Used wherever a query needs
 * to match against Form2307.quarterCovered, which is always a raw 1-4
 * (there is no "quarter" for an annual row) — unlike Filing.period, which
 * is the Q1/Q2/Q3/ANNUAL enum. Q1-Q3 cover their own single quarter;
 * ANNUAL covers the whole year, all four.
 */
export function periodToQuarters(period: Period): readonly number[] {
  switch (period) {
    case "Q1":
      return [1];
    case "Q2":
      return [2];
    case "Q3":
      return [3];
    case "ANNUAL":
      return [1, 2, 3, 4];
  }
}

/**
 * D26/SPEC.md 3.2 — the cumulative mapping from a filing period to the
 * declared-sales quarters (QuarterlySales.quarter) it sums, Jan 1 through
 * the end of the period. Unlike periodToQuarters above (a single
 * quarter's worth of certificates), this is genuinely cumulative: Q2
 * sums Q1+Q2, Q3 sums Q1+Q2+Q3, and ANNUAL sums all four — including Q4,
 * which has no filing period of its own. A QuarterlySales row that
 * doesn't exist for one of these quarters contributes zero, not an error
 * (the caller's query simply won't find a row for it).
 */
export function cumulativeSalesQuartersThroughPeriod(period: Period): readonly SalesQuarter[] {
  switch (period) {
    case "Q1":
      return ["Q1"];
    case "Q2":
      return ["Q1", "Q2"];
    case "Q3":
      return ["Q1", "Q2", "Q3"];
    case "ANNUAL":
      return ["Q1", "Q2", "Q3", "Q4"];
  }
}

/**
 * The last calendar day (UTC midnight) of a sales quarter — the
 * QuarterlySales analogue of periodEndDate above. Q1-Q3 share their
 * calendar quarter's end date with the matching filing Period; Q4 has no
 * filing period of its own, so its end date is Dec 31, the same date
 * periodEndDate(taxableYear, "ANNUAL") returns.
 */
export function salesQuarterEndDate(taxableYear: number, quarter: SalesQuarter): Date {
  if (quarter === "Q4") return new Date(Date.UTC(taxableYear, 11, 31));
  return periodEndDate(taxableYear, quarter);
}
