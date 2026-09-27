import { centsToPesos } from "@/lib/money";
import { formatManilaDate } from "@/lib/dates";
import type { Period } from "@/lib/tax/types";

/**
 * Step 4's copyable client advice message (brief #5d §8) — modeled on
 * step 16's client package email (lib/workflow/clientPackageEmail.ts):
 * a starting point the bookkeeper edits before sending, filled in from
 * the filing's own rounded computation sheet. Only 1701Q/1701A are in
 * scope (brief #5d §1) — MIXED_INCOME's annual return (1701) has no sheet
 * built, so this is never called for it; the caller decides not to render
 * step 4's message at all in that case.
 */
export interface ClientTaxAdviceMessageInput {
  clientRegisteredName: string;
  clientFirstName: string;
  period: Period;
  taxableYear: number;
  formType: "F1701Q" | "F1701A";
  /** Item 47 (either form) — this period's gross sales as shown on the sheet. */
  grossSalesCents: number;
  /** Item 54 (1701Q) or item 56 (1701A). */
  taxDueCents: number;
  /** Item 62 (1701Q) or item 64 (1701A). */
  totalCreditsCents: number;
  /** Item 63 (1701Q) or item 65 (1701A). */
  taxPayableCents: number;
  isOverpayment: boolean;
  overpaymentCents: number;
  adjustedDueDate: Date;
  /** Only consulted for an ANNUAL overpayment; unset/NA means "not yet decided." */
  yearEndCreditElection?: "REFUND" | "TCC" | "CARRY_OVER" | "NA" | null;
}

const FORM_LABEL: Record<"F1701Q" | "F1701A", string> = { F1701Q: "1701Q", F1701A: "1701A" };

function periodLabel(period: Period): string {
  return period === "ANNUAL" ? "Annual" : period;
}

const ELECTION_SENTENCE: Record<"REFUND" | "TCC" | "CARRY_OVER", string> = {
  REFUND: "This will be refunded to you.",
  TCC: "This will be issued to you as a Tax Credit Certificate.",
  CARRY_OVER: "This will be carried over and applied to next year's return.",
};

export function buildClientTaxAdviceMessage(input: ClientTaxAdviceMessageInput): { subject: string; body: string } {
  const formLabel = FORM_LABEL[input.formType];
  const period = periodLabel(input.period);
  const dueDateLabel = formatManilaDate(input.adjustedDueDate);

  const subject = `${input.clientRegisteredName} — ${formLabel} ${period} ${input.taxableYear} computation`;

  const summaryLines = [
    `  Gross sales/receipts   ${centsToPesos(input.grossSalesCents, { withSymbol: true })}`,
    `  Tax due                ${centsToPesos(input.taxDueCents, { withSymbol: true })}`,
    `  Total credits          ${centsToPesos(input.totalCreditsCents, { withSymbol: true })}`,
  ];

  const resultLines: string[] = [];
  if (!input.isOverpayment) {
    resultLines.push(
      `Amount payable: ${centsToPesos(input.taxPayableCents, { withSymbol: true })}, due ${dueDateLabel}.`,
      "Please confirm this amount or let me know how you'd like to arrange payment before that date.",
    );
  } else if (input.period !== "ANNUAL") {
    resultLines.push(
      `Nothing is payable this quarter. The overpayment of ${centsToPesos(input.overpaymentCents, {
        withSymbol: true,
      })} is applied to your next return this year — no action needed from you now.`,
    );
  } else {
    resultLines.push(`This return shows an overpayment of ${centsToPesos(input.overpaymentCents, { withSymbol: true })}.`);
    const election = input.yearEndCreditElection;
    if (election && election !== "NA") {
      resultLines.push(ELECTION_SENTENCE[election]);
    } else {
      resultLines.push("I'll confirm with you how you'd like this applied — refund, tax credit certificate, or carried over to next year.");
    }
  }

  const bodyLines = [
    `Hi ${input.clientFirstName},`,
    "",
    `Here's the computation for your ${formLabel} ${period} ${input.taxableYear} return:`,
    "",
    ...summaryLines,
    "",
    ...resultLines,
    "",
    "Please let me know if you have any questions.",
  ];

  return { subject, body: bodyLines.join("\n") };
}
