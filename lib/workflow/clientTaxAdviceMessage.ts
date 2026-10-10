import { formatManilaDateLong } from "@/lib/dates";
import type { Period } from "@/lib/tax/types";
import { formatSummaryLines, type SummaryLine } from "@/lib/workflow/summaryLines";

/**
 * Step 4's copyable client advice message (brief #5d §8, wording replaced
 * by brief #5e §9 with the bookkeeper's own text). Only 1701Q/1701A are in
 * scope — MIXED_INCOME's annual return (1701) has no sheet built, so this
 * is never called for it; the caller decides not to render step 4's
 * message at all in that case.
 */
export interface ClientTaxAdviceMessageInput {
  clientRegisteredName: string;
  clientFirstName: string;
  period: Period;
  taxableYear: number;
  formType: "F1701Q" | "F1701A";
  /** D114 — the shared year-to-date summary (buildSummaryLines), the same lines step 16's email prints. */
  summary: SummaryLine[];
  isOverpayment: boolean;
  /**
   * D192 — the final figure is exactly ₱0 payable (not an overpayment). Nothing is
   * due, so the message has no due date and no payment question. Optional: unset = false.
   */
  isZeroPayable?: boolean;
  /**
   * Brief #5e §9 — the date shown to the CLIENT: the filing's adjusted BIR
   * due date minus TaxRuleSet.clientPaymentLeadDays calendar days, shifted
   * earlier on a weekend/holiday. Computed by the caller
   * (lib/tax/deadlines.ts's clientPaymentDueDate) — this function only
   * formats it. Ignored when the filing is an overpayment (no payment to
   * schedule).
   */
  clientDueDate: Date;
  /** Only consulted for an ANNUAL overpayment; unset/NA means "not yet decided." */
  yearEndCreditElection?: "REFUND" | "TCC" | "CARRY_OVER" | "NA" | null;
}

const FORM_LABEL: Record<"F1701Q" | "F1701A", string> = { F1701Q: "1701Q", F1701A: "1701A" };

const ELECTION_SENTENCE: Record<"REFUND" | "TCC" | "CARRY_OVER", string> = {
  REFUND: "The overpayment will be refunded to you.",
  TCC: "The overpayment will be issued to you as a Tax Credit Certificate.",
  CARRY_OVER: "The overpayment will be carried over to next year's return.",
};

export function buildClientTaxAdviceMessage(input: ClientTaxAdviceMessageInput): { subject: string; body: string } {
  const formLabel = FORM_LABEL[input.formType];
  const periodLabel = input.period === "ANNUAL" ? String(input.taxableYear) : `${input.period} ${input.taxableYear}`;

  const subject = `${input.clientRegisteredName} — ${formLabel} ${input.period === "ANNUAL" ? "Annual" : input.period} ${input.taxableYear} computation`;

  const bodyLines = [
    `Hi ${input.clientFirstName},`,
    "",
    `Here's the computation for your ${formLabel} ${periodLabel} return:`,
    "",
    ...formatSummaryLines(input.summary, { blankBeforeResult: true }),
  ];

  if (!input.isOverpayment && !input.isZeroPayable) {
    bodyLines.push(
      "",
      `Due date for filing: ${formatManilaDateLong(input.clientDueDate)}.`,
      "",
      // D107 (brief #5s) — no advance offer: her letter requires advance requests by the 10th, long past by the time this goes out.
      "Please let me know when you plan to make the payment.",
    );
  } else if (input.isOverpayment) {
    bodyLines.push("");
    if (input.period !== "ANNUAL") {
      bodyLines.push("There is nothing to pay this quarter. The overpayment will be applied to your next return this year.");
    } else {
      const election = input.yearEndCreditElection;
      bodyLines.push(
        election && election !== "NA"
          ? ELECTION_SENTENCE[election]
          : "I'll get in touch with you about how the overpayment will be applied.",
      );
    }
  }

  // D192 — when nothing is payable (₱0 or an overpayment) the return follows separately.
  if (input.isOverpayment || input.isZeroPayable) {
    bodyLines.push("", "The filed tax return and supporting documents will follow in a separate email.");
  }

  bodyLines.push("", "Thank you!");

  return { subject, body: bodyLines.join("\n") };
}
