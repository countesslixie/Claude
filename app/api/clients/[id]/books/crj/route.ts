import { NextResponse } from "next/server";
import { assembleCrj } from "@/lib/books/assembleCrj";
import { exportCrjToXlsx } from "@/lib/books/crjExport";
import { ALL_PERIODS } from "@/lib/tax/periods";
import { currentTaxableYearManila } from "@/lib/dates";
import type { Period } from "@/lib/tax/types";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);

  const yearParam = searchParams.get("year");
  const periodParam = searchParams.get("period");
  const taxableYear = yearParam ? Number(yearParam) : currentTaxableYearManila();
  const period: Period = ALL_PERIODS.includes(periodParam as Period) ? (periodParam as Period) : "Q1";

  const journal = await assembleCrj(id, taxableYear, period);
  const buffer = await exportCrjToXlsx(journal);
  const filename = `crj-${journal.clientName.replace(/\s+/g, "-").toLowerCase()}-${taxableYear}-${period}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buffer.byteLength),
    },
  });
}
