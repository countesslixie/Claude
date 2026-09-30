import { describe, it, expect } from "vitest";
import {
  buildClientPackageEmail,
  buildSummaryLines,
  signedResultOf,
  periodPlainName,
  type ClientPackageEmailInput,
} from "@/lib/workflow/clientPackageEmail";
import type { AnnualFormComputationResult, LegacyFilingComputationResult, QuarterlyFormComputationResult } from "@/lib/tax/types";

/**
 * D102 (brief #5r) — step 16's client email. Invented figures only. The
 * point of most of these: the printed summary adds up line by line to the
 * payable / overpayment on the last line.
 */
function quarterly(overrides: Partial<QuarterlyFormComputationResult> = {}): QuarterlyFormComputationResult {
  return {
    formType: "F1701Q",
    item47GrossSalesCents: 200_000_00,
    item48NonOperatingCents: 0,
    item49TotalIncomeCents: 200_000_00,
    item50PreviousCumulativeCents: 0,
    item51CumulativeTaxableIncomeCents: 600_000_00,
    item52AllowableDeductionCents: 250_000_00,
    item53TaxableIncomeCents: 335_000_00,
    item54TaxDueCents: 26_800_00,
    item55PriorYearExcessCreditCents: 0,
    item56PriorPeriodPaymentsCents: 10_000_00,
    item57CwtPriorQuartersCents: 15_000_00,
    item58CwtThisQuarterCents: 10_000_00,
    item61OtherCreditsCents: 0,
    item62TotalCreditsCents: 35_000_00,
    item63PayableCents: 0,
    taxPayableCents: 0,
    isOverpayment: true,
    overpaymentCents: 8_200_00,
    breakdown: [],
    ...overrides,
  };
}

function annual(overrides: Partial<AnnualFormComputationResult> = {}): AnnualFormComputationResult {
  return {
    formType: "F1701A",
    item47GrossSalesCents: 900_000_00,
    item48SalesReturnsCents: 0,
    item49NetSalesCents: 900_000_00,
    item52NonOperatingCents: 0,
    item53TotalTaxableIncomeCents: 900_000_00,
    item54AllowableDeductionCents: 250_000_00,
    item55TaxableIncomeCents: 650_000_00,
    item56TaxDueCents: 52_000_00,
    item57PriorYearExcessCreditCents: 0,
    item58PriorPeriodPaymentsCents: 30_000_00,
    item59CwtQ1ToQ3Cents: 8_000_00,
    item60CwtQ4Cents: 4_000_00,
    item63OtherCreditsCents: 0,
    item64TotalCreditsCents: 42_000_00,
    item65PayableCents: 10_000_00,
    taxPayableCents: 10_000_00,
    isOverpayment: false,
    overpaymentCents: 0,
    breakdown: [],
    ...overrides,
  };
}

function baseInput(overrides: Partial<ClientPackageEmailInput> = {}): ClientPackageEmailInput {
  return {
    clientRegisteredName: "Juan Dela Cruz",
    clientFirstName: "Juan",
    clientEmail: "juan@example.com",
    period: "Q3",
    taxableYear: 2026,
    formType: "F1701Q",
    filedAt: new Date("2026-11-13T00:00:00.000Z"),
    sheet: quarterly(),
    attachments: [
      { label: "Filed return", filename: "filed-form.pdf" },
      { label: "Proof of payment", filename: "proof.pdf" },
    ],
    next: { period: "ANNUAL", taxableYear: 2026, formType: "F1701A", dueDate: new Date("2027-04-15T00:00:00.000Z"), docsDueDate: new Date("2027-01-20T00:00:00.000Z") },
    ...overrides,
  };
}

const resultOf = (sheet: Parameters<typeof buildSummaryLines>[0]) => (sheet.isOverpayment ? -sheet.overpaymentCents : sheet.taxPayableCents);

