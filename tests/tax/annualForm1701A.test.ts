import { describe, it, expect } from "vitest";
import { computeAnnualForm } from "@/lib/tax/compute";

/**
 * Brief #5d §3 — the 1701A form-check test, from the bookkeeper's actual
 * filed annual return screenshot. Amounts and taxpayer type only — no
 * client name, TIN, payor name, or address (same rule as D42/brief #4e).
 */
describe("1701A form-check — PURELY_SELF_EMPLOYED, annual figures", () => {
  it("matches the filed 1701A's own line items", () => {
    const result = computeAnnualForm({
      taxableYear: 2026,
      ruleSet: { incomeTaxRateBps: 800, allowableDeductionCents: 25_000_000 },
      fullYearGrossSalesCents: 142_405_600, // 1,424,056.00
      fullYearNonOperatingCents: 0,
      priorYearExcessCreditCents: 0,
      priorPeriodPaymentsQ1ToQ3Cents: 1_273_400, // 12,734.00
      cwtQ1ToQ3Cents: 5_455_600, // 54,556.00
      cwtQ4Cents: 1_664_700, // 16,647.00
    });

    expect(result.item53TotalTaxableIncomeCents).toBe(142_405_600); // 1,424,056.00
    expect(result.item55TaxableIncomeCents).toBe(117_405_600); // 1,174,056.00
    expect(result.item56TaxDueCents).toBe(9_392_400); // 93,924.00
    expect(result.item64TotalCreditsCents).toBe(8_393_700); // 83,937.00
    expect(result.item65PayableCents).toBe(998_700); // 9,987.00 payable (56 - 64, positive: tax due exceeds credits)
    expect(result.isOverpayment).toBe(false);
    expect(result.overpaymentCents).toBe(0);
    expect(result.formType).toBe("F1701A");
  });
});
