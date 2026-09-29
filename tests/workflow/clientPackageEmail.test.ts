import { describe, it, expect } from "vitest";
import { buildClientPackageEmail, type ClientPackageEmailInput } from "@/lib/workflow/clientPackageEmail";

/**
 * Rework brief #2 §5 / #3 item 3b — the step 16 client email draft. D89
 * (brief #5o) — step 15 has no document at all now, so the email neither
 * asks the client to forward an eAFS confirmation nor lists one.
 */
function baseInput(overrides: Partial<ClientPackageEmailInput> = {}): ClientPackageEmailInput {
  return {
    clientRegisteredName: "Juan Dela Cruz",
    clientFirstName: "Juan",
    period: "Q2",
    taxableYear: 2026,
    filedAt: new Date("2026-08-17T00:00:00.000Z"),
    grossSalesCents: 1_050_000_00,
    taxDueCents: 64_000_00,
    cwtCents: 52_500_00,
    isOverpayment: false,
    finalAmountCents: 11_500_00,
    hasCertificates: true,
    nextPeriodLabel: "Q3",
    nextPeriodDueDate: new Date("2026-11-16T00:00:00.000Z"),
    ...overrides,
  };
}

describe("buildClientPackageEmail", () => {
  it("never mentions eAFS: no forwarding request and no package line (D89)", () => {
    const email = buildClientPackageEmail(baseInput());
    expect(email.body).not.toMatch(/eAFS/i);
    expect(email.body).not.toContain("please forward it");
  });

  it("omits the certificates line and the withholding line when there are no certificates", () => {
    const email = buildClientPackageEmail(baseInput({ hasCertificates: false, cwtCents: 0 }));
    expect(email.body).not.toContain("Form 2307 certificates claimed");
    expect(email.body).not.toContain("Less creditable withholding");
  });

  it("shows overpayment carried forward instead of tax paid when the filing overpaid", () => {
    const email = buildClientPackageEmail(baseInput({ isOverpayment: true, finalAmountCents: 5_000_00 }));
    expect(email.body).toContain("Overpayment carried forward");
    expect(email.body).not.toContain("Tax paid");
  });

  it("omits the next-filing line when there is no next period", () => {
    const email = buildClientPackageEmail(baseInput({ nextPeriodLabel: null, nextPeriodDueDate: null }));
    expect(email.body).not.toContain("Next filing");
  });
});
