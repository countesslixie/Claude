import { describe, it, expect } from "vitest";
import { computeQuarterlyForm } from "@/lib/tax/compute";
import { sumCwtThroughPeriod, type CertificateForCwt } from "@/lib/tax/cwt";

/**
 * Brief #4e — replaces `scripts/verify-real.ts` (deleted) and its
 * gitignored `scripts/real-fixture.local.ts`, which has never actually
 * been present on any machine this project has run on. This is an
 * ordinary committed test with the same five amounts instead, so it
 * actually runs with the rest of the suite.
 *
 * Brief #5d — updated to the FORM's own figures (whole-peso rounding,
 * locked rule #1, changed with the bookkeeper's explicit approval
 * 2026-09-27). The bookkeeper's actual filed 1701Q reads item 54 (tax
 * due) as 6,635.00 and item 63 (overpayment) as 10,012.00 — the
 * centavo-exact figures this test asserted before brief #5d (6,634.71 /
 * 10,011.99) were the app's number, not the number on the form she
 * actually filed. This test now reproduces the FORM's own line items.
 *
 * These are amounts and taxpayer type only — no client name, TIN, payor
 * name, or address. The payor is named "Payor A" per the brief's
 * instruction to use placeholder names. The certificate split behind the
 * ₱16,646.70 CWT figure is not recoverable in this environment — it lived
 * only in a local fixture that was never reachable here. Represented
 * below as one certificate for the full amount.
 */
describe("real filing regression — TY2026 Q1, PURELY_SELF_EMPLOYED, form figures", () => {
  it("matches the filed 1701Q's own line items", () => {
    // Declared quarterly sales (D26/D33) — the sum of per-customer rows
    // for Q1, the only place income enters the system. Item 47 is this
    // figure exactly, unrounded (centavos, as the form shows).
    const customers = [{ customerName: "Payor A", amountCents: 33_293_390 }];
    const ownGrossSalesCents = customers.reduce((sum, c) => sum + c.amountCents, 0);

    // Certificates entered under this filing's step 2 (D34) — credited
    // through sumCwtThroughPeriod, the same function the real engine
    // uses, not a hand-added total. Item 58 is this figure exactly,
    // unrounded — Q1 has no prior quarters, so item 57 is 0.
    const certificates: CertificateForCwt[] = [
      { id: "cert-a", taxWithheldCents: 16_646_70, status: "RECORDED", claimedOnFilingPeriod: "Q1" },
    ];
    const cwtThisQuarterCents = sumCwtThroughPeriod(certificates, "Q1");

    const result = computeQuarterlyForm({
      taxableYear: 2026,
      period: "Q1",
      taxpayerType: "PURELY_SELF_EMPLOYED",
      ruleSet: { incomeTaxRateBps: 800, allowableDeductionCents: 25_000_000 },
      ownGrossSalesCents,
      ownNonOperatingCents: 0,
      previousCumulativeTaxableIncomeCents: 0,
      priorYearExcessCreditCents: 0,
      priorPeriodPaymentsCents: 0,
      cwtPriorQuartersCents: 0,
      cwtThisQuarterCents,
    });

    expect(result.item47GrossSalesCents).toBe(33_293_390); // 332,933.90
    expect(result.item49TotalIncomeCents).toBe(33_293_400); // 332,934.00
    expect(result.item51CumulativeTaxableIncomeCents).toBe(33_293_400); // 332,934.00
    expect(result.item52AllowableDeductionCents).toBe(25_000_000); // 250,000.00, applied in full
    expect(result.item53TaxableIncomeCents).toBe(8_293_400); // 82,934.00
    expect(result.item54TaxDueCents).toBe(663_500); // 6,635.00
    expect(result.item58CwtThisQuarterCents).toBe(1_664_670); // 16,646.70, unrounded
    expect(result.item62TotalCreditsCents).toBe(1_664_700); // 16,647.00
    expect(result.item63PayableCents).toBe(0);
    expect(result.isOverpayment).toBe(true);
    expect(result.overpaymentCents).toBe(1_001_200); // 10,012.00
  });
});
