import { describe, it, expect } from "vitest";
import type { SummaryLine } from "@/lib/workflow/summaryLines";
import { buildClientTaxAdviceMessage, type ClientTaxAdviceMessageInput } from "@/lib/workflow/clientTaxAdviceMessage";

/**
 * Brief #5e §9 — step 4's copyable client advice message, replaced with
 * the bookkeeper's own wording. Only 1701Q/1701A are in scope; the caller
 * decides not to render it at all for MIXED_INCOME's annual return (Form
 * 1701), which has no sheet built.
 *
 * Brief #5f §6 — the "If you have any questions, please feel free to let
 * me know." line is removed from every variant; each now ends with the
 * payment/overpayment paragraph, then "Thank you!".
 */
const payableSummary: SummaryLine[] = [
  { kind: "figure", label: "Gross sales this quarter", amountCents: 130_000_00 },
  { kind: "figure", label: "Taxable income, year to date", amountCents: 112_000_00 },
  { kind: "figure", label: "Tax due, year to date", amountCents: 16_800_00 },
  { kind: "credit", label: "Less: tax paid on earlier quarters", amountCents: 3_000_00 },
  { kind: "credit", label: "Less: creditable withholding (Form 2307)", amountCents: 1_700_00 },
  { kind: "result", label: "Amount payable", amountCents: 12_100_00 },
];

function baseInput(overrides: Partial<ClientTaxAdviceMessageInput> = {}): ClientTaxAdviceMessageInput {
  return {
    clientRegisteredName: "Maria Santos",
    clientFirstName: "Maria",
    period: "Q3",
    taxableYear: 2026,
    formType: "F1701Q",
    summary: payableSummary,
    isOverpayment: false,
    clientDueDate: new Date("2026-11-06T00:00:00.000Z"),
    ...overrides,
  };
}

describe("buildClientTaxAdviceMessage", () => {
  it("payable: matches the bookkeeper's exact wording", () => {
    const message = buildClientTaxAdviceMessage(baseInput());
    expect(message.body).toBe(
      [
        "Hi Maria,",
        "",
        "Here's the computation for your 1701Q Q3 2026 return:",
        "",
        "  Gross sales this quarter                  ₱130,000.00",
        "  Taxable income, year to date              ₱112,000.00",
        "  Tax due, year to date                     ₱16,800.00",
        "  Less: tax paid on earlier quarters        ₱3,000.00",
        "  Less: creditable withholding (Form 2307)  ₱1,700.00",
        "  Amount payable                            ₱12,100.00",
        "",
        "Due date: November 6, 2026",
        "",
        "Please let me know when you plan to make the payment.",
        "",
        "Thank you!",
      ].join("\n"),
    );
  });

  it("quarterly overpayment: matches the bookkeeper's exact wording", () => {
    const message = buildClientTaxAdviceMessage(
      baseInput({
        period: "Q1",
        summary: [
          { kind: "figure", label: "Gross sales this quarter", amountCents: 450_000_00 },
          { kind: "figure", label: "Tax due, year to date", amountCents: 16_000_00 },
          { kind: "credit", label: "Less: creditable withholding (Form 2307)", amountCents: 22_500_00 },
          { kind: "result", label: "Overpayment", amountCents: 6_500_00 },
        ],
        isOverpayment: true,
      }),
    );
    expect(message.body).toBe(
      [
        "Hi Maria,",
        "",
        "Here's the computation for your 1701Q Q1 2026 return:",
        "",
        "  Gross sales this quarter                  ₱450,000.00",
        "  Tax due, year to date                     ₱16,000.00",
        "  Less: creditable withholding (Form 2307)  ₱22,500.00",
        "  Overpayment                               ₱6,500.00",
        "",
        "There is nothing to pay this quarter. The overpayment will be applied to your next return this year.",
        "",
        "Thank you!",
      ].join("\n"),
    );
    expect(message.body).not.toMatch(/Amount payable|Due date/);
  });

  it("annual overpayment with no election yet: uses '1701A 2026' and the get-in-touch line", () => {
    const message = buildClientTaxAdviceMessage(
      baseInput({
        period: "ANNUAL",
        formType: "F1701A",
        summary: [{ kind: "result", label: "Overpayment", amountCents: 9_987_00 }],
        isOverpayment: true,
        yearEndCreditElection: null,
      }),
    );
    expect(message.body).toContain("Here's the computation for your 1701A 2026 return:");
    expect(message.body).toMatch(/Overpayment\s+₱9,987\.00/);
    expect(message.body).toContain("I'll get in touch with you about how the overpayment will be applied.");
    expect(message.body).not.toMatch(/refunded to you|Tax Credit Certificate|carried over to next year's return/);
  });

  it("annual overpayment with yearEndCreditElection CARRY_OVER: states it directly instead of asking", () => {
    const message = buildClientTaxAdviceMessage(
      baseInput({
        period: "ANNUAL",
        formType: "F1701A",
        isOverpayment: true,
        yearEndCreditElection: "CARRY_OVER",
      }),
    );
    expect(message.body).toContain("The overpayment will be carried over to next year's return.");
    expect(message.body).not.toContain("I'll get in touch with you");
  });

  it("annual overpayment with yearEndCreditElection REFUND", () => {
    const message = buildClientTaxAdviceMessage(
      baseInput({ period: "ANNUAL", formType: "F1701A", isOverpayment: true, yearEndCreditElection: "REFUND" }),
    );
    expect(message.body).toContain("The overpayment will be refunded to you.");
  });

  it("annual overpayment with yearEndCreditElection TCC", () => {
    const message = buildClientTaxAdviceMessage(
      baseInput({ period: "ANNUAL", formType: "F1701A", isOverpayment: true, yearEndCreditElection: "TCC" }),
    );
    expect(message.body).toContain("The overpayment will be issued to you as a Tax Credit Certificate.");
  });

  it("annual overpayment with yearEndCreditElection NA: still asks, same as unset", () => {
    const message = buildClientTaxAdviceMessage(
      baseInput({ period: "ANNUAL", formType: "F1701A", isOverpayment: true, yearEndCreditElection: "NA" }),
    );
    expect(message.body).toContain("I'll get in touch with you about how the overpayment will be applied.");
  });

  it("keeps the existing subject line format", () => {
    const message = buildClientTaxAdviceMessage(baseInput());
    expect(message.subject).toBe("Maria Santos — 1701Q Q3 2026 computation");
  });

  it("brief #5f §6: no variant contains the 'questions' line, and every variant ends with 'Thank you!'", () => {
    const payable = buildClientTaxAdviceMessage(baseInput());
    const quarterlyOverpayment = buildClientTaxAdviceMessage(
      baseInput({ isOverpayment: true }),
    );
    const annualOverpayment = buildClientTaxAdviceMessage(
      baseInput({ period: "ANNUAL", formType: "F1701A", isOverpayment: true }),
    );
    for (const message of [payable, quarterlyOverpayment, annualOverpayment]) {
      expect(message.body).not.toMatch(/questions/i);
      expect(message.body.endsWith("Thank you!")).toBe(true);
    }
  });
});
