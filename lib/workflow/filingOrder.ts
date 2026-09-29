import { ALL_PERIODS, outsidePeriodsFor, priorPeriodsOf } from "@/lib/tax/periods";
import type { LatestOutsideReturn, Period } from "@/lib/tax/types";

/**
 * D95 (brief #5q) — quarters are filed in order: step 5 (FILE_RETURN) can't be
 * marked Done while any earlier return of the same client and taxable year is
 * unfiled. Pure — no I/O. The data comes from `loadFilingOrderContext` below
 * (or, in tests, an inline fixture).
 *
 * An earlier return counts as filed when any of these holds:
 *   - its own step 5 is Done;
 *   - its Filing row has filedOutsideApp: true;
 *   - it has no Filing row and the starting figures' latestOutsideReturn names
 *     that period as filed outside the app (D56).
 * An earlier return with no Filing row and no starting-figures coverage counts
 * as NOT filed (refused).
 */
export interface FilingOrderSibling {
  /** Filing id, when known — lets the page link to the earlier filing. */
  id?: string;
  period: string;
  filedOutsideApp: boolean;
  /** Status of that filing's FILE_RETURN step, if it has one. */
  fileReturnStatus: string | null;
}

export interface FilingOrderContext {
  taxableYear: number;
  period: string;
  siblings: FilingOrderSibling[];
  latestOutsideReturn: LatestOutsideReturn;
}

/** The earlier periods of the same year that are not yet filed, in order. */
export function unfiledEarlierPeriods(ctx: FilingOrderContext): Period[] {
  if (!(ALL_PERIODS as readonly string[]).includes(ctx.period)) return [];
  const outside = new Set<Period>(outsidePeriodsFor(ctx.latestOutsideReturn));
  return priorPeriodsOf(ctx.period as Period).filter((p) => {
    const row = ctx.siblings.find((s) => s.period === p);
    if (!row) return !outside.has(p);
    return !(row.filedOutsideApp || row.fileReturnStatus === "DONE");
  });
}

function periodList(periods: Period[]): string {
  const names = periods.map((p) => (p === "ANNUAL" ? "Annual" : p));
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "File Q1 2026 first." / "File Q1 and Q2 2026 first." — null when nothing earlier is unfiled. */
export function filingOrderBlockReason(ctx: FilingOrderContext): string | null {
  const missing = unfiledEarlierPeriods(ctx);
  return missing.length === 0 ? null : `File ${periodList(missing)} ${ctx.taxableYear} first.`;
}

/** The earliest unfiled earlier period, for the "go to the earlier filing" link. */
export function firstUnfiledEarlierPeriod(ctx: FilingOrderContext): Period | null {
  return unfiledEarlierPeriods(ctx)[0] ?? null;
}
