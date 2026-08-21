import { DateTime } from "luxon";
import { MANILA_ZONE } from "@/lib/dates";
import type { Period } from "@/lib/tax/types";

/**
 * Cash Receipts Journal (SPEC.md 9) — the only book this system
 * generates (Phase 4 scope decision, 2026-08-21). Sourced from
 * SalesTransaction. Grouped by Asia/Manila calendar month, each with its
 * own totals line, per BIR physical-book convention — never by UTC
 * month (SPEC.md 4's date handling rules: a transactionDate is Manila
 * midnight, always UTC 16:00 the previous day, so a UTC month grouping
 * would misfile every 1st-of-month transaction into the wrong month).
 */
export interface CrjTransactionRow {
  transactionDate: Date;
  orNumber: string | null;
  payorName: string;
  particulars: string | null;
  grossAmountCents: number;
  withholdingTaxCents: number;
  cashReceivedCents: number;
}

export interface CrjTotals {
  grossAmountCents: number;
  withholdingTaxCents: number;
  cashReceivedCents: number;
}

export interface CrjMonthGroup {
  monthKey: string; // "2026-04", for sorting/keying
  monthLabel: string; // "April 2026"
  rows: CrjTransactionRow[];
  totals: CrjTotals;
}

export interface CashReceiptsJournal {
  clientName: string;
  clientTin: string;
  taxableYear: number;
  period: Period;
  months: CrjMonthGroup[];
  grandTotals: CrjTotals & { transactionCount: number };
}

function sumTotals(rows: CrjTransactionRow[]): CrjTotals {
  return rows.reduce(
    (acc, r) => ({
      grossAmountCents: acc.grossAmountCents + r.grossAmountCents,
      withholdingTaxCents: acc.withholdingTaxCents + r.withholdingTaxCents,
      cashReceivedCents: acc.cashReceivedCents + r.cashReceivedCents,
    }),
    { grossAmountCents: 0, withholdingTaxCents: 0, cashReceivedCents: 0 },
  );
}

export function buildCashReceiptsJournal(input: {
  clientName: string;
  clientTin: string;
  taxableYear: number;
  period: Period;
  transactions: CrjTransactionRow[];
}): CashReceiptsJournal {
  const sorted = [...input.transactions].sort((a, b) => a.transactionDate.getTime() - b.transactionDate.getTime());

  const groupsByKey = new Map<string, CrjTransactionRow[]>();
  for (const row of sorted) {
    const manila = DateTime.fromJSDate(row.transactionDate).setZone(MANILA_ZONE);
    const key = manila.toFormat("yyyy-MM");
    const group = groupsByKey.get(key) ?? [];
    group.push(row);
    groupsByKey.set(key, group);
  }

  const months: CrjMonthGroup[] = Array.from(groupsByKey.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, rows]) => ({
      monthKey,
      monthLabel: DateTime.fromFormat(monthKey, "yyyy-MM").toFormat("LLLL yyyy"),
      rows,
      totals: sumTotals(rows),
    }));

  const grandTotals = { ...sumTotals(sorted), transactionCount: sorted.length };

  return {
    clientName: input.clientName,
    clientTin: input.clientTin,
    taxableYear: input.taxableYear,
    period: input.period,
    months,
    grandTotals,
  };
}
