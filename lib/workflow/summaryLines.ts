import type { FilingComputationResult } from "@/lib/tax/types";
import { centsToPesos } from "@/lib/money";

/**
 * D114 (brief #5t, amending D51/D102/D107) — the ONE summary builder behind
 * both client messages: step 4's advice and step 16's "filed" email. Both
 * print these exact lines, from the same sheet, so they can never disagree.
 *
 * Read straight off the filing's sheet, following the return's own lines;
 * it reconciles: tax due, less each credit, equals the amount payable /
 * overpayment printed last. Zero lines are left out.
 */
export type SummaryLineKind = "figure" | "credit" | "result";

export interface SummaryLine {
  kind: SummaryLineKind;
  label: string;
  amountCents: number;
}

/**
 * The email's summary lines from the frozen sheet, in the return's own
 * order. Credits are positive amounts under "Less:" labels; a "Rounding"
 * credit (positive or negative) appears only when the sheet's whole-peso
 * total credits differ from the sum of the printed lines.
 */
export function buildSummaryLines(sheet: FilingComputationResult): SummaryLine[] {
  const lines: SummaryLine[] = [];
  const figure = (label: string, amountCents: number, always = true) => {
    if (always || amountCents !== 0) lines.push({ kind: "figure", label, amountCents });
  };
  const credit = (label: string, amountCents: number) => {
    if (amountCents !== 0) lines.push({ kind: "credit", label, amountCents });
  };
  const rounding = (totalCreditsCents: number) => {
    const printed = lines.filter((l) => l.kind === "credit").reduce((sum, l) => sum + l.amountCents, 0);
    credit("Rounding to whole pesos", totalCreditsCents - printed);
  };

  if ("item54TaxDueCents" in sheet) {
    figure("Gross sales this quarter", sheet.item47GrossSalesCents);
    figure("Other (non-operating) income this quarter", sheet.item48NonOperatingCents, false);
    figure("Taxable income, year to date", sheet.item53TaxableIncomeCents);
    figure("Tax due, year to date", sheet.item54TaxDueCents);
    credit("Less: excess credit from last year", sheet.item55PriorYearExcessCreditCents);
    credit("Less: tax paid on earlier quarters", sheet.item56PriorPeriodPaymentsCents);
    credit("Less: creditable withholding (Form 2307)", sheet.item57CwtPriorQuartersCents + sheet.item58CwtThisQuarterCents);
    credit("Less: other credits", sheet.item61OtherCreditsCents);
    rounding(sheet.item62TotalCreditsCents);
  } else if ("item56TaxDueCents" in sheet) {
    figure("Gross sales for the year", sheet.item47GrossSalesCents);
    figure("Other (non-operating) income for the year", sheet.item52NonOperatingCents, false);
    figure("Taxable income for the year", sheet.item55TaxableIncomeCents);
    figure("Tax due for the year", sheet.item56TaxDueCents);
    credit("Less: excess credit from last year", sheet.item57PriorYearExcessCreditCents);
    credit("Less: tax paid on the quarterly returns", sheet.item58PriorPeriodPaymentsCents);
    credit("Less: creditable withholding (Form 2307)", sheet.item59CwtQ1ToQ3Cents + sheet.item60CwtQ4Cents);
    credit("Less: other credits", sheet.item63OtherCreditsCents);
    rounding(sheet.item64TotalCreditsCents);
  } else {
    // Legacy shape: Form 1701 (mixed-income annual) and any snapshot frozen before the form-line sheets.
    figure("Gross sales, year to date", sheet.cumulativeGrossSalesCents);
    figure("Taxable income, year to date", sheet.taxableBaseCents);
    figure("Tax due, year to date", sheet.incomeTaxDueCents);
    credit("Less: excess credit from last year", sheet.priorYearExcessCreditCents);
    credit("Less: tax paid on earlier returns", sheet.priorPeriodPaymentsCents);
    credit("Less: creditable withholding (Form 2307)", sheet.cumulativeCwtCents);
  }

  lines.push(
    sheet.isOverpayment
      ? { kind: "result", label: "Overpayment", amountCents: sheet.overpaymentCents }
      : { kind: "result", label: "Amount payable", amountCents: sheet.taxPayableCents },
  );
  return lines;
}

/** Tax due less every credit — positive is payable, negative is an overpayment. For checking that the printed lines add up. */
export function signedResultOf(lines: SummaryLine[]): number {
  const taxDue = lines.filter((l) => l.kind === "figure" && /^Tax due/.test(l.label)).reduce((s, l) => s + l.amountCents, 0);
  const credits = lines.filter((l) => l.kind === "credit").reduce((s, l) => s + l.amountCents, 0);
  return taxDue - credits;
}


/** The lines as plain text, labels padded into a column — the same layout in both messages. */
export function formatSummaryLines(lines: SummaryLine[]): string[] {
  const width = Math.max(...lines.map((l) => l.label.length)) + 2;
  return lines.map((l) => `  ${l.label.padEnd(width)}${centsToPesos(l.amountCents, { withSymbol: true })}`);
}
