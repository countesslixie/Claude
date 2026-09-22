import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getAnnualCertificatesVsSalesReconciliation } from "@/lib/reconciliation";
import { addCertificate, type CertificateFormState } from "@/lib/actions/form2307";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * Rework brief §5.2 — the one reconciliation check that survives the
 * 2307-as-credit-record redesign (D26): certificates for a taxable year
 * should never total more than declared gross sales for that year. Runs
 * over the whole year, never per quarter (the CWT cutoff rule shifts a
 * certificate's credit into whichever period is open when it arrives).
 */
describe("getAnnualCertificatesVsSalesReconciliation", () => {
  const createdClientIds: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.form2307.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.workflowStep.deleteMany({ where: { filing: { clientId: { in: createdClientIds } } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.quarterlySales.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  });

  async function makeClient(code: string) {
    const client = await prisma.client.create({
      data: {
        code,
        registeredName: "Reconciliation Test Client",
        tin: "555666777",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    createdClientIds.push(client.id);
    return client;
  }

  it("no variance when certificates total less than declared sales", async () => {
    const client = await makeClient(`recon-ok-${Date.now()}`);
    await prisma.quarterlySales.create({
      data: { clientId: client.id, taxableYear: 2026, quarter: "Q1", grossSalesCents: 500_000_00 },
    });
    await prisma.form2307.create({
      data: {
        clientId: client.id,
        taxableYear: 2026,
        payorName: "Payor",
        periodFrom: new Date("2026-01-01T00:00:00.000Z"),
        periodTo: new Date("2026-03-31T00:00:00.000Z"),
        quarterCovered: 1,
        atcCode: "WI010",
        incomePaymentCents: 200_000_00,
        taxWithheldCents: 10_000_00,
        withholdingRateBps: 500,
        status: "RECORDED",
      },
    });

    const result = await getAnnualCertificatesVsSalesReconciliation(client.id, 2026);
    expect(result.certificatesTotalCents).toBe(200_000_00);
    expect(result.declaredSalesTotalCents).toBe(500_000_00);
    expect(result.hasVariance).toBe(false);
  });

  it("flags a variance when certificates exceed declared sales", async () => {
    const client = await makeClient(`recon-bad-${Date.now()}`);
    await prisma.quarterlySales.create({
      data: { clientId: client.id, taxableYear: 2026, quarter: "Q1", grossSalesCents: 100_000_00 },
    });
    await prisma.form2307.create({
      data: {
        clientId: client.id,
        taxableYear: 2026,
        payorName: "Payor",
        periodFrom: new Date("2026-01-01T00:00:00.000Z"),
        periodTo: new Date("2026-03-31T00:00:00.000Z"),
        quarterCovered: 1,
        atcCode: "WI010",
        incomePaymentCents: 300_000_00,
        taxWithheldCents: 15_000_00,
        withholdingRateBps: 500,
        status: "RECORDED",
      },
    });

    const result = await getAnnualCertificatesVsSalesReconciliation(client.id, 2026);
    expect(result.hasVariance).toBe(true);
    expect(result.varianceCents).toBe(200_000_00);
  });

  it("a missing QuarterlySales row is zero, not an error", async () => {
    const client = await makeClient(`recon-nosales-${Date.now()}`);
    const result = await getAnnualCertificatesVsSalesReconciliation(client.id, 2026);
    expect(result.declaredSalesTotalCents).toBe(0);
    expect(result.certificatesTotalCents).toBe(0);
    expect(result.hasVariance).toBe(false);
  });

  /**
   * Brief #4d item 4 — a certificate's year is the taxable year of the
   * filing it was entered under (Form2307.taxableYear, set from
   * filing.taxableYear at entry — lib/actions/form2307.ts's
   * addCertificate), never the calendar year of a date-received field.
   * This certificate is entered under the 2025 ANNUAL filing; under the
   * old dateReceived-keyed logic a certificate physically received in
   * January would have counted in 2026 instead.
   */
  it("a certificate entered under the 2025 ANNUAL filing counts in 2025, not 2026", async () => {
    const client = await makeClient(`recon-year-${Date.now()}`);
    await prisma.quarterlySales.create({
      data: { clientId: client.id, taxableYear: 2025, quarter: "Q4", grossSalesCents: 400_000_00 },
    });
    const annualFiling = await prisma.filing.create({
      data: {
        clientId: client.id,
        taxableYear: 2025,
        period: "ANNUAL",
        formType: "F1701A",
        statutoryDueDate: new Date("2026-04-15T00:00:00.000Z"),
        adjustedDueDate: new Date("2026-04-15T00:00:00.000Z"),
      },
    });

    const fd = new FormData();
    fd.set("payorName", "Late-Arriving Payor");
    fd.set("incomePayment", "150000");
    fd.set("taxWithheld", "7500");
    fd.set("periodFrom", "2025-10-01");
    fd.set("periodTo", "2025-12-31");
    const result = await addCertificate(annualFiling.id, {} as CertificateFormState, fd);
    expect(result.saved).toBe(true);

    const result2025 = await getAnnualCertificatesVsSalesReconciliation(client.id, 2025);
    expect(result2025.certificatesTotalCents).toBe(150_000_00);

    const result2026 = await getAnnualCertificatesVsSalesReconciliation(client.id, 2026);
    expect(result2026.certificatesTotalCents).toBe(0);
  });
});
