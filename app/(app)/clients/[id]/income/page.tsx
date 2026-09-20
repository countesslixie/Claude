import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { QuarterlySalesCard } from "@/components/quarterly-sales-card";
import { upsertQuarterlySales } from "@/lib/actions/quarterlySales";
import { centsToPesos } from "@/lib/money";
import { currentTaxableYearManila } from "@/lib/dates";

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;

/**
 * D26/§5.5 — declared gross sales, one figure per client per taxable-year
 * quarter. This is the only place income enters the system; a Form 2307
 * never contributes to it (see the 2307 register). Four entries per
 * year — deliberately not a grid or a transaction ledger.
 */
export default async function IncomePage({
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

  const taxableYear = year ? Number(year) : currentTaxableYearManila();

  const rows = await prisma.quarterlySales.findMany({ where: { clientId: id, taxableYear } });
  const byQuarter = new Map(rows.map((r) => [r.quarter, r]));

  const yearTotalGrossCents = rows.reduce((sum, r) => sum + r.grossSalesCents, 0);
  const yearTotalNonOperatingCents = rows.reduce((sum, r) => sum + r.nonOperatingIncomeCents, 0);

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
      </div>

      <div className="flex flex-col gap-4">
        {QUARTERS.map((quarter) => {
          const row = byQuarter.get(quarter);
          const boundAction = upsertQuarterlySales.bind(null, id, taxableYear, quarter);
          return (
            <QuarterlySalesCard
              key={quarter}
              quarter={quarter}
              isQ4={quarter === "Q4"}
              action={boundAction}
              initialValues={
                row
                  ? {
                      grossSales: centsToPesos(row.grossSalesCents),
                      nonOperatingIncome: centsToPesos(row.nonOperatingIncomeCents),
                      sourceNote: row.sourceNote ?? "",
                      notes: row.notes ?? "",
                    }
                  : undefined
              }
            />
          );
        })}
      </div>
    </div>
  );
}
