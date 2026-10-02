import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createClientTaxYear, updateClientTaxYear } from "@/lib/actions/clientTaxYears";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

/**
 * Brief #5f §4/§7 — item 55 (prior-year excess credit) can no longer be
 * set through the tax-year create/edit action at all; the starting
 * figures page (lib/actions/startingFigures.ts) is now the only place it
 * is entered. A stray `priorYearExcessCredit` field in the submitted form
 * data (e.g. from a stale client) is simply ignored.
 */
describe("createClientTaxYear / updateClientTaxYear no longer accept item 55", () => {
  const createdClientIds: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.clientTaxYear.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  });

  function taxYearFormData(overrides: Record<string, string> = {}): FormData {
    const fd = new FormData();
    fd.set("taxableYear", "2026");
    fd.set("yearEndCreditElection", "NA");
    // A stray legacy field — must be ignored, not written anywhere.
    fd.set("priorYearExcessCredit", "50000");
    for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
    return fd;
  }

  it("createClientTaxYear ignores a submitted priorYearExcessCredit — the row stays at its zero default", async () => {
    const client = await prisma.client.create({
      data: {
        code: `ctyr-create-${Date.now()}`,
        registeredName: "Client Tax Year Test",
        tin: "222333444",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    createdClientIds.push(client.id);

    await createClientTaxYear(client.id, {}, taxYearFormData());

    const taxYear = await prisma.clientTaxYear.findUniqueOrThrow({
      where: { clientId_taxableYear: { clientId: client.id, taxableYear: 2026 } },
    });
    expect(taxYear.priorYearExcessCreditCents).toBe(0);
  });

  it("D136: a new tax year is created as 8% elected, with no election in the form", async () => {
    const client = await prisma.client.create({
      data: {
        code: `ctyr-elected-${Date.now()}`,
        registeredName: "Client Tax Year Test",
        tin: "222333446",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    createdClientIds.push(client.id);
    await createClientTaxYear(client.id, {}, taxYearFormData({ electionStatus: "NOT_YET_ELECTED" })); // a stray value is ignored
    const taxYear = await prisma.clientTaxYear.findUniqueOrThrow({
      where: { clientId_taxableYear: { clientId: client.id, taxableYear: 2026 } },
    });
    expect(taxYear.electionStatus).toBe("ELECTED");
  });

  it("D142: a new tax year with no regime supplied is stored as 8% flat rate, and a stray regime is ignored", async () => {
    const client = await prisma.client.create({
      data: {
        code: `ctyr-regime-${Date.now()}`,
        registeredName: "Client Tax Year Test",
        tin: "222333447",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    createdClientIds.push(client.id);
    const fd = taxYearFormData({ regime: "GRADUATED_OSD" });
    expect(taxYearFormData().get("regime")).toBeNull();
    await createClientTaxYear(client.id, {}, fd);
    const taxYear = await prisma.clientTaxYear.findUniqueOrThrow({
      where: { clientId_taxableYear: { clientId: client.id, taxableYear: 2026 } },
    });
    expect(taxYear.regime).toBe("RATE_8_PERCENT");
  });

  it("updateClientTaxYear ignores a submitted priorYearExcessCredit — an existing figure is left untouched", async () => {
    const client = await prisma.client.create({
      data: {
        code: `ctyr-update-${Date.now()}`,
        registeredName: "Client Tax Year Test",
        tin: "222333445",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    createdClientIds.push(client.id);
    const taxYear = await prisma.clientTaxYear.create({
      data: {
        clientId: client.id,
        taxableYear: 2026,
        regime: "RATE_8_PERCENT",
        electionStatus: "ELECTED",
        priorYearExcessCreditCents: 123_45, // set only via starting figures, in practice
      },
    });

    await updateClientTaxYear(taxYear.id, {}, taxYearFormData());

    const after = await prisma.clientTaxYear.findUniqueOrThrow({ where: { id: taxYear.id } });
    expect(after.priorYearExcessCreditCents).toBe(123_45); // but item 55 is untouched
  });
});