describe("summary lines reconcile to the final figure (D102)", () => {
  it("quarterly overpayment: tax due less earlier-quarter tax paid and withholding is the overpayment", () => {
    const lines = buildSummaryLines(quarterly());
    expect(signedResultOf(lines)).toBe(-8_200_00);
    expect(lines.at(-1)).toEqual({ kind: "result", label: "Overpayment", amountCents: 8_200_00 });
    expect(lines.some((l) => /earlier quarters/.test(l.label) && l.amountCents === 10_000_00)).toBe(true);
  });

  it("quarterly payable", () => {
    const sheet = quarterly({
      item54TaxDueCents: 40_000_00,
      item56PriorPeriodPaymentsCents: 10_000_00,
      item57CwtPriorQuartersCents: 2_000_00,
      item58CwtThisQuarterCents: 3_000_00,
      item62TotalCreditsCents: 15_000_00,
      item63PayableCents: 25_000_00,
      taxPayableCents: 25_000_00,
      isOverpayment: false,
      overpaymentCents: 0,
    });
    const lines = buildSummaryLines(sheet);
    expect(signedResultOf(lines)).toBe(25_000_00);
    expect(lines.at(-1)).toEqual({ kind: "result", label: "Tax payable", amountCents: 25_000_00 });
  });

  it("whole-peso rounding of the credits shows as its own line so the lines still add up", () => {
    const sheet = quarterly({
      item54TaxDueCents: 40_000_00,
      item56PriorPeriodPaymentsCents: 0,
      item57CwtPriorQuartersCents: 0,
      item58CwtThisQuarterCents: 16_646_70,
      item62TotalCreditsCents: 16_647_00,
      taxPayableCents: 23_353_00,
      isOverpayment: false,
      overpaymentCents: 0,
    });
    const lines = buildSummaryLines(sheet);
    expect(lines.find((l) => l.label === "Rounding to whole pesos")?.amountCents).toBe(30);
    expect(signedResultOf(lines)).toBe(resultOf(sheet));
  });

  it("annual (1701A) reconciles with its own lines and labels", () => {
    const sheet = annual();
    const lines = buildSummaryLines(sheet);
    expect(lines[0].label).toBe("Gross sales for the year");
    expect(signedResultOf(lines)).toBe(resultOf(sheet));
  });

  it("annual overpayment reconciles", () => {
    const sheet = annual({ item58PriorPeriodPaymentsCents: 60_000_00, item64TotalCreditsCents: 72_000_00, item65PayableCents: 0, taxPayableCents: 0, isOverpayment: true, overpaymentCents: 20_000_00 });
    expect(signedResultOf(buildSummaryLines(sheet))).toBe(-20_000_00);
  });

  it("legacy shape (Form 1701 / pre-form-line snapshots) reconciles", () => {
    const sheet: LegacyFilingComputationResult = {
      formType: "F1701",
      cumulativeGrossSalesCents: 800_000_00,
      cumulativeNonOperatingCents: 0,
      cumulativeGrossCents: 800_000_00,
      allowableDeductionCents: 0,
      taxableBaseCents: 800_000_00,
      incomeTaxDueCents: 64_000_00,
      cumulativeCwtCents: 12_000_00,
      priorPeriodPaymentsCents: 20_000_00,
      priorYearExcessCreditCents: 4_000_00,
      taxPayableCents: 28_000_00,
      isOverpayment: false,
      overpaymentCents: 0,
      breakdown: [],
    };
    expect(signedResultOf(buildSummaryLines(sheet))).toBe(28_000_00);
  });

  it("leaves out zero credit lines and labels the year-to-date figures", () => {
    const lines = buildSummaryLines(quarterly({ item56PriorPeriodPaymentsCents: 0, item57CwtPriorQuartersCents: 0, item58CwtThisQuarterCents: 0, item62TotalCreditsCents: 0, item54TaxDueCents: 5_000_00, taxPayableCents: 5_000_00, isOverpayment: false, overpaymentCents: 0 }));
    expect(lines.filter((l) => l.kind === "credit")).toHaveLength(0);
    expect(lines.map((l) => l.label)).toEqual(["Gross sales this quarter", "Taxable income, year to date", "Tax due, year to date", "Tax payable"]);
  });
});

describe("buildClientPackageEmail (D102)", () => {
  it("prints the summary, with the credits the client would look for", () => {
    const { body } = buildClientPackageEmail(baseInput());
    expect(body).toContain("Less: tax paid on earlier quarters");
    expect(body).toContain("Less: creditable withholding (Form 2307)");
    expect(body).toContain("Overpayment");
    expect(body).toContain("₱8,200.00");
  });

  it("lists only the documents it is given — no certificates line unless a certificate is attached", () => {
    const none = buildClientPackageEmail(baseInput());
    expect(none.body).not.toMatch(/Form 2307 certificates/);
    expect(none.body).toContain("· Filed return — filed-form.pdf");
    const withCert = buildClientPackageEmail(baseInput({ attachments: [{ label: "Form 2307 — Sample Payor Inc.", filename: "2307-scan.pdf" }] }));
    expect(withCert.body).toContain("· Form 2307 — Sample Payor Inc. — 2307-scan.pdf");
  });

  it("never mentions eAFS: no forwarding request and no package line (D89)", () => {
    const email = buildClientPackageEmail(baseInput());
    expect(email.body).not.toMatch(/eAFS/i);
  });

  it("Annual next filing: right form, plain period name, and her documents date (her wording)", () => {
    const { body } = buildClientPackageEmail(baseInput());
    expect(body).toContain("Next filing: Annual ITR (1701A), due Apr 15, 2027. Please send required documents by Jan 20, 2027.");
    expect(body).not.toContain("1701Q for ANNUAL");
    expect(body).not.toMatch(/\bANNUAL\b/);
  });

  it("quarterly next filing ends with the same documents sentence (D106)", () => {
    const { body } = buildClientPackageEmail(
      baseInput({ period: "Q2", next: { period: "Q3", taxableYear: 2026, formType: "F1701Q", dueDate: new Date("2026-11-16T00:00:00.000Z"), docsDueDate: new Date("2026-10-20T00:00:00.000Z") } }),
    );
    expect(body).toContain("Next filing: 1701Q for Q3 2026, due Nov 16, 2026. Please send required documents by Oct 20, 2026.");
  });

  it("omits the next-filing line when there is no next filing", () => {
    expect(buildClientPackageEmail(baseInput({ next: null })).body).not.toContain("Next filing");
  });

  it("an Annual return's own email names the Annual ITR and its form", () => {
    const email = buildClientPackageEmail(baseInput({ period: "ANNUAL", formType: "F1701A", sheet: annual(), next: null }));
    expect(email.subject).toContain("1701A Annual ITR (2026)");
    expect(email.body).toContain("Your Annual ITR (1701A) for 2026 has been filed.");
  });

  it("To comes from the client record; missing email is null, never an empty string", () => {
    expect(buildClientPackageEmail(baseInput()).to).toBe("juan@example.com");
    expect(buildClientPackageEmail(baseInput({ clientEmail: null })).to).toBeNull();
    expect(buildClientPackageEmail(baseInput({ clientEmail: "  " })).to).toBeNull();
  });
});

describe("plain names", () => {
  it("period names", () => {
    expect(periodPlainName("ANNUAL", 2026)).toBe("Annual ITR");
    expect(periodPlainName("Q1", 2027)).toBe("Q1 2027");
  });
});
