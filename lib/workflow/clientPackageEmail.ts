import { centsToPesos } from "@/lib/money";
import { formatManilaDate } from "@/lib/dates";
import type { Period } from "@/lib/tax/types";

/**
 * Step 16's copyable client email draft (rework brief #2 §5). A starting
 * point the bookkeeper edits before sending — she owns the wording, this
 * just fills in what the filing already knows. Lines that don't apply are
 * omitted rather than sent blank (§5: no certificates -> no certificates
 * line; overpayment replaces the tax-paid line rather than sitting beside
 * it).
 */
export interface ClientPackageEmailInput {
  clientRegisteredName: string;
  clientFirstName: string;
  period: Period;
  taxableYear: number;
  filedAt: Date | null;
  grossSalesCents: number;
  taxDueCents: number;
  cwtCents: number;
  isOverpayment: boolean;
  finalAmountCents: number;
  hasCertificates: boolean;
  nextPeriodLabel: Period | null;
  nextPeriodDueDate: Date | null;
}

export function buildClientPackageEmail(input: ClientPackageEmailInput): { subject: string; body: string } {
  const filedDateLabel = input.filedAt ? formatManilaDate(input.filedAt) : "[date filed]";
  const subject = `${input.clientRegisteredName} — 1701Q ${input.period} ${input.taxableYear}, filed ${filedDateLabel}`;

  const contentsLines = [
    "  · Filed return (1701Q)",
    "  · Proof of payment",
    "  · BIR confirmation (TRRC)",
  ];
  if (input.hasCertificates) contentsLines.push("  · Form 2307 certificates claimed this quarter");

  const summaryLines = [
    `  Gross sales/receipts        ${centsToPesos(input.grossSalesCents, { withSymbol: true })}`,
    `  Tax due                     ${centsToPesos(input.taxDueCents, { withSymbol: true })}`,
  ];
  if (input.hasCertificates) {
    summaryLines.push(`  Less creditable withholding ${centsToPesos(input.cwtCents, { withSymbol: true })}`);
  }
  summaryLines.push(
    input.isOverpayment
      ? `  Overpayment carried forward  ${centsToPesos(input.finalAmountCents, { withSymbol: true })}`
      : `  Tax paid                     ${centsToPesos(input.finalAmountCents, { withSymbol: true })}`,
  );

  const bodyLines = [
    `Hi ${input.clientFirstName},`,
    "",
    `Your 1701Q for ${input.period} ${input.taxableYear} has been filed. The attached package contains:`,
    "",
    ...contentsLines,
    "",
    "Summary for the period:",
    "",
    ...summaryLines,
    "",
  ];

  if (input.nextPeriodLabel && input.nextPeriodDueDate) {
    bodyLines.push(
      `Next filing: 1701Q for ${input.nextPeriodLabel}, due ${formatManilaDate(input.nextPeriodDueDate)}.`,
      "",
    );
  }

  bodyLines.push("Please keep this for your records.");

  return { subject, body: bodyLines.join("\n") };
}
