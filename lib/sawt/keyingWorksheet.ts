import type { Period } from "@/lib/tax/types";

/**
 * SAWT keying worksheet (SPEC.md 10) — mirrors the Alphalist Data Entry
 * Module's field order so the bookkeeper can key rows in without
 * re-arranging columns mentally, and check off each row against the
 * module as they go.
 *
 * Column order is this module's best-effort match to the standard BIR
 * Alphalist of Payees (Schedule 3) layout: payee TIN, registered name,
 * address, ATC, nature of income payment, amount of income payment,
 * amount of tax withheld. It has NOT been verified against the current
 * live Alphalist Data Entry Module screen — confirm against the actual
 * module before relying on the column order for fast keying (same
 * "don't invent BIR specifics without confirming" standard as the seed's
 * ATC reference table, SPEC.md 3.5).
 */
export interface KeyingWorksheetRow {
  rowNumber: number;
  certificateId: string;
  payorTin: string;
  payorName: string;
  payorAddress: string;
  atcCode: string;
  atcDescription: string;
  incomePaymentCents: number;
  taxWithheldCents: number;
  dateReceived: Date | null;
}

export interface KeyingWorksheetTotals {
  incomePaymentCents: number;
  taxWithheldCents: number;
}

export interface KeyingWorksheet {
  clientName: string;
  clientTin: string;
  taxableYear: number;
  period: Period;
  rows: KeyingWorksheetRow[];
  rowCount: number;
  totals: KeyingWorksheetTotals;
}

export interface CertificateForWorksheet {
  id: string;
  payorTin: string | null;
  payorName: string;
  payorAddress: string | null;
  atcCode: string;
  atcDescription: string;
  incomePaymentCents: number;
  taxWithheldCents: number;
  dateReceived: Date | null;
}

/**
 * Rows are ordered by dateReceived, the same order the bookkeeper
 * registered each certificate — the order they'd naturally re-key in.
 * rowCount and totals are the two numbers to check against the module's
 * own totals after entry (SPEC.md 10).
 */
export function buildKeyingWorksheet(input: {
  clientName: string;
  clientTin: string;
  taxableYear: number;
  period: Period;
  certificates: CertificateForWorksheet[];
}): KeyingWorksheet {
  const sorted = [...input.certificates].sort((a, b) => {
    const aTime = a.dateReceived?.getTime() ?? 0;
    const bTime = b.dateReceived?.getTime() ?? 0;
    return aTime - bTime;
  });

  const rows: KeyingWorksheetRow[] = sorted.map((c, i) => ({
    rowNumber: i + 1,
    certificateId: c.id,
    payorTin: c.payorTin ?? "",
    payorName: c.payorName,
    payorAddress: c.payorAddress ?? "",
    atcCode: c.atcCode,
    atcDescription: c.atcDescription,
    incomePaymentCents: c.incomePaymentCents,
    taxWithheldCents: c.taxWithheldCents,
    dateReceived: c.dateReceived,
  }));

  const totals: KeyingWorksheetTotals = rows.reduce(
    (acc, r) => ({
      incomePaymentCents: acc.incomePaymentCents + r.incomePaymentCents,
      taxWithheldCents: acc.taxWithheldCents + r.taxWithheldCents,
    }),
    { incomePaymentCents: 0, taxWithheldCents: 0 },
  );

  return {
    clientName: input.clientName,
    clientTin: input.clientTin,
    taxableYear: input.taxableYear,
    period: input.period,
    rows,
    rowCount: rows.length,
    totals,
  };
}
