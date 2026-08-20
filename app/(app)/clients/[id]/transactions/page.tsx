import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TransactionQuickEntry } from "@/components/transaction-quick-entry";
import { Button } from "@/components/ui/button";
import { centsToPesos } from "@/lib/money";
import { formatManilaDate, currentTaxableYearManila } from "@/lib/dates";

export default async function TransactionsPage({
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
  const quarterFilter = quarter ? Number(quarter) : undefined;

  const transactions = await prisma.salesTransaction.findMany({
    where: {
      clientId: id,
      taxableYear,
      quarter: quarterFilter,
      deletedAt: null,
    },
    orderBy: { transactionDate: "desc" },
  });

  const totals = transactions.reduce(
    (acc, t) => {
      acc.gross += t.grossAmountCents;
      acc.wht += t.withholdingTaxCents;
      acc.net += t.netReceivedCents;
      acc.count += 1;
      return acc;
    },
    { gross: 0, wht: 0, net: 0, count: 0 },
  );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">
            Transactions — {client.registeredName}
          </h1>
          <p className="text-sm text-slate-500">
            Primary entry is from Form 2307s (see the{" "}
            <Link href={`/clients/${id}/form-2307`} className="underline">
              2307 register
            </Link>
            ). Quick entry below is for receipts with no 2307.
          </p>
        </div>
      </div>

      <div className="mb-4">
        <TransactionQuickEntry
          clientId={id}
          defaultWithholdingRateBps={client.defaultWithholdingRateBps ?? 0}
        />
      </div>

      <form className="mb-3 flex items-center gap-2" method="get">
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
          defaultValue={quarterFilter ?? ""}
          className="h-8 rounded-md border border-slate-300 px-2 text-sm"
        >
          <option value="">All</option>
          <option value={1}>Q1</option>
          <option value={2}>Q2</option>
          <option value={3}>Q3</option>
          <option value={4}>Q4</option>
        </select>
        <Button type="submit" variant="secondary" size="sm">
          Filter
        </Button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>OR #</th>
              <th>Payor</th>
              <th>Gross</th>
              <th>WHT</th>
              <th>Net</th>
              <th>2307</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id}>
                <td>{formatManilaDate(t.transactionDate)}</td>
                <td className="font-mono text-xs">{t.orNumber ?? "—"}</td>
                <td>{t.payorName}</td>
                <td>{centsToPesos(t.grossAmountCents, { withSymbol: true })}</td>
                <td>{centsToPesos(t.withholdingTaxCents, { withSymbol: true })}</td>
                <td>{centsToPesos(t.netReceivedCents, { withSymbol: true })}</td>
                <td>{t.form2307Id ? "Yes" : "—"}</td>
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-slate-400">
                  No transactions for this period.
                </td>
              </tr>
            )}
          </tbody>
          {transactions.length > 0 && (
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={3}>{totals.count} row(s)</td>
                <td>{centsToPesos(totals.gross, { withSymbol: true })}</td>
                <td>{centsToPesos(totals.wht, { withSymbol: true })}</td>
                <td>{centsToPesos(totals.net, { withSymbol: true })}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
