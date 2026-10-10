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
 * order. Credits are positive amounts under "Less:" labels. D188: there is
 * no "Rounding to whole pesos" line any more — the printed lines may differ
 * from the final figure by a few centavos (the form rounds, D49); the final
 * line is still the sheet's own figure.
 *
 * D190: `payableLabel` renames the final "Amount payable" line (step 16 says
 * "Amount paid"); the figure is unchanged, and "Overpayment" is never renamed.
 */
export function buildSummaryLines(sheet: FilingComputationResult, opts?: { payableLabel?: string }): SummaryLine[] {
  const lines: SummaryLine[] = [];
  const figure = (label: string, amountCents: number, always = true) => {
    if (always || amountCents !== 0) lines.push({ kind: "figure", label, amountCents });
  };
  const credit = (label: string, amountCents: number) => {
    if (amountCents !== 0) lines.push({ kind: "credit", label, amountCents });
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
  } else if ("item56TaxDueCents" in sheet) {
    figure("Gross sales for the year", sheet.item47GrossSalesCents);
    figure("Other (non-operating) income for the year", sheet.item52NonOperatingCents, false);
    figure("Taxable income for the year", sheet.item55TaxableIncomeCents);
    figure("Tax due for the year", sheet.item56TaxDueCents);
    credit("Less: excess credit from last year", sheet.item57PriorYearExcessCreditCents);
    credit("Less: tax paid on the quarterly returns", sheet.item58PriorPeriodPaymentsCents);
    credit("Less: creditable withholding (Form 2307)", sheet.item59CwtQ1ToQ3Cents + sheet.item60CwtQ4Cents);
    credit("Less: other credits", sheet.item63OtherCreditsCents);
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
      : { kind: "result", label: opts?.payableLabel ?? "Amount payable", amountCents: sheet.taxPayableCents },
  );
  return lines;
}

/** Tax due less every credit — positive is payable, negative is an overpayment. For checking that the printed lines add up. */
export function signedResultOf(lines: SummaryLine[]): number {
  const taxDue = lines.filter((l) => l.kind === "figure" && /^Tax due/.test(l.label)).reduce((s, l) => s + l.amountCents, 0);
  const credits = lines.filter((l) => l.kind === "credit").reduce((s, l) => s + l.amountCents, 0);
  return taxDue - credits;
}


/**
 * D186 — the lines as plain text, one `Label: amount` per line, no padding
 * (email apps use a proportional font, so padding never lined up).
 * D189: `blankBeforeResult` puts one empty line above the final line (step 4).
 */
export function formatSummaryLines(lines: SummaryLine[], opts?: { blankBeforeResult?: boolean }): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (opts?.blankBeforeResult && l.kind === "result") out.push("");
    out.push(`${l.label}: ${centsToPesos(l.amountCents, { withSymbol: true })}`);
  }
  return out;
}

const escapeHtml = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** A summary line as it appears in the plain text: `Label: ₱1,234.56`. */
const SUMMARY_LINE = /^(.+?): (₱[\d,]+\.\d{2})$/;

/**
 * D186 — the rich-copy version of a message body (steps 4 and 16): the same
 * text, with each run of `Label: amount` lines as a two-column table (label
 * left, amount right-aligned; no bold, borders or colours; inline styles
 * only, since email apps drop <style>) and every other line a plain line
 * with its line breaks kept. A blank line sitting inside a run of summary
 * lines (step 4's, D189) becomes one empty spacer row of the same table.
 * It works from the text itself, so whatever she has edited in the box is
 * what gets copied. Every value is HTML-escaped.
 */
export function messageToHtml(text: string): string {
  const rows = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < rows.length) {
    if (SUMMARY_LINE.test(rows[i])) {
      const tr: string[] = [];
      while (i < rows.length) {
        const m = SUMMARY_LINE.exec(rows[i]);
        if (m) {
          tr.push(
            `<tr><td style="padding:0 24px 0 0;text-align:left">${escapeHtml(m[1])}</td><td style="padding:0;text-align:right">${escapeHtml(m[2])}</td></tr>`,
          );
          i++;
        } else if (rows[i].trim() === "" && i + 1 < rows.length && SUMMARY_LINE.test(rows[i + 1])) {
          tr.push(`<tr><td colspan="2" style="padding:0;height:1em">&nbsp;</td></tr>`);
          i++;
        } else break;
      }
      out.push(`<table style="border-collapse:collapse"><tbody>${tr.join("")}</tbody></table>`);
    } else {
      out.push(`<div style="white-space:pre-wrap">${rows[i] === "" ? "<br>" : escapeHtml(rows[i])}</div>`);
      i++;
    }
  }
  return out.join("");
}
