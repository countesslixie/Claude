import { describe, it, expect } from "vitest";
import { computeFiling } from "@/lib/tax/compute";
import { sumCwtThroughPeriod, type CertificateForCwt } from "@/lib/tax/cwt";

/**
 * Brief #4e — replaces `scripts/verify-real.ts` (deleted) and its
 * gitignored `scripts/real-fixture.local.ts`, which has never actually
 * been present on any machine this project has run on: not on the `vm`
 * checkout Claude Code runs from, and — confirmed 2026-09-26 — not on
 * the bookkeeper's own laptop either. The guard it was meant to provide
 * has therefore never once run. This is an ordinary committed test with
 * the same five amounts instead, so it actually runs with the rest of
 * the suite.
 *
 * These are amounts and taxpayer type only — no client name, TIN, payor
 * name, or address. The amounts already appear in the project's own
 * notes (CLAUDE.md/PROJECT_MASTER.md), so nothing new is exposed here.
 * The payor is named "Payor A" per the brief's instruction to use
 * placeholder names.
 *
 * The certificate split behind the ₱16,646.70 CWT figure is not
 * recoverable in this environment — it lived only in the local fixture
 * above, which has never been reachable here. Represented below as one
 * certificate for the full amount.
 *
 * Reproduces the filed TY2026 Q1 return, PURELY_SELF_EMPLOYED, to the
 * centavo: gross ₱332,933.90, taxable ₱82,933.90, tax due ₱6,634.71,
 * CWT ₱16,646.70, overpayment ₱10,011.99, ₱250,000 deduction applied in
 * full (SPEC.md 3.2 — never prorated, purely self-employed only).
 */
describe("real filing regression — TY2026 Q1, PURELY_SELF_EMPLOYED", () => {
  it("matches the filed return to the centavo", () => {
    // Declared quarterly sales (D26/D33) — the sum of per-customer rows
    // for Q1, the only place income enters the system.
    const customers = [{ customerName: "Payor A", amountCents: 33_293_390 }];
    const cumulativeGrossSalesCents = customers.reduce((sum, c) => sum + c.amountCents, 0);

    // Certificates entered under this filing's step 2 (D34) — credited
    // through sumCwtThroughPeriod, the same function the real engine
    // uses, not a hand-added total.
    const certificates: CertificateForCwt[] = [
      { id: "cert-a", taxWithheldCents: 16_646_70, status: "RECORDED", claimedOnFilingPeriod: "Q1" },
    ];
    const cumulativeCwtCents = sumCwtThroughPeriod(certificates, "Q1");

    const result = computeFiling({
      taxableYear: 2026,
      period: "Q1",
      taxpayerType: "PURELY_SELF_EMPLOYED",
      ruleSet: { incomeTaxRateBps: 800, allowableDeductionCents: 25_000_000 },
      cumulativeGrossSalesCents,
      cumulativeNonOperatingCents: 0,
      cumulativeCwtCents,
      priorPeriodPaymentsCents: 0,
      priorYearExcessCreditCents: 0,
    });

    expect(result.cumulativeGrossSalesCents).toBe(33_293_390); // ₱332,933.90
    expect(result.allowableDeductionCents).toBe(25_000_000); // ₱250,000.00, applied in full
    expect(result.taxableBaseCents).toBe(8_293_390); // ₱82,933.90
    expect(result.incomeTaxDueCents).toBe(663_471); // ₱6,634.71
    expect(result.cumulativeCwtCents).toBe(1_664_670); // ₱16,646.70
    expect(result.taxPayableCents).toBe(0);
    expect(result.isOverpayment).toBe(true);
    expect(result.overpaymentCents).toBe(1_001_199); // ₱10,011.99
  });
});
