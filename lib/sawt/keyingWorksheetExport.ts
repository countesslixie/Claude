import ExcelJS from "exceljs";
import { centsToPesos } from "@/lib/money";
import type { KeyingWorksheet } from "./keyingWorksheet";

const COLUMNS = [
  "#",
  "Payor TIN",
  "Payor Name",
  "Payor Address",
  "ATC",
  "Nature of Income Payment",
  "Amount of Income Payment",
  "Amount of Tax Withheld",
];

/** XLSX export of the keying worksheet (SPEC.md 10) — screen + XLSX. */
export async function exportKeyingWorksheetToXlsx(worksheet: KeyingWorksheet): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("SAWT Keying Worksheet", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    headerFooter: { oddFooter: "&CPage &P of &N" },
  });

  sheet.mergeCells(1, 1, 1, COLUMNS.length);
  sheet.getCell(1, 1).value = worksheet.clientName;
  sheet.getCell(1, 1).font = { bold: true, size: 14 };

  sheet.mergeCells(2, 1, 2, COLUMNS.length);
  sheet.getCell(2, 1).value = `TIN: ${worksheet.clientTin}`;

  sheet.mergeCells(3, 1, 3, COLUMNS.length);
  sheet.getCell(3, 1).value = `SAWT Keying Worksheet — TY${worksheet.taxableYear} ${worksheet.period}`;
  sheet.getCell(3, 1).font = { bold: true };

  sheet.mergeCells(4, 1, 4, COLUMNS.length);
  sheet.getCell(4, 1).value =
    `${worksheet.rowCount} row(s) — check against the module's own row count and totals after entry`;
  sheet.getCell(4, 1).font = { italic: true };

  sheet.addRow([]);
  const headerRow = sheet.addRow(COLUMNS);
  headerRow.font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 6 }];

  for (const row of worksheet.rows) {
    sheet.addRow([
      row.rowNumber,
      row.payorTin,
      row.payorName,
      row.payorAddress,
      row.atcCode,
      row.atcDescription,
      centsToPesos(row.incomePaymentCents),
      centsToPesos(row.taxWithheldCents),
    ]);
  }

  const totalRow = sheet.addRow([
    "",
    "",
    "",
    "",
    "",
    `TOTAL (${worksheet.rowCount} rows)`,
    centsToPesos(worksheet.totals.incomePaymentCents),
    centsToPesos(worksheet.totals.taxWithheldCents),
  ]);
  totalRow.font = { bold: true };

  sheet.columns.forEach((col, i) => {
    col.width = i === 2 ? 24 : i === 3 || i === 5 ? 28 : 16;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
