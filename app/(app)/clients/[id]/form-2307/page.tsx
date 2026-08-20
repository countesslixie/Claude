import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { centsToPesos, bpsToPercentLabel } from "@/lib/money";
import { formatManilaDate } from "@/lib/dates";
import { currentTaxableYearManila } from "@/lib/dates";
import { getPeriodReconciliation } from "@/lib/reconciliation";

const STATUS_TONE: Record<string, "pending" | "progress" | "waiting" | "overdue" | "done"> = {
  RECEIVED: "pending",
  RECORDED: "progress",
  CLAIMED_ON_RETURN: "waiting",
  INCLUDED_IN_SAWT: "waiting",
  ACKNOWLEDGED: "done",
  VALIDATED: "done",
};

export default async function Form2307RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string; quarter?: string }>;
}) {
  const { id } = await params;
  const { year, quarter } = await searchParams;

  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) notFound();

  const taxableYear = year ? Number(year) : currentTaxableYearManila();
  const quarterCovered = quarter ? Number(quarter) : 1;

  const certificates = await prisma.form2307.findMany({
    where: { clientId: id, taxableYear, quarterCovered, deletedAt: null },
    include: { salesTransactions: { select: { id: true } } },
    orderBy: { dateReceived: "asc" },
  });

  const reconciliation = await getPeriodReconciliation(id, taxableYear, quarterCovered);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">
            Form 2307 register — {client.registeredName}
          </h1>
          <p className="text-sm text-slate-500">
            The 2307 is the source document for a transaction, not an independent check on it
            (SPEC.md WORKFLOW CHANGE).
          </p>
        </div>
        <Link href={`/clients/${id}/form-2307/new?year=${taxableYear}&quarter=${quarterCovered}`}>
          <Button>New Form 2307</Button>
        </Link>
      </div>

      <form className="mb-4 flex items-center gap-2" method="get">
        <label className="text-sm text-slate-600">Year</label>
        <input
          type="number"
          name="year"
          defaultValue={taxableYear}
          className="h-8 w-24 rounded-md border border-slate-300 px-2 text-sm"
        />
        <label className="text-sm text-slate-600">Quarter</label>
        <select
          name="quarter"
          defaultValue={quarterCovered}
          className="h-8 rounded-md border border-slate-300 px-2 text-sm"
        >
          <option value={1}>Q1</option>
          <option value={2}>Q2</option>
          <option value={3}>Q3</option>
          <option value={4}>Q4 (annual)</option>
        </select>
        <Button type="submit" variant="secondary" size="sm">
          Filter
        </Button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="data-table">
          <thead>
            <tr>
              <th>Received</th>
              <th>Payor</th>
              <th>ATC</th>
              <th>Income payment</th>
              <th>Tax withheld</th>
              <th>Rate</th>
              <th>Status</th>
              <th>Transaction</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {certificates.map((c) => {
              const converted = c.salesTransactions.length > 0;
              return (
                <tr key={c.id}>
                  <td>{formatManilaDate(c.dateReceived)}</td>
                  <td>{c.payorName}</td>
                  <td className="font-mono text-xs">{c.atcCode}</td>
                  <td>{centsToPesos(c.incomePaymentCents, { withSymbol: true })}</td>
                  <td>{centsToPesos(c.taxWithheldCents, { withSymbol: true })}</td>
                  <td>{bpsToPercentLabel(c.withholdingRateBps)}</td>
                  <td>
                    <StatusBadge tone={STATUS_TONE[c.status] ?? "pending"}>{c.status}</StatusBadge>
                  </td>
                  <td>
                    {converted ? (
                      <StatusBadge tone="done">Recorded</StatusBadge>
                    ) : (
                      <StatusBadge tone="overdue">Not yet</StatusBadge>
                    )}
                  </td>
                  <td>
                    {!converted && (
                      <Link
                        href={`/clients/${id}/transactions/from-2307/${c.id}`}
                        className="text-sm text-slate-900 underline hover:no-underline"
                      >
                        Create transaction
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
            {certificates.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-sm text-slate-400">
                  No Form 2307 certificates for this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Transactions with no linked 2307
          </h2>
          <p className="mt-1 text-xs text-slate-500">The real gap — receipts to double-check.</p>
          <p className="mt-3 text-2xl font-semibold text-slate-900">
            {reconciliation.transactionsWithoutForm2307.length}
          </p>
          <p className="text-sm text-slate-600">
            {centsToPesos(reconciliation.transactionsWithoutForm2307TotalCents, { withSymbol: true })} total
          </p>
          {reconciliation.transactionsWithoutForm2307.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-slate-500">
              {reconciliation.transactionsWithoutForm2307.map((t) => (
                <li key={t.id}>
                  {formatManilaDate(t.transactionDate)} — {t.payorName} —{" "}
                  {centsToPesos(t.grossAmountCents, { withSymbol: true })}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Certificates not yet converted</h2>
          <p className="mt-1 text-xs text-slate-500">Received, but no transaction recorded from them yet.</p>
          <p className="mt-3 text-2xl font-semibold text-slate-900">
            {reconciliation.certificatesNotYetConverted.length}
          </p>
          <p className="text-sm text-slate-600">
            {centsToPesos(reconciliation.certificatesNotYetConvertedTotalCents, { withSymbol: true })} CWT
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">CWT: filing vs SAWT batch</h2>
          <p className="mt-1 text-xs text-slate-500">Cross-check against what actually gets filed.</p>
          {reconciliation.hasSawtBatch ? (
            <p className="mt-3 text-sm text-slate-700">
              {centsToPesos(reconciliation.sawtBatchCwtCents, { withSymbol: true })} across{" "}
              {reconciliation.certificatesInSawtBatchCount} certificate(s) in the SAWT batch.
            </p>
          ) : (
            <p className="mt-3 text-sm text-slate-400">
              No SAWT batch created for this period yet (Phase 4).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
