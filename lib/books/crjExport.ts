import ExcelJS from "exceljs";
import { centsToPesos } from "@/lib/money";
import { formatManilaDate } from "@/lib/dates";
import type { CashReceiptsJournal } from "./crj";

const COLUMNS = ["Date", "OR No.", "Payor", "Particulars", "Gross Receipts", "Creditable WHT", "Cash Received"];

/**
 * XLSX export for loose-leaf submission (SPEC.md 9): registered name,
 * TIN, and period in the header, page numbering (footer, for print),
 * and a monthly totals line per month.
 */
export async function exportCrjToXlsx(journal: CashReceiptsJournal): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Cash Receipts Journal", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    headerFooter: { oddFooter: "&CPage &P of &N" },
  });

  sheet.mergeCells(1, 1, 1, COLUMNS.length);
  sheet.getCell(1, 1).value = journal.clientName;
  sheet.getCell(1, 1).font = { bold: true, size: 14 };

  sheet.mergeCells(2, 1, 2, COLUMNS.length);
  sheet.getCell(2, 1).value = `TIN: ${journal.clientTin}`;

  sheet.mergeCells(3, 1, 3, COLUMNS.length);
  sheet.getCell(3, 1).value = `Cash Receipts Journal — TY${journal.taxableYear} ${journal.period}`;
  sheet.getCell(3, 1).font = { bold: true };

  sheet.addRow([]);
  const headerRow = sheet.addRow(COLUMNS);
  headerRow.font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 5 }];

  for (const month of journal.months) {
    const monthHeaderRow = sheet.addRow([month.monthLabel]);
    monthHeaderRow.font = { italic: true, bold: true };

    for (const row of month.rows) {
      sheet.addRow([
        formatManilaDate(row.transactionDate),
        row.orNumber ?? "",
        row.payorName,
        row.particulars ?? "",
        centsToPesos(row.grossAmountCents),
        centsToPesos(row.withholdingTaxCents),
        centsToPesos(row.cashReceivedCents),
      ]);
    }

    const totalRow = sheet.addRow([
      "",
      "",
      "",
      `${month.monthLabel} total`,
      centsToPesos(month.totals.grossAmountCents),
      centsToPesos(month.totals.withholdingTaxCents),
      centsToPesos(month.totals.cashReceivedCents),
    ]);
    totalRow.font = { bold: true };
  }

  const grandRow = sheet.addRow([
    "",
    "",
    "",
    `GRAND TOTAL (${journal.grandTotals.transactionCount} transactions)`,
    centsToPesos(journal.grandTotals.grossAmountCents),
    centsToPesos(journal.grandTotals.withholdingTaxCents),
    centsToPesos(journal.grandTotals.cashReceivedCents),
  ]);
  grandRow.font = { bold: true };

  sheet.columns.forEach((col, i) => {
    col.width = i === 3 ? 28 : i === 2 ? 24 : 16;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
