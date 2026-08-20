import type { Period } from "./types";

/**
 * The only valid periods for a taxable year. There is no Q4 quarterly
 * return — the annual return covers the fourth quarter (SPEC.md 3.6).
 * Anything that enumerates periods to generate filings must iterate this
 * constant, never a hand-rolled list, so a Q4 filing is never possible
 * to construct by accident (SPEC.md 16 item 6).
 */
export const ALL_PERIODS: readonly Period[] = ["Q1", "Q2", "Q3", "ANNUAL"] as const;
