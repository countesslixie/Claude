import { notFound } from "next/navigation";
import { ClientStickyBar } from "@/components/client-sticky-bar";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { QuarterlySalesCard } from "@/components/quarterly-sales-card";
import { saveQuarterlySales } from "@/lib/actions/quarterlySales";
import { listActivePayors, createPayorInline } from "@/lib/actions/payors";
import { centsToPesos } from "@/lib/money";
import { currentTaxableYearManila, formatManilaDate } from "@/lib/dates";
import { ownSalesQuarterOf, filingPeriodForSalesQuarter, outsideSalesQuartersFor } from "@/lib/tax/periods";
import { getStartingFigures } from "@/lib/startingFigures";
import { getDeclaredIncome, incomeQuarterStatus, INCOME_QUARTER_STATUS_LABEL } from "@/lib/declaredIncome";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import type { SalesQuarter } from "@/lib/tax/types";

const QUARTERS: SalesQuarter[] = ["Q1", "Q2", "Q3", "Q4"];

/**
 * Brief #4b (D33) — declared gross sales, now the sum of per-customer
 * rows for the quarter (still the only place income enters the system;
 * a Form 2307 never contributes to it). Opened from a filing
 * (`?filingId=`, step 1's "Go to income entry"), only that filing's own
 * quarter is editable; every other quarter this taxable year renders
 * read-only. D158 — opened without a filing (the client page's Income
 * button) it is a view-only table (see IncomeTable below): no entry
 * fields, nothing clickable.
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


  if (!openFiling) return <IncomeTable clientId={id} client={client} taxableYear={taxableYear} />;

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

  // Brief #5f §8 — a quarter "filed outside the app" (starting figures)
  // can't be entered here at all; it renders as a plain note, never a
  // form, never editable, never even shown in the read-only table's usual
  // shape.
  const startingFigures = await getStartingFigures(id, taxableYear);
  const outsideQuarters = new Set(outsideSalesQuartersFor(startingFigures?.latestOutsideReturn ?? "NONE"));

  // Brief #5a — each row's name field (labeled "Payor" on screen since
  // brief #5b; internal name customerName is unchanged) offers the
  // client's saved payor list, with free typing still allowed.
  // Brief #5b — "Save … to payors" opens the full-details dialog here too,
  // so the income page's picker needs the active ATC list as well.
  const [payors, atcCodes] = await Promise.all([
    listActivePayors(id),
    prisma.atcCode.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
  ]);
  const boundSaveNewPayor = createPayorInline.bind(null, id);


  function readOnlyRow(quarter: SalesQuarter) {
    if (outsideQuarters.has(quarter)) {
      return (
        <tr key={quarter}>
          <td>{quarter}</td>
          <td colSpan={3} className="text-faint">
            Filed outside the app
          </td>
        </tr>
      );
    }
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
        <td className="text-right tabular-nums">{row ? centsToPesos(row.grossSalesCents, { withSymbol: true }) : "—"}</td>
        <td>
          {locked && <span className="text-xs text-faint">filed</span>}
          {filing && (
            <Link href={`/clients/${id}/filings/${filing.id}`} className="ml-2 text-xs underline">
              View filing
            </Link>
          )}
        </td>
      </tr>
    );
  }

  // D159 — the outside quarters read as ONE row, "Previous quarters", not Q1/Q2 rows.
  const otherQuarters = QUARTERS.filter((q) => q !== editableQuarter && !outsideQuarters.has(q));
  const showPreviousQuarters = [...outsideQuarters].some((q) => q !== editableQuarter);

  return (
    <div className="mx-auto max-w-3xl">
      <ClientStickyBar headerId="client-page-header" clientId={id} name={client.registeredName} tin={client.tin} />
      <div id="client-page-header" className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Income — {client.registeredName}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/clients/${id}/filings/${openFiling.id}`}>
            <Button variant="secondary">
              Back to filing
            </Button>
          </Link>
        </div>
      </div>

      {editableQuarter &&
        (() => {
          const { locked, finalized, filing } = lockInfoFor(editableQuarter);
          const row = byQuarter.get(editableQuarter);
          if (locked) {
            return (
              <div className="mb-4 rounded-lg border border-line bg-background p-4">
                <p className="text-sm font-medium text-ink">{editableQuarter} — read-only</p>
                <p className="mt-1 text-sm text-ink-secondary">
                  This quarter&apos;s return has already been filed, so it can no longer be edited here.
                </p>
                <p className="mt-2 text-sm text-ink-secondary">
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
                atcCodes={atcCodes}
                onSaveNewPayor={boundSaveNewPayor}
              />
            </div>
          );
        })()}

      {editableQuarter && (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <p className="border-b border-line px-3 py-2 text-xs font-medium uppercase tracking-wide text-faint">
            Other quarters this year — read-only
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Quarter</th>
                <th>Payors</th>
                <th className="text-right">Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {showPreviousQuarters && (
                <tr>
                  <td>Previous quarters</td>
                  <td colSpan={3} className="text-faint">
                    Filed outside the app
                  </td>
                </tr>
              )}
              {otherQuarters.map((q) => readOnlyRow(q))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const STATUS_TONE: Record<string, StatusTone> = { NOT_ENTERED: "pending", DRAFT: "waiting", SAVED: "progress", FILED: "done" };

/**
 * D158 — Client page → Income: a view-only table of the year's declared
 * income. Every column centred; nothing clickable, no entry fields. The
 * figures come from getDeclaredIncome (lib/declaredIncome.ts), the same
 * function the certificates-vs-declared-sales check reads, so the Total row
 * and that check always agree. A missing figure is "—", never a silent
 * ₱0.00; "No sales this quarter" is a real ₱0.00.
 */
