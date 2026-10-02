import { prisma } from "@/lib/prisma";
import { getStartingFigures } from "@/lib/startingFigures";
import type { SalesQuarter } from "@/lib/tax/types";

/**
 * D158 — the ONE reader of a client's declared income for a taxable year,
 * shared by the Income table and the certificates-vs-declared-sales check
 * (lib/reconciliation.ts), so the two can never show different totals (the
 * ₱300,000 vs ₱600,000 Gloria Tolentino saw: the old Income page summed only
 * the quarters entered in the app and left out her starting figures).
 *
 * "Previous quarters" is the starting figures' outside return (D56), derived
 * exactly as lib/filingComputation.ts does (`cumulative − non-operating`):
 * declared sales so far = item 51 minus its non-operating slice. Nothing here
 * feeds a computation; it only reads.
 */
export interface DeclaredIncomeRow {
  quarter: SalesQuarter;
  grossSalesCents: number;
  nonOperatingIncomeCents: number;
  noSalesThisQuarter: boolean;
}

export interface DeclaredIncome {
  taxableYear: number;
  /** null unless the year's starting figures name an outside return. */
  previousQuarters: { grossSalesCents: number; nonOperatingIncomeCents: number } | null;
  /** Only the quarters that have a saved row (draft or final), in the app. */
  rows: DeclaredIncomeRow[];
  grossSalesTotalCents: number;
  nonOperatingTotalCents: number;
}

/** Item 51 (cumulative income) minus its non-operating slice — the same derivation filingComputation.ts uses. */
export function previousQuartersFromStartingFigures(sf: {
  latestOutsideReturn: string;
  cumulativeIncomeCents: number;
  nonOperatingIncomeCents: number;
} | null): { grossSalesCents: number; nonOperatingIncomeCents: number } | null {
  if (!sf || sf.latestOutsideReturn === "NONE") return null;
  return { grossSalesCents: sf.cumulativeIncomeCents - sf.nonOperatingIncomeCents, nonOperatingIncomeCents: sf.nonOperatingIncomeCents };
}

export async function getDeclaredIncome(clientId: string, taxableYear: number): Promise<DeclaredIncome> {
  const [salesRows, startingFigures] = await Promise.all([
    prisma.quarterlySales.findMany({ where: { clientId, taxableYear }, orderBy: { quarter: "asc" } }),
    getStartingFigures(clientId, taxableYear),
  ]);
  const previousQuarters = previousQuartersFromStartingFigures(startingFigures);
  const rows: DeclaredIncomeRow[] = salesRows.map((r) => ({
    quarter: r.quarter as SalesQuarter,
    grossSalesCents: r.grossSalesCents,
    nonOperatingIncomeCents: r.nonOperatingIncomeCents,
    noSalesThisQuarter: r.noSalesThisQuarter,
  }));
  return {
    taxableYear,
    previousQuarters,
    rows,
    grossSalesTotalCents: (previousQuarters?.grossSalesCents ?? 0) + rows.reduce((s, r) => s + r.grossSalesCents, 0),
    nonOperatingTotalCents: (previousQuarters?.nonOperatingIncomeCents ?? 0) + rows.reduce((s, r) => s + r.nonOperatingIncomeCents, 0),
  };
}

export type IncomeQuarterStatus = "NOT_ENTERED" | "DRAFT" | "SAVED" | "FILED";

/** D158 — the plain status words on the Income table: no row → Not yet entered; a row not yet final → Draft; final (step 1 Done) → Saved; its return filed (step 5 Done) → Filed. */
export function incomeQuarterStatus(input: { hasRow: boolean; finalized: boolean; filed: boolean }): IncomeQuarterStatus {
  if (input.filed) return "FILED";
  if (!input.hasRow) return "NOT_ENTERED";
  return input.finalized ? "SAVED" : "DRAFT";
}

export const INCOME_QUARTER_STATUS_LABEL: Record<IncomeQuarterStatus, string> = {
  NOT_ENTERED: "Not yet entered",
  DRAFT: "Draft",
  SAVED: "Saved",
  FILED: "Filed",
};
