import { NextResponse } from "next/server";
import { assembleKeyingWorksheet } from "@/lib/sawt/assembleKeyingWorksheet";
import { exportKeyingWorksheetToXlsx } from "@/lib/sawt/keyingWorksheetExport";
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

  const worksheet = await assembleKeyingWorksheet(id, taxableYear, period);
  const buffer = await exportKeyingWorksheetToXlsx(worksheet);
  const filename = `sawt-worksheet-${worksheet.clientName.replace(/\s+/g, "-").toLowerCase()}-${taxableYear}-${period}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buffer.byteLength),
    },
  });
}
