import type { DocSlotDef } from "./types";

/**
 * D200 (brief #6u) — step 11 ("Alphalist data entry + validation") takes one
 * validation file per month, not a report and a DAT file. PURE: plain objects
 * in, plain objects out, no I/O (the loader is validationMonthsData.ts).
 *
 * The month rides in the document slot code ("validation_2026-07"), so no
 * column, no migration and no backfill is needed: old rows keep their stored
 * slots, which the code simply no longer reads for this step.
 */

export const VALIDATION_SLOT_PREFIX = "validation_";
/** The two slot codes step 11 used before D200. Their files stay (read-only once the step is Done). */
export const LEGACY_STEP11_SLOT_CODES: readonly string[] = ["generated_report", "dat_file"];
export const LEGACY_STEP11_SLOT_LABELS: Record<string, string> = { generated_report: "Alphalist report", dat_file: "DAT file" };

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface YearMonth {
  year: number;
  /** 1–12 */
  month: number;
}

/** The three calendar months a filing covers for step 11: Q1 Jan–Mar, Q2 Apr–Jun, Q3 Jul–Sep, Annual Oct–Dec only. */
export function filingMonths(period: string, taxableYear: number): YearMonth[] {
  const first = period === "Q1" ? 1 : period === "Q2" ? 4 : period === "Q3" ? 7 : 10;
  return [0, 1, 2].map((i) => ({ year: taxableYear, month: first + i }));
}

export function monthLabel(m: YearMonth): string {
  return `${MONTH_NAMES[m.month - 1]} ${m.year}`;
}

export function validationSlotCode(m: YearMonth): string {
  return `${VALIDATION_SLOT_PREFIX}${m.year}-${String(m.month).padStart(2, "0")}`;
}

export function isValidationSlotCode(code: string | null | undefined): boolean {
  return !!code && /^validation_\d{4}-(0[1-9]|1[0-2])$/.test(code);
}

export function isLegacyStep11SlotCode(code: string | null | undefined): boolean {
  return !!code && LEGACY_STEP11_SLOT_CODES.includes(code);
}

/** "YYYY-MM-DD" (a Manila calendar day) → its month. */
function monthOfDay(day: string): YearMonth {
  return { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) };
}

const ordinal = (m: YearMonth) => m.year * 12 + (m.month - 1);

export interface ValidationMonthsResult {
  months: YearMonth[];
  /** True when certificates exist but none touched a month of the filing, so every month of the period is listed. */
  fellBack: boolean;
}

/**
 * Every month of the filing's own period touched by at least one certificate's
 * period from → to (clipped to the filing's months), in calendar order.
 * `certificates` carry Manila calendar days ("YYYY-MM-DD"). No certificates → no
 * months (the step is NA then, D93). Certificates present but none touching →
 * every month of the filing's period.
 */
export function validationMonthsForFiling(input: {
  period: string;
  taxableYear: number;
  certificates: { periodFromDay: string; periodToDay: string }[];
}): ValidationMonthsResult {
  const all = filingMonths(input.period, input.taxableYear);
  if (input.certificates.length === 0) return { months: [], fellBack: false };
  const touched = new Set<number>();
  for (const c of input.certificates) {
    const from = ordinal(monthOfDay(c.periodFromDay));
    const to = ordinal(monthOfDay(c.periodToDay));
    for (const m of all) {
      const o = ordinal(m);
      if (o >= Math.min(from, to) && o <= Math.max(from, to)) touched.add(o);
    }
  }
  const months = all.filter((m) => touched.has(ordinal(m)));
  return months.length > 0 ? { months, fellBack: false } : { months: all, fellBack: true };
}

/** The required slot definitions for those months: label "July 2026", code "validation_2026-07". */
export function validationSlotDefs(months: YearMonth[]): DocSlotDef[] {
  return months.map((m) => ({ slotCode: validationSlotCode(m), label: monthLabel(m), required: true, acceptedTypes: [] }));
}

/**
 * D200 — an older step 11 that was completed with a report and a DAT file and has no monthly file. It stays Done:
 * no upload boxes, its files listed read-only. `docs` are the step's non-deleted documents.
 */
export function isLegacyDoneStep11(status: string, docs: { docSlotCode: string | null }[]): boolean {
  return (
    status === "DONE" &&
    docs.length > 0 &&
    !docs.some((d) => isValidationSlotCode(d.docSlotCode)) &&
    docs.some((d) => isLegacyStep11SlotCode(d.docSlotCode))
  );
}
