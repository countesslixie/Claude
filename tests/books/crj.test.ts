import { describe, it, expect } from "vitest";
import { buildCashReceiptsJournal, type CrjTransactionRow } from "@/lib/books/crj";

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

function row(overrides: Partial<CrjTransactionRow> = {}): CrjTransactionRow {
  return {
    transactionDate: D("2026-04-15"),
    orNumber: "OR-001",
    payorName: "Acme Corp.",
    particulars: "Consulting fee",
    grossAmountCents: 100000,
    withholdingTaxCents: 5000,
    cashReceivedCents: 95000,
    ...overrides,
  };
}

describe("buildCashReceiptsJournal", () => {
  it("groups rows by Asia/Manila calendar month, not UTC month", () => {
    // manilaDateInputToJsDate("2026-04-01") -> UTC 2026-03-31T16:00:00Z.
    // A naive UTC-month grouping would misfile this into March.
    const aprilFirst = new Date("2026-03-31T16:00:00.000Z");
    const journal = buildCashReceiptsJournal({
      clientName: "Test Client",
      clientTin: "123456789",
      taxableYear: 2026,
      period: "Q2",
      transactions: [row({ transactionDate: aprilFirst })],
    });
    expect(journal.months).toHaveLength(1);
    expect(journal.months[0].monthKey).toBe("2026-04");
    expect(journal.months[0].monthLabel).toBe("April 2026");
  });

  it("§16 item 21: monthly subtotals sum to the grand total, which matches the sum of the underlying rows", () => {
    const rows = [
      row({ transactionDate: D("2026-04-05"), grossAmountCents: 100000, withholdingTaxCents: 5000, cashReceivedCents: 95000 }),
      row({ transactionDate: D("2026-04-20"), grossAmountCents: 200000, withholdingTaxCents: 10000, cashReceivedCents: 190000 }),
      row({ transactionDate: D("2026-05-10"), grossAmountCents: 300000, withholdingTaxCents: 15000, cashReceivedCents: 285000 }),
    ];
    const journal = buildCashReceiptsJournal({
      clientName: "Test Client",
      clientTin: "123456789",
      taxableYear: 2026,
      period: "Q2",
      transactions: rows,
    });

    expect(journal.months).toHaveLength(2);
    const aprilMonth = journal.months.find((m) => m.monthKey === "2026-04")!;
    expect(aprilMonth.totals).toEqual({ grossAmountCents: 300000, withholdingTaxCents: 15000, cashReceivedCents: 285000 });

    const sumOfMonthlySubtotals = journal.months.reduce(
      (sum, m) => sum + m.totals.grossAmountCents,
      0,
    );
    expect(sumOfMonthlySubtotals).toBe(journal.grandTotals.grossAmountCents);
    expect(journal.grandTotals.grossAmountCents).toBe(rows.reduce((s, r) => s + r.grossAmountCents, 0));
    expect(journal.grandTotals.withholdingTaxCents).toBe(rows.reduce((s, r) => s + r.withholdingTaxCents, 0));
    expect(journal.grandTotals.cashReceivedCents).toBe(rows.reduce((s, r) => s + r.cashReceivedCents, 0));
    expect(journal.grandTotals.transactionCount).toBe(3);
  });

  it("months are sorted chronologically regardless of input row order", () => {
    const journal = buildCashReceiptsJournal({
      clientName: "Test Client",
      clientTin: "123456789",
      taxableYear: 2026,
      period: "Q2",
      transactions: [row({ transactionDate: D("2026-06-01") }), row({ transactionDate: D("2026-04-01") })],
    });
    expect(journal.months.map((m) => m.monthKey)).toEqual(["2026-04", "2026-06"]);
  });

  it("rows within a month are sorted by transactionDate", () => {
    const journal = buildCashReceiptsJournal({
      clientName: "Test Client",
      clientTin: "123456789",
      taxableYear: 2026,
      period: "Q2",
      transactions: [
        row({ transactionDate: D("2026-04-20"), orNumber: "OR-later" }),
        row({ transactionDate: D("2026-04-05"), orNumber: "OR-earlier" }),
      ],
    });
    expect(journal.months[0].rows.map((r) => r.orNumber)).toEqual(["OR-earlier", "OR-later"]);
  });

  it("empty transaction list produces zero months and zero grand totals", () => {
    const journal = buildCashReceiptsJournal({
      clientName: "Test Client",
      clientTin: "123456789",
      taxableYear: 2026,
      period: "Q3",
      transactions: [],
    });
    expect(journal.months).toEqual([]);
    expect(journal.grandTotals).toEqual({
      grossAmountCents: 0,
      withholdingTaxCents: 0,
      cashReceivedCents: 0,
      transactionCount: 0,
    });
  });
});
