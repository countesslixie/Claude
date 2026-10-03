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
