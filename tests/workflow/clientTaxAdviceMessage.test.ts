import { describe, it, expect } from "vitest";
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
function baseInput(overrides: Partial<ClientTaxAdviceMessageInput> = {}): ClientTaxAdviceMessageInput {
  return {
    clientRegisteredName: "Maria Santos",
    clientFirstName: "Maria",
    period: "Q3",
    taxableYear: 2026,
    formType: "F1701Q",
    grossSalesCents: 130_000_00,
    taxDueCents: 16_800_00,
    totalCreditsCents: 4_700_00,
    taxPayableCents: 12_100_00,
    isOverpayment: false,
    overpaymentCents: 0,
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
        "Gross sales/receipts: ₱130,000.00",
        "Tax due: ₱16,800.00",
        "Less: Total credits: ₱4,700.00",
        "Amount payable: ₱12,100.00",
        "Due date: November 6, 2026",
        "",
        "Please let me know when you plan to make the payment, or if you would like me to advance the payment on your behalf.",
        "",
        "Thank you!",
      ].join("\n"),
    );
  });

  it("quarterly overpayment: matches the bookkeeper's exact wording", () => {
    const message = buildClientTaxAdviceMessage(
      baseInput({
        period: "Q1",
        grossSalesCents: 450_000_00,
        taxDueCents: 16_000_00,
        totalCreditsCents: 22_500_00,
        taxPayableCents: 0,
        isOverpayment: true,
        overpaymentCents: 6_500_00,
      }),
    );
    expect(message.body).toBe(
      [
        "Hi Maria,",
        "",
        "Here's the computation for your 1701Q Q1 2026 return:",
        "",
        "Gross sales/receipts: ₱450,000.00",
        "Tax due: ₱16,000.00",
        "Less: Total credits: ₱22,500.00",
        "Overpayment: ₱6,500.00",
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
        grossSalesCents: 1_424_056_00,
        taxDueCents: 93_924_00,
        totalCreditsCents: 83_937_00,
        taxPayableCents: 0,
        isOverpayment: true,
        overpaymentCents: 9_987_00,
        yearEndCreditElection: null,
      }),
    );
    expect(message.body).toContain("Here's the computation for your 1701A 2026 return:");
    expect(message.body).toContain("Overpayment: ₱9,987.00");
    expect(message.body).toContain("I'll get in touch with you about how the overpayment will be applied.");
    expect(message.body).not.toMatch(/refunded to you|Tax Credit Certificate|carried over to next year's return/);
  });

  it("annual overpayment with yearEndCreditElection CARRY_OVER: states it directly instead of asking", () => {
    const message = buildClientTaxAdviceMessage(
      baseInput({
        period: "ANNUAL",
        formType: "F1701A",
        isOverpayment: true,
        overpaymentCents: 9_987_00,
        taxPayableCents: 0,
        yearEndCreditElection: "CARRY_OVER",
      }),
    );
    expect(message.body).toContain("The overpayment will be carried over to next year's return.");
    expect(message.body).not.toContain("I'll get in touch with you");
  });

  it("annual overpayment with yearEndCreditElection REFUND", () => {
    const message = buildClientTaxAdviceMessage(
      baseInput({ period: "ANNUAL", formType: "F1701A", isOverpayment: true, overpaymentCents: 1_000_00, taxPayableCents: 0, yearEndCreditElection: "REFUND" }),
    );
    expect(message.body).toContain("The overpayment will be refunded to you.");
  });

  it("annual overpayment with yearEndCreditElection TCC", () => {
    const message = buildClientTaxAdviceMessage(
      baseInput({ period: "ANNUAL", formType: "F1701A", isOverpayment: true, overpaymentCents: 1_000_00, taxPayableCents: 0, yearEndCreditElection: "TCC" }),
    );
    expect(message.body).toContain("The overpayment will be issued to you as a Tax Credit Certificate.");
  });

  it("annual overpayment with yearEndCreditElection NA: still asks, same as unset", () => {
    const message = buildClientTaxAdviceMessage(
      baseInput({ period: "ANNUAL", formType: "F1701A", isOverpayment: true, overpaymentCents: 1_000_00, taxPayableCents: 0, yearEndCreditElection: "NA" }),
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
      baseInput({ isOverpayment: true, overpaymentCents: 1_000_00, taxPayableCents: 0 }),
    );
    const annualOverpayment = buildClientTaxAdviceMessage(
      baseInput({ period: "ANNUAL", formType: "F1701A", isOverpayment: true, overpaymentCents: 1_000_00, taxPayableCents: 0 }),
    );
    for (const message of [payable, quarterlyOverpayment, annualOverpayment]) {
      expect(message.body).not.toMatch(/questions/i);
      expect(message.body.endsWith("Thank you!")).toBe(true);
    }
  });
});
