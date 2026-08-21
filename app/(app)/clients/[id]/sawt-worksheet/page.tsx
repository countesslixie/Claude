import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { PrintButton } from "@/components/print-button";
import { assembleKeyingWorksheet } from "@/lib/sawt/assembleKeyingWorksheet";
import { generateSawtBatch } from "@/lib/actions/sawt";
import { centsToPesos } from "@/lib/money";
import { formatManilaDate, currentTaxableYearManila } from "@/lib/dates";
import { ALL_PERIODS } from "@/lib/tax/periods";
import type { Period } from "@/lib/tax/types";

/**
 * SAWT keying worksheet (SPEC.md 10) — the certificates currently
 * eligible-but-unbatched through this period, in the Alphalist Data
 * Entry Module's column order, with the row count and totals to check
 * against the module after entry. "Generate batch" is the explicit
 * action that assigns these rows to this period's SawtBatch — viewing
 * or exporting the worksheet never writes anything by itself.
 */
export default async function SawtWorksheetPage({
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

  const worksheet = await assembleKeyingWorksheet(id, taxableYear, period);

  async function generateBatch() {
    "use server";
    await generateSawtBatch(id, taxableYear, period);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="no-print mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">SAWT keying worksheet — {client.registeredName}</h1>
          <p className="text-sm text-slate-500">
            Column order best-effort matches the Alphalist Data Entry Module — confirm against the live module
            before relying on it for fast keying (not verified against the current BIR screen).
          </p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/clients/${id}/sawt-worksheet?year=${taxableYear}&period=${period}`}>
            <Button variant="secondary">Download XLSX</Button>
          </a>
          <PrintButton />
          <form action={generateBatch}>
            <Button type="submit" disabled={worksheet.rowCount === 0}>
              Generate batch ({worksheet.rowCount})
            </Button>
          </form>
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
          <p className="text-base font-semibold text-slate-900">{worksheet.clientName}</p>
          <p className="text-sm text-slate-600">TIN: {worksheet.clientTin}</p>
          <p className="mt-1 text-sm font-medium text-slate-800">
            SAWT Keying Worksheet — TY{worksheet.taxableYear} {worksheet.period}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {worksheet.rowCount} row(s) — check against the module&apos;s own row count and totals after entry.
          </p>
        </div>

        {worksheet.rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">
            Nothing to key — every claimable certificate through this period is already batched.
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Payor TIN</th>
                <th>Payor Name</th>
                <th>Payor Address</th>
                <th>ATC</th>
                <th>Nature of Income Payment</th>
                <th>Amount of Income Payment</th>
                <th>Amount of Tax Withheld</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {worksheet.rows.map((row) => (
                <tr key={row.certificateId}>
                  <td>{row.rowNumber}</td>
                  <td>{row.payorTin || "—"}</td>
                  <td>{row.payorName}</td>
                  <td>{row.payorAddress || "—"}</td>
                  <td className="font-mono text-xs">{row.atcCode}</td>
                  <td>{row.atcDescription || "—"}</td>
                  <td>{centsToPesos(row.incomePaymentCents, { withSymbol: true })}</td>
                  <td>{centsToPesos(row.taxWithheldCents, { withSymbol: true })}</td>
                  <td>{formatManilaDate(row.dateReceived)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td colSpan={6}>Total ({worksheet.rowCount} rows)</td>
                <td>{centsToPesos(worksheet.totals.incomePaymentCents, { withSymbol: true })}</td>
                <td>{centsToPesos(worksheet.totals.taxWithheldCents, { withSymbol: true })}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="no-print mt-4 flex gap-4">
        <Link href={`/clients/${id}/form-2307?year=${taxableYear}&period=${period}`} className="text-sm text-slate-600 hover:underline">
          ← Back to Form 2307 register
        </Link>
      </div>
    </div>
  );
}
