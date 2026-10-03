/**
 * D171 — what the New rule set form prefills. One list, read by the form and
 * checked by a test against the seeded 2026 rule set, so a default can't drift
 * from the real dates again (Q1 once read 04-15 instead of 05-15).
 */
export const RULE_SET_DEFAULTS = {
  incomeTaxRatePercent: "8.00",
  vatThreshold: "3,000,000.00",
  allowableDeduction: "250,000.00",
  q1DueMonthDay: "05-15",
  q2DueMonthDay: "08-15",
  q3DueMonthDay: "11-15",
  annualDueMonthDay: "04-15", // of the following year
  sawtDeadlineOffsetDays: "0",
  eafsDeadlineOffsetDays: "15",
  eSubmissionEmail: "esubmission@bir.gov.ph",
  clientDocsDueDay: "20",
} as const;

/**
 * D168 — the New rule set form's "Effective from" follows the taxable year typed
 * (January 1 of that year) until she changes it herself. Pure; the form calls it.
 */
export function defaultEffectiveFrom(taxableYearText: string): string | null {
  const t = taxableYearText.trim();
  if (!/^\d{4}$/.test(t)) return null;
  const year = Number(t);
  if (year < 2000 || year > 2100) return null;
  return `${t}-01-01`;
}

/** The Effective from value after the taxable year field changes. A hand-edited date (or a stored one on Edit) never moves. */
export function effectiveFromAfterYearChange(args: {
  yearText: string;
  current: string;
  followsYear: boolean;
}): string {
  if (!args.followsYear) return args.current;
  return defaultEffectiveFrom(args.yearText) ?? args.current;
}