async function IncomeTable({
  clientId,
  client,
  taxableYear,
}: {
  clientId: string;
  client: { registeredName: string; tin: string };
  taxableYear: number;
}) {
  const [declared, filings] = await Promise.all([
    getDeclaredIncome(clientId, taxableYear),
    prisma.filing.findMany({
      where: { clientId, taxableYear, deletedAt: null },
      include: { workflowSteps: { where: { stepCode: { in: ["FILE_RETURN", "RECORD_SALES"] } }, select: { stepCode: true, status: true } } },
    }),
  ]);
  const byQuarter = new Map(declared.rows.map((r) => [r.quarter, r]));
  const outside = new Set(outsideSalesQuartersFor((await getStartingFigures(clientId, taxableYear))?.latestOutsideReturn ?? "NONE"));
  const money = (cents: number) => centsToPesos(cents, { withSymbol: true });
  // Non-operating income of ₱0 is "nothing entered", shown as a dash.
  const nonOp = (cents: number) => (cents > 0 ? money(cents) : "—");

  const quarterRows = QUARTERS.filter((q) => !outside.has(q)).map((quarter) => {
    const f = filings.find((x) => x.period === filingPeriodForSalesQuarter(quarter));
    const stepDone = (code: string) => f?.workflowSteps.find((s) => s.stepCode === code)?.status === "DONE";
    const row = byQuarter.get(quarter);
    const status = incomeQuarterStatus({ hasRow: !!row, finalized: stepDone("RECORD_SALES"), filed: stepDone("FILE_RETURN") });
    return { quarter, row, status };
  });
  const hasAnyFigure = declared.previousQuarters != null || declared.rows.length > 0;
  const prev = declared.previousQuarters;

  return (
    <div className="mx-auto max-w-4xl">
      <ClientStickyBar headerId="client-page-header" clientId={clientId} name={client.registeredName} tin={client.tin} />
      <div id="client-page-header" className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-ink">Income — {client.registeredName}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <form method="get" className="flex items-center gap-2">
            <label className="text-sm text-ink-secondary">Year</label>
            <input type="number" name="year" defaultValue={taxableYear} className="h-9 w-24 rounded-md border border-line px-2 text-sm" />
            <Button type="submit" variant="secondary">
              Go
            </Button>
          </form>
          <Link href={`/clients/${clientId}`}>
            <Button variant="secondary">
              Back to client
            </Button>
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="data-table data-table-centered">
          <thead>
            <tr>
              <th>Period</th>
              <th>Gross sales</th>
              <th>Non-operating income</th>
              <th>Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {prev && (
              <tr>
                <td>Previous quarters</td>
                <td className="tabular-nums">{money(prev.grossSalesCents)}</td>
                <td className="tabular-nums">{nonOp(prev.nonOperatingIncomeCents)}</td>
                <td className="tabular-nums">{money(prev.grossSalesCents + prev.nonOperatingIncomeCents)}</td>
                <td>
                  <StatusBadge tone="pending">Filed outside the app</StatusBadge>
                </td>
              </tr>
            )}
            {quarterRows.map(({ quarter, row, status }) => (
              <tr key={quarter}>
                <td>
                  {quarter} {taxableYear}
                </td>
                <td className="tabular-nums">{row ? money(row.grossSalesCents) : "—"}</td>
                <td className="tabular-nums">{row ? nonOp(row.nonOperatingIncomeCents) : "—"}</td>
                <td className="tabular-nums">{row ? money(row.grossSalesCents + row.nonOperatingIncomeCents) : "—"}</td>
                <td>
                  <StatusBadge tone={STATUS_TONE[status]}>{INCOME_QUARTER_STATUS_LABEL[status]}</StatusBadge>
                </td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td>Total {taxableYear}</td>
              <td className="tabular-nums">{hasAnyFigure ? money(declared.grossSalesTotalCents) : "—"}</td>
              <td className="tabular-nums">{hasAnyFigure ? nonOp(declared.nonOperatingTotalCents) : "—"}</td>
              <td className="tabular-nums">{hasAnyFigure ? money(declared.grossSalesTotalCents + declared.nonOperatingTotalCents) : "—"}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
