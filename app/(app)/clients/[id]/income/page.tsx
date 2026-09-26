import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { QuarterlySalesCard } from "@/components/quarterly-sales-card";
import { saveQuarterlySales } from "@/lib/actions/quarterlySales";
import { listActivePayors, createPayorInline } from "@/lib/actions/payors";
import { centsToPesos } from "@/lib/money";
import { currentTaxableYearManila, formatManilaDate } from "@/lib/dates";
import { ownSalesQuarterOf, filingPeriodForSalesQuarter } from "@/lib/tax/periods";
import type { SalesQuarter } from "@/lib/tax/types";

const QUARTERS: SalesQuarter[] = ["Q1", "Q2", "Q3", "Q4"];

/**
 * Brief #4b (D33) — declared gross sales, now the sum of per-customer
 * rows for the quarter (still the only place income enters the system;
 * a Form 2307 never contributes to it). Opened from a filing
 * (`?filingId=`), only that filing's own quarter is editable; every
 * other quarter this taxable year renders read-only. Opened without a
 * filing (e.g. from the client page), every quarter renders read-only
 * with a link to its filing if one exists — the simplest reasonable
 * version of "no filing context to anchor an editable quarter to."
 *
 * Brief #4d — a quarter that's already final (step 1/RECORD_SALES Done)
 * but not yet filed now opens read-only with an Edit button, inside
 * QuarterlySalesCard itself, distinct from `locked` (filed — no Edit
 * button at all, unchanged from before).
 */
