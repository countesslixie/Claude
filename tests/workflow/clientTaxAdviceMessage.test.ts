import { describe, it, expect } from "vitest";
import { buildClientTaxAdviceMessage, type ClientTaxAdviceMessageInput } from "@/lib/workflow/clientTaxAdviceMessage";

/**
 * Brief #5d §8 — step 4's copyable client advice message. Only
 * 1701Q/1701A are in scope; the caller decides not to render it at all
 * for MIXED_INCOME's annual return (Form 1701), which has no sheet built.
 */
function baseInput(overrides: Partial<ClientTaxAdviceMessageInput> = {}): ClientTaxAdviceMessageInput {
  return {
    clientRegisteredName: "Juan Dela Cruz",
    clientFirstName: "Juan",
    period: "Q2",
    taxableYear: 2026,
    formType: "F1701Q",
    grossSalesCents: 60_000_00,
    taxDueCents: 6_400_00,
    totalCreditsCents: 5_250_00,
    taxPayableCents: 1_150_00,
    isOverpayment: false,
    overpaymentCents: 0,
    adjustedDueDate: new Date("2026-08-17T00:00:00.000Z"),
    ...overrides,
  };
}

describe("buildClientTaxAdviceMessage", () => {
  it("payable: gives the amount and the due date, and asks the client to confirm or arrange payment", () => {
    const message = buildClientTaxAdviceMessage(baseInput());
    expect(message.body).toContain("Amount payable: ₱1,150.00, due Aug 17, 2026.");
    expect(message.body).toMatch(/confirm this amount|arrange payment/i);
    expect(message.body).not.toContain("overpayment");
  });

  it("quarterly overpayment: says nothing is payable this quarter and it applies to the next return, without asking for payment", () => {
    const message = buildClientTaxAdviceMessage(
      baseInput({ period: "Q2", isOverpayment: true, overpaymentCents: 500_00, taxPayableCents: 0 }),
    );
    expect(message.body).toContain("Nothing is payable this quarter");
    expect(message.body).toContain("₱500.00");
    expect(message.body).toContain("applied to your next return this year");
    expect(message.body).not.toMatch(/confirm this amount|arrange payment/i);
  });

  it("annual overpayment with no election yet: says she'll confirm how it's applied, without asserting refund/TCC/carry-over", () => {
    const message = buildClientTaxAdviceMessage(
      baseInput({
        period: "ANNUAL",
        formType: "F1701A",
        isOverpayment: true,
        overpaymentCents: 998_700,
        taxPayableCents: 0,
        yearEndCreditElection: null,
      }),
    );
    expect(message.body).toContain("This return shows an overpayment of ₱9,987.00");
    expect(message.body).toContain("I'll confirm with you how you'd like this applied");
    expect(message.body).not.toMatch(/refunded to you\.|Tax Credit Certificate\.|carried over and applied/);
  });

  it("annual overpayment with yearEndCreditElection already set: uses it instead of asking", () => {
    const message = buildClientTaxAdviceMessage(
      baseInput({
        period: "ANNUAL",
        formType: "F1701A",
        isOverpayment: true,
        overpaymentCents: 998_700,
        taxPayableCents: 0,
        yearEndCreditElection: "CARRY_OVER",
      }),
    );
    expect(message.body).toContain("This will be carried over and applied to next year's return.");
    expect(message.body).not.toContain("I'll confirm with you how you'd like this applied");
  });

  it("annual overpayment with NA election: still asks, same as unset", () => {
    const message = buildClientTaxAdviceMessage(
      baseInput({
        period: "ANNUAL",
        formType: "F1701A",
        isOverpayment: true,
        overpaymentCents: 100_00,
        taxPayableCents: 0,
        yearEndCreditElection: "NA",
      }),
    );
    expect(message.body).toContain("I'll confirm with you how you'd like this applied");
  });

  it("includes the client's name, period, taxable year, gross sales, tax due, and total credits", () => {
    const message = buildClientTaxAdviceMessage(baseInput());
    expect(message.body).toContain("Hi Juan,");
    expect(message.body).toContain("Q2 2026");
    expect(message.body).toContain("₱60,000.00");
    expect(message.body).toContain("₱6,400.00");
    expect(message.body).toContain("₱5,250.00");
  });
});
