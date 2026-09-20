import { describe, it, expect } from "vitest";
import { buildClientPackageEmail, type ClientPackageEmailInput } from "@/lib/workflow/clientPackageEmail";

/**
 * Rework brief #2 §5 / #3 item 3b — the step 16 client email draft. The
 * eAFS line is conditional: the eAFS confirmation is the one document in
 * the cycle addressed to the client rather than the bookkeeper (D27's
 * exception), so step 16 -- the one point in the cycle where she's
 * writing to that client anyway -- asks her to forward it, but only when
 * it isn't already on file.
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
    eafsConfirmationSaved: false,
    nextPeriodLabel: "Q3",
    nextPeriodDueDate: new Date("2026-11-16T00:00:00.000Z"),
    ...overrides,
  };
}

describe("buildClientPackageEmail", () => {
  it("asks the client to forward the eAFS confirmation when step 15's slot is still empty", () => {
    const email = buildClientPackageEmail(baseInput({ eafsConfirmationSaved: false }));
    expect(email.body).toContain("If you received the eAFS confirmation email, please forward it");
    expect(email.body).not.toContain("· eAFS confirmation");
  });

  it("drops the forwarding request and lists the eAFS confirmation as a package item once it's saved", () => {
    const email = buildClientPackageEmail(baseInput({ eafsConfirmationSaved: true }));
    expect(email.body).not.toContain("please forward it");
    expect(email.body).toContain("· eAFS confirmation");
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
