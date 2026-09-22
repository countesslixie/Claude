import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { centsToPesos, bpsToPercentLabel } from "@/lib/money";
import { currentTaxableYearManila } from "@/lib/dates";
import { getAnnualCertificatesVsSalesReconciliation } from "@/lib/reconciliation";
import { ALL_PERIODS, periodToQuarters } from "@/lib/tax/periods";
import type { Period } from "@/lib/tax/types";

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
  searchParams: Promise<{ year?: string; period?: string }>;
}) {
  const { id } = await params;
  const { year, period: periodParam } = await searchParams;

  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) notFound();

  const taxableYear = year ? Number(year) : currentTaxableYearManila();
  const period: Period = ALL_PERIODS.includes(periodParam as Period) ? (periodParam as Period) : "Q1";
  const quarters = periodToQuarters(period);

  const certificates = await prisma.form2307.findMany({
    where: { clientId: id, taxableYear, quarterCovered: { in: [...quarters] }, deletedAt: null },
    include: { claimedOnFiling: { select: { id: true, period: true } } },
    orderBy: [{ payorName: "asc" }, { payorTin: "asc" }],
  });

  const reconciliation = await getAnnualCertificatesVsSalesReconciliation(id, taxableYear);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">
            Form 2307 register — {client.registeredName}
          </h1>
          <p className="text-sm text-slate-500">
            Read-only. Certificates are entered under step 2 of the filing they belong to (brief #4b) —
            open a filing and go to &quot;Receive Form 2307&quot; to add or remove one. A 2307 is a credit
            record — what one payor paid and withheld. It never contributes to gross sales; declared
            income is entered separately on the{" "}
            <Link href={`/clients/${id}/income`} className="underline">
              income page
            </Link>
            .
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/clients/${id}/sawt-worksheet?year=${taxableYear}&period=${period}`}>
            <Button variant="secondary">Keying worksheet</Button>
          </Link>
        </div>
      </div>

      <form className="mb-4 flex items-center gap-2" method="get">
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

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="data-table">
          <thead>
            <tr>
              <th>Payor</th>
              <th>ATC</th>
              <th>Income payment</th>
              <th>Tax withheld</th>
              <th>Rate</th>
              <th>Status</th>
              <th>Entered under</th>
            </tr>
          </thead>
          <tbody>
            {certificates.map((c) => (
              <tr key={c.id}>
                <td>{c.payorName}</td>
                <td className="font-mono text-xs">{c.atcCode || "—"}</td>
                <td>{centsToPesos(c.incomePaymentCents, { withSymbol: true })}</td>
                <td>{centsToPesos(c.taxWithheldCents, { withSymbol: true })}</td>
                <td>{bpsToPercentLabel(c.withholdingRateBps)}</td>
                <td>
                  <StatusBadge tone={STATUS_TONE[c.status] ?? "pending"}>{c.status}</StatusBadge>
                </td>
                <td>
                  {c.claimedOnFiling ? (
                    <Link href={`/clients/${id}/filings/${c.claimedOnFiling.id}`} className="underline">
                      {c.claimedOnFiling.period}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {certificates.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-slate-400">
                  No Form 2307 certificates for this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Certificates vs. declared sales — TY{taxableYear}</h2>
        <p className="mt-1 text-xs text-slate-500">
          Runs over the whole taxable year, not per quarter — a certificate is credited to whichever
          period is open when it arrives, so a per-quarter comparison would flag a variance almost every
          time.
        </p>
        <p className="mt-3 text-sm text-slate-700">
          Certificates for TY{taxableYear} total{" "}
          <span className="font-medium">{centsToPesos(reconciliation.certificatesTotalCents, { withSymbol: true })}</span>{" "}
          in income payments against{" "}
          <span className="font-medium">{centsToPesos(reconciliation.declaredSalesTotalCents, { withSymbol: true })}</span>{" "}
          declared gross sales.
        </p>
        {reconciliation.hasVariance ? (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
            Certificates exceed declared sales by{" "}
            {centsToPesos(reconciliation.varianceCents, { withSymbol: true })} — something is wrong here;
            check the declared sales figure before filing.
          </p>
        ) : (
          <p className="mt-3 text-sm text-emerald-700">Certificates do not exceed declared sales.</p>
        )}
      </div>
    </div>
  );
}
