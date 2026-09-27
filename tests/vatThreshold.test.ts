import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { cumulativeGrossForThreshold } from "@/lib/vatThreshold";

/**
 * Brief #5f §8 — the dashboard's VAT threshold monitor (80%/95%/breach)
 * must include a mid-year client's starting cumulative income, not just
 * what's been entered in the app.
 */
describe("cumulativeGrossForThreshold", () => {
  const createdClientIds: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.startingFigures.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.quarterlySales.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.clientTaxYear.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  });

  it("includes starting cumulative income alongside in-app quarterly sales", async () => {
    const client = await prisma.client.create({
      data: {
        code: `vat-threshold-${Date.now()}`,
        registeredName: "VAT Threshold Test Client",
        tin: "666777888",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    createdClientIds.push(client.id);
    const taxYear = await prisma.clientTaxYear.create({
      data: { clientId: client.id, taxableYear: 2026, regime: "RATE_8_PERCENT", electionStatus: "ELECTED" },
    });
    await prisma.startingFigures.create({
      data: {
        clientId: client.id,
        taxableYear: 2026,
        clientTaxYearId: taxYear.id,
        latestOutsideReturn: "Q2",
        cumulativeIncomeCents: 2_500_000_00, // ₱2,500,000 — already close to the ₱3M threshold
      },
    });
    await prisma.quarterlySales.create({
      data: { clientId: client.id, taxableYear: 2026, quarter: "Q3", grossSalesCents: 200_000_00 },
    });

    const cumulativeGross = await cumulativeGrossForThreshold(client.id, 2026);
    expect(cumulativeGross).toBe(2_700_000_00); // 2,500,000 + 200,000
  });

  it("is unaffected by starting figures for a client with none", async () => {
    const client = await prisma.client.create({
      data: {
        code: `vat-threshold-none-${Date.now()}`,
        registeredName: "VAT Threshold Test Client (no starting figures)",
        tin: "666777889",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    createdClientIds.push(client.id);
    await prisma.quarterlySales.create({
      data: { clientId: client.id, taxableYear: 2026, quarter: "Q1", grossSalesCents: 100_000_00 },
    });

    const cumulativeGross = await cumulativeGrossForThreshold(client.id, 2026);
    expect(cumulativeGross).toBe(100_000_00);
  });
});
