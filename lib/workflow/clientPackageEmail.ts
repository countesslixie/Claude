import { formatManilaDate } from "@/lib/dates";
import { formLabel } from "@/lib/workflow/eSubmissionEmail";
import type { FilingComputationResult, Period } from "@/lib/tax/types";
import { buildSummaryLines, formatSummaryLines } from "@/lib/workflow/summaryLines";

/**
 * Step 16's copyable client email (rework brief #2 §5; rebuilt by D102,
 * brief #5r). A starting point the bookkeeper edits before sending — she
 * owns the wording, this just fills in what the filing already knows.
 *
 * The summary is the one shared with step 4 (lib/workflow/summaryLines.ts, D114),
 * read off the filing's FROZEN sheet (getFilingSheet, D83). The "attached"
 * list is the package's own document list (lib/documents/filingPackage.ts),
 * by document name only (D110), so it can never name a document the zip
 * doesn't hold. Opens "Hi [first name]," and closes "Thank you!" (D112).
 */
export type { SummaryLine, SummaryLineKind } from "@/lib/workflow/summaryLines";
export { buildSummaryLines, signedResultOf } from "@/lib/workflow/summaryLines";

/** "Annual ITR" or "Q3 2026" — never a raw period code. */
export function periodPlainName(period: Period, taxableYear: number): string {
  return period === "ANNUAL" ? "Annual ITR" : `${period} ${taxableYear}`;
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
  attachments: { label: string }[];
  /** The next return of this taxable year, if any. */
  next: { period: Period; taxableYear: number; formType: string; dueDate: Date; docsDueDate: Date } | null;
}

export interface ClientPackageEmail {
  /** null when the client has no email on record. */
  to: string | null;
  subject: string;
  body: string;
}

export function buildClientPackageEmail(input: ClientPackageEmailInput): ClientPackageEmail {
  const filedDateLabel = input.filedAt ? formatManilaDate(input.filedAt) : "[date filed]";
  const form = formLabel(input.formType);
  const periodName = periodPlainName(input.period, input.taxableYear);
  const returnName = input.period === "ANNUAL" ? `Annual ITR (${form}) for ${input.taxableYear}` : `${form} for ${periodName}`;
  const subject = `${input.clientRegisteredName} — ${form} ${periodName}${input.period === "ANNUAL" ? ` (${input.taxableYear})` : ""}, filed ${filedDateLabel}`;

  const summary = buildSummaryLines(input.sheet);
  const summaryLines = formatSummaryLines(summary);

  const bodyLines = [`Hi ${input.clientFirstName},`, "", `Your ${returnName} has been filed.`, ""];

  if (input.attachments.length > 0) {
    bodyLines.push("The attached package contains:", "", ...input.attachments.map((a) => `  · ${a.label}`), "");
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

  bodyLines.push("Please keep this for your records.", "", "Thank you!");

  return { to: input.clientEmail?.trim() || null, subject, body: bodyLines.join("\n") };
}
