import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { PrintButton } from "@/components/print-button";
import { assembleCrj } from "@/lib/books/assembleCrj";
import { centsToPesos } from "@/lib/money";
import { formatManilaDate, currentTaxableYearManila } from "@/lib/dates";
import { ALL_PERIODS } from "@/lib/tax/periods";
import type { Period } from "@/lib/tax/types";

/**
 * Books (SPEC.md 9, 11 item 7) — the Cash Receipts Journal, the only
 * book this system generates (Phase 4 scope decision, 2026-08-21).
 * Print-friendly: the nav chrome and this page's own controls hide
 * under @media print (app/globals.css); page numbers come from the
 * browser's print dialog, not custom pagination.
 */
export default async function BooksPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string; period?: string }>;
}) {
  const { id } = await params;
  const { year, period: periodParam } = await searchParams;

  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) notFound();

  const taxableYear = year ? Number(year) : currentTaxableYearManila();
  const period: Period = ALL_PERIODS.includes(periodParam as Period) ? (periodParam as Period) : "Q1";

  const journal = await assembleCrj(id, taxableYear, period);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="no-print mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Books — {client.registeredName}</h1>
          <p className="text-sm text-slate-500">
            Cash Receipts Journal only (SPEC.md 9) — the Cash Disbursements Journal, General Journal, and General
            Ledger are the client&apos;s own responsibility, not generated here.
          </p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/clients/${id}/books/crj?year=${taxableYear}&period=${period}`}>
            <Button variant="secondary">Download XLSX</Button>
          </a>
          <PrintButton />
        </div>
      </div>

      <form className="no-print mb-4 flex items-center gap-2" method="get">
        <label className="text-sm text-slate-600">Year</label>
        <input
          type="number"
          name="year"
          defaultValue={taxableYear}
          className="h-8 w-24 rounded-md border border-slate-300 px-2 text-sm"
        />
        <label className="text-sm text-slate-600">Period</label>
        <select name="period" defaultValue={period} className="h-8 rounded-md border border-slate-300 px-2 text-sm">
          {ALL_PERIODS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary" size="sm">
          Filter
        </Button>
      </form>

      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4 border-b border-slate-200 pb-3 text-center">
          <p className="text-base font-semibold text-slate-900">{journal.clientName}</p>
          <p className="text-sm text-slate-600">TIN: {journal.clientTin}</p>
          <p className="mt-1 text-sm font-medium text-slate-800">
            Cash Receipts Journal — TY{journal.taxableYear} {journal.period}
          </p>
        </div>

        {journal.months.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No transactions for this period.</p>
        ) : (
          journal.months.map((month, i) => (
            <div key={month.monthKey} className={i > 0 ? "print-page-break mt-6" : ""}>
              <h2 className="mb-2 text-sm font-semibold text-slate-800">{month.monthLabel}</h2>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>OR No.</th>
                    <th>Payor</th>
                    <th>Particulars</th>
                    <th>Gross Receipts</th>
                    <th>Creditable WHT</th>
                    <th>Cash Received</th>
                  </tr>
                </thead>
                <tbody>
                  {month.rows.map((row, j) => (
                    <tr key={j}>
                      <td>{formatManilaDate(row.transactionDate)}</td>
                      <td>{row.orNumber ?? "—"}</td>
                      <td>{row.payorName}</td>
                      <td>{row.particulars ?? "—"}</td>
                      <td>{centsToPesos(row.grossAmountCents, { withSymbol: true })}</td>
                      <td>{centsToPesos(row.withholdingTaxCents, { withSymbol: true })}</td>
                      <td>{centsToPesos(row.cashReceivedCents, { withSymbol: true })}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td colSpan={4}>{month.monthLabel} total</td>
                    <td>{centsToPesos(month.totals.grossAmountCents, { withSymbol: true })}</td>
                    <td>{centsToPesos(month.totals.withholdingTaxCents, { withSymbol: true })}</td>
                    <td>{centsToPesos(month.totals.cashReceivedCents, { withSymbol: true })}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))
        )}

        {journal.months.length > 0 && (
          <div className="mt-6 flex justify-end border-t border-slate-200 pt-3">
            <table className="text-sm">
              <tbody>
                <tr className="font-semibold text-slate-900">
                  <td className="pr-4">Grand total ({journal.grandTotals.transactionCount} transactions)</td>
                  <td className="pr-4">{centsToPesos(journal.grandTotals.grossAmountCents, { withSymbol: true })}</td>
                  <td className="pr-4">
                    {centsToPesos(journal.grandTotals.withholdingTaxCents, { withSymbol: true })}
                  </td>
                  <td>{centsToPesos(journal.grandTotals.cashReceivedCents, { withSymbol: true })}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="no-print mt-4">
        <Link href={`/clients/${id}`} className="text-sm text-slate-600 hover:underline">
          ← Back to client
        </Link>
      </div>
    </div>
  );
}
