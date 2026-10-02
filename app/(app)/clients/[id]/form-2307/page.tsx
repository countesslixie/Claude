import Link from "next/link";
import { ClientStickyBar } from "@/components/client-sticky-bar";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { form2307StatusLabel } from "@/lib/workflow/status";
import { StatusBadge } from "@/components/status-badge";
import { centsToPesos, bpsToPercentLabel } from "@/lib/money";
import { currentTaxableYearManila } from "@/lib/dates";
import { getAnnualCertificatesVsSalesReconciliation } from "@/lib/reconciliation";
import { loadRegisterRows } from "@/lib/form2307Register";

const STATUS_TONE: Record<string, "pending" | "progress" | "waiting" | "overdue" | "done"> = {
  RECEIVED: "pending",
  RECORDED: "progress",
  CLAIMED_ON_RETURN: "waiting",
  INCLUDED_IN_SAWT: "waiting",
  ACKNOWLEDGED: "done",
  VALIDATED: "done",
};

/**
 * D160 — the Form 2307 register: one year at a time (opens on the current
 * Manila year), every column centred, Period first (the period of the filing
 * the certificate was entered under), in chronological order, with each
 * certificate's current scan to download and a Download all zip.
 */
export default async function Form2307RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { id } = await params;
  const { year } = await searchParams;

  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) notFound();

  const taxableYear = year && Number.isInteger(Number(year)) ? Number(year) : currentTaxableYearManila();
  const rows = await loadRegisterRows(id, taxableYear);
  const hasScans = rows.some((r) => r.scan);
  const reconciliation = await getAnnualCertificatesVsSalesReconciliation(id, taxableYear);

  return (
    <div className="mx-auto max-w-5xl">
      <ClientStickyBar headerId="client-page-header" clientId={id} name={client.registeredName} tin={client.tin} />
      <div id="client-page-header" className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-ink">Form 2307 register — {client.registeredName}</h1>
        <div className="flex flex-wrap gap-2">
          {hasScans && (
            <a href={`/api/clients/${id}/form-2307-scans?year=${taxableYear}`}>
              <Button variant="secondary" size="sm">
                Download all
              </Button>
            </a>
          )}
          <Link href={`/clients/${id}`}>
            <Button variant="secondary" size="sm">
              Back to client
            </Button>
          </Link>
        </div>
      </div>

      <form className="mb-4 flex items-center gap-2" method="get">
        <label className="text-sm text-ink-secondary">Year</label>
        <input type="number" name="year" defaultValue={taxableYear} className="h-8 w-24 rounded-md border border-line px-2 text-sm" />
        <Button type="submit" variant="secondary" size="sm">
          Go
        </Button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="data-table data-table-centered">
          <thead>
            <tr>
              <th>Period</th>
              <th>Payor</th>
              <th>ATC</th>
              <th>Income payment</th>
              <th>Tax withheld</th>
              <th>Rate</th>
              <th>Status</th>
              <th>Scan</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>{c.periodLabel}</td>
                <td>{c.payorName}</td>
                <td className="font-mono text-xs">{c.atcCode || "—"}</td>
                <td className="tabular-nums">{centsToPesos(c.incomePaymentCents, { withSymbol: true })}</td>
                <td className="tabular-nums">{centsToPesos(c.taxWithheldCents, { withSymbol: true })}</td>
                <td>{bpsToPercentLabel(c.withholdingRateBps)}</td>
                <td>
                  <StatusBadge tone={STATUS_TONE[c.status] ?? "pending"}>{form2307StatusLabel(c.status)}</StatusBadge>
                </td>
                <td>
                  {c.scan ? (
                    <a href={`/api/documents/${c.scan.id}/download`} className="text-sm underline">
                      Download
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-sm text-faint">
                  No Form 2307 certificates for this year.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink">Certificates vs. declared sales — TY{taxableYear}</h2>
        <p className="mt-3 text-sm text-ink-secondary">
          Certificates for TY{taxableYear} total{" "}
          <span className="font-medium">{centsToPesos(reconciliation.certificatesTotalCents, { withSymbol: true })}</span>{" "}
          in income payments against{" "}
          <span className="font-medium">{centsToPesos(reconciliation.declaredSalesTotalCents, { withSymbol: true })}</span>{" "}
          declared gross sales.
        </p>
        {reconciliation.hasVariance ? (
          <p className="mt-3 rounded-md bg-amber-tint px-3 py-2 text-sm font-medium text-amber">
            Certificates exceed declared sales by{" "}
            {centsToPesos(reconciliation.varianceCents, { withSymbol: true })} — something is wrong here;
            check the declared sales figure before filing.
          </p>
        ) : (
          <p className="mt-3 text-sm text-green">Certificates do not exceed declared sales.</p>
        )}
      </div>
    </div>
  );
}
