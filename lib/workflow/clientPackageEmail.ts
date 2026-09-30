import { centsToPesos } from "@/lib/money";
import { formatManilaDate } from "@/lib/dates";
import { formLabel } from "@/lib/workflow/eSubmissionEmail";
import type { FilingComputationResult, Period } from "@/lib/tax/types";

/**
 * Step 16's copyable client email (rework brief #2 §5; rebuilt by D102,
 * brief #5r). A starting point the bookkeeper edits before sending — she
 * owns the wording, this just fills in what the filing already knows.
 *
 * The summary is read straight off the filing's FROZEN sheet (getFilingSheet,
 * D83), following the return's own lines, and it reconciles: tax due, less
 * each credit, equals the payable / overpayment printed last. Zero lines
 * are left out. The "attached" list is the package's own document list
 * (lib/documents/filingPackage.ts), so it can never name a file the zip
 * doesn't hold.
 */
export type SummaryLineKind = "figure" | "credit" | "result";

export interface SummaryLine {
  kind: SummaryLineKind;
  label: string;
  amountCents: number;
}

/** "Annual ITR" or "Q3 2026" — never a raw period code. */
export function periodPlainName(period: Period, taxableYear: number): string {
  return period === "ANNUAL" ? "Annual ITR" : `${period} ${taxableYear}`;
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
      : { kind: "result", label: "Tax payable", amountCents: sheet.taxPayableCents },
  );
  return lines;
}

/** Tax due less every credit — positive is payable, negative is an overpayment. For checking that the printed lines add up. */
export function signedResultOf(lines: SummaryLine[]): number {
  const taxDue = lines.filter((l) => l.kind === "figure" && /^Tax due/.test(l.label)).reduce((s, l) => s + l.amountCents, 0);
  const credits = lines.filter((l) => l.kind === "credit").reduce((s, l) => s + l.amountCents, 0);
  return taxDue - credits;
}

export interface ClientPackageEmailInput {
  clientRegisteredName: string;
  clientFirstName: string;
  /** The client record's email, or null — the To line then reads as missing and never blocks. */
  clientEmail: string | null;
  period: Period;
  taxableYear: number;
  /** "F1701Q" | "F1701A" | "F1701" — Filing.formType. */
  formType: string;
  filedAt: Date | null;
  /** The filing's frozen sheet (getFilingSheet, D83). */
  sheet: FilingComputationResult;
  /** The package's own document list (lib/documents/filingPackage.ts). */
  attachments: { label: string; filename: string }[];
  /** The next return of this taxable year, if any. */
  next: { period: Period; taxableYear: number; formType: string; dueDate: Date; docsDueDate: Date } | null;
}

export interface ClientPackageEmail {
  /** null when the client has no email on record. */
  to: string | null;
  subject: string;
  body: string;
}

function money(cents: number): string {
  return centsToPesos(cents, { withSymbol: true });
}

export function buildClientPackageEmail(input: ClientPackageEmailInput): ClientPackageEmail {
  const filedDateLabel = input.filedAt ? formatManilaDate(input.filedAt) : "[date filed]";
  const form = formLabel(input.formType);
  const periodName = periodPlainName(input.period, input.taxableYear);
  const returnName = input.period === "ANNUAL" ? `Annual ITR (${form}) for ${input.taxableYear}` : `${form} for ${periodName}`;
  const subject = `${input.clientRegisteredName} — ${form} ${periodName}${input.period === "ANNUAL" ? ` (${input.taxableYear})` : ""}, filed ${filedDateLabel}`;

  const summary = buildSummaryLines(input.sheet);
  const width = Math.max(...summary.map((l) => l.label.length)) + 2;
  const summaryLines = summary.map((l) => `  ${l.label.padEnd(width)}${money(l.amountCents)}`);

  const bodyLines = [`Hi ${input.clientFirstName},`, "", `Your ${returnName} has been filed.`, ""];

  if (input.attachments.length > 0) {
    bodyLines.push("The attached package contains:", "", ...input.attachments.map((a) => `  · ${a.label} — ${a.filename}`), "");
  }

  bodyLines.push("Summary:", "", ...summaryLines, "");

  if (input.next) {
    const nextForm = formLabel(input.next.formType);
    // D106 — the same closing sentence for every period: her engagement letter's document deadline.
    const target = input.next.period === "ANNUAL" ? `Annual ITR (${nextForm})` : `${nextForm} for ${periodPlainName(input.next.period, input.next.taxableYear)}`;
    bodyLines.push(
      `Next filing: ${target}, due ${formatManilaDate(input.next.dueDate)}. Please send required documents by ${formatManilaDate(input.next.docsDueDate)}.`,
      "",
    );
  }

  bodyLines.push("Please keep this for your records.");

  return { to: input.clientEmail?.trim() || null, subject, body: bodyLines.join("\n") };
}