export default async function IncomePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string; filingId?: string }>;
}) {
  const { id } = await params;
  const { year, filingId } = await searchParams;

  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) notFound();

  let openFiling: { id: string; period: string; taxableYear: number } | null = null;
  if (filingId) {
    const f = await prisma.filing.findUnique({ where: { id: filingId } });
    if (!f || f.clientId !== id) notFound();
    openFiling = f;
  }

  const taxableYear = openFiling ? openFiling.taxableYear : year ? Number(year) : currentTaxableYearManila();

  const rows = await prisma.quarterlySales.findMany({
    where: { clientId: id, taxableYear },
    include: { customers: { orderBy: { createdAt: "asc" } } },
  });
  const byQuarter = new Map(rows.map((r) => [r.quarter, r]));

  const filingsThisYear = await prisma.filing.findMany({
    where: { clientId: id, taxableYear },
    include: {
      workflowSteps: { where: { stepCode: { in: ["FILE_RETURN", "RECORD_SALES"] } }, select: { stepCode: true, status: true } },
    },
  });
  const filingByPeriod = new Map(filingsThisYear.map((f) => [f.period, f]));

  function lockInfoFor(quarter: SalesQuarter) {
    const period = filingPeriodForSalesQuarter(quarter);
    const f = filingByPeriod.get(period);
    const locked = f?.workflowSteps.find((s) => s.stepCode === "FILE_RETURN")?.status === "DONE";
    // Brief #4d — step 1's own Done status decides whether this quarter
    // opens read-only (final) or editable (draft/never saved), separate
    // from `locked` (the return has been filed — a stronger, permanent
    // state with no Edit button at all).
    const finalized = f?.workflowSteps.find((s) => s.stepCode === "RECORD_SALES")?.status === "DONE";
    return { filing: f ?? null, locked, finalized };
  }

  const editableQuarter: SalesQuarter | null = openFiling ? ownSalesQuarterOf(openFiling.period as never) : null;

  // Brief #5a — the customer-name field on each row offers the client's
  // saved "Customers / payors" list, with free typing still allowed.
  const payors = await listActivePayors(id);
  const boundSaveNewPayor = createPayorInline.bind(null, id);

  const yearTotalGrossCents = rows.reduce((sum, r) => sum + r.grossSalesCents, 0);
  const yearTotalNonOperatingCents = rows.reduce((sum, r) => sum + r.nonOperatingIncomeCents, 0);

  function readOnlyRow(quarter: SalesQuarter) {
    const row = byQuarter.get(quarter);
    const { filing, locked } = lockInfoFor(quarter);
    const customersLabel = !row
      ? "—"
      : row.noSalesThisQuarter
        ? "No sales this quarter"
        : row.customers.length > 0
          ? row.customers.map((c) => c.customerName).join(", ")
          : "—";
    return (
      <tr key={quarter}>
        <td>{quarter}</td>
        <td>{customersLabel}</td>
        <td>{row ? centsToPesos(row.grossSalesCents, { withSymbol: true }) : "—"}</td>
        <td>
          {locked && <span className="text-xs text-slate-400">filed</span>}
          {filing && (
            <Link href={`/clients/${id}/filings/${filing.id}`} className="ml-2 text-xs underline">
              View filing
            </Link>
          )}
        </td>
      </tr>
    );
  }

  const otherQuarters = QUARTERS.filter((q) => q !== editableQuarter);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Income — {client.registeredName}</h1>
          <p className="text-sm text-slate-500">
            Declared gross sales for TY{taxableYear}: {centsToPesos(yearTotalGrossCents, { withSymbol: true })}
            {yearTotalNonOperatingCents > 0 &&
              ` + ${centsToPesos(yearTotalNonOperatingCents, { withSymbol: true })} non-operating`}
            .
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!openFiling && (
            <form method="get" className="flex items-center gap-2">
              <label className="text-sm text-slate-600">Year</label>
              <input
                type="number"
                name="year"
                defaultValue={taxableYear}
                className="h-8 w-24 rounded-md border border-slate-300 px-2 text-sm"
              />
              <Button type="submit" variant="secondary" size="sm">
                Go
              </Button>
            </form>
          )}
          {openFiling && (
            <Link href={`/clients/${id}/filings/${openFiling.id}`}>
              <Button variant="secondary" size="sm">
                Back to filing
              </Button>
            </Link>
          )}
        </div>
      </div>

      {editableQuarter &&
        (() => {
          const { locked, finalized, filing } = lockInfoFor(editableQuarter);
          const row = byQuarter.get(editableQuarter);
          if (locked) {
            return (
              <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-medium text-slate-900">{editableQuarter} — read-only</p>
                <p className="mt-1 text-sm text-slate-600">
                  This quarter&apos;s return has already been filed, so it can no longer be edited here.
                </p>
                <p className="mt-2 text-sm text-slate-700">
                  Total: {row ? centsToPesos(row.grossSalesCents, { withSymbol: true }) : "—"}
                </p>
                {filing && (
                  <Link href={`/clients/${id}/filings/${filing.id}`} className="mt-1 inline-block text-sm underline">
                    Go to filing
                  </Link>
                )}
              </div>
            );
          }
          const boundAction = saveQuarterlySales.bind(null, id, taxableYear, editableQuarter);
          return (
            <div className="mb-4">
              <QuarterlySalesCard
                quarter={editableQuarter}
                isQ4={editableQuarter === "Q4"}
                action={boundAction}
                initialValues={{
                  customers: row ? row.customers.map((c) => ({ customerName: c.customerName, amount: centsToPesos(c.amountCents) })) : [],
                  nonOperatingIncome: row ? centsToPesos(row.nonOperatingIncomeCents) : "0",
                  notes: row?.notes ?? "",
                  noSalesThisQuarter: row?.noSalesThisQuarter ?? false,
                }}
                initialFinalized={finalized}
                initialSavedAt={row ? formatManilaDate(row.updatedAt) : null}
                filingHref={filing ? `/clients/${id}/filings/${filing.id}` : `/clients/${id}/income`}
                payors={payors}
                onSaveNewPayor={boundSaveNewPayor}
              />
            </div>
          );
        })()}

      {!editableQuarter && (
        <div className="mb-4 flex flex-col gap-4">
          {QUARTERS.map((quarter) => {
            const row = byQuarter.get(quarter);
            const { locked, finalized, filing } = lockInfoFor(quarter);
            if (locked) {
              return (
                <div key={quarter} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-1 flex items-baseline justify-between">
                    <h2 className="text-sm font-semibold text-slate-900">{quarter}</h2>
                    <span className="text-xs text-slate-400">read-only — filed</span>
                  </div>
                  <p className="text-sm text-slate-700">
                    Total: {row ? centsToPesos(row.grossSalesCents, { withSymbol: true }) : "—"}
                  </p>
                  {filing && (
                    <Link href={`/clients/${id}/filings/${filing.id}`} className="mt-1 inline-block text-sm underline">
                      Go to filing
                    </Link>
                  )}
                </div>
              );
            }
            const boundAction = saveQuarterlySales.bind(null, id, taxableYear, quarter);
            return (
              <QuarterlySalesCard
                key={quarter}
                quarter={quarter}
                isQ4={quarter === "Q4"}
                action={boundAction}
                initialValues={{
                  customers: row ? row.customers.map((c) => ({ customerName: c.customerName, amount: centsToPesos(c.amountCents) })) : [],
                  nonOperatingIncome: row ? centsToPesos(row.nonOperatingIncomeCents) : "0",
                  notes: row?.notes ?? "",
                  noSalesThisQuarter: row?.noSalesThisQuarter ?? false,
                }}
                initialFinalized={finalized}
                initialSavedAt={row ? formatManilaDate(row.updatedAt) : null}
                filingHref={filing ? `/clients/${id}/filings/${filing.id}` : `/clients/${id}/income`}
                payors={payors}
                onSaveNewPayor={boundSaveNewPayor}
              />
            );
          })}
        </div>
      )}

      {editableQuarter && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <p className="border-b border-slate-100 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            Other quarters this year — read-only
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Quarter</th>
                <th>Customers</th>
                <th>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>{otherQuarters.map((q) => readOnlyRow(q))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
