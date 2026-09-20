import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { assembleAndComputeFiling, hasSalesRecordedForPeriod } from "@/lib/filingComputation";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * D26/SPEC.md 3.2 — declared gross sales (QuarterlySales) are summed
 * cumulatively into a filing's period: Q2 sums Q1+Q2, Q3 sums Q1+Q2+Q3,
 * ANNUAL sums all four quarters including Q4, which has no quarterly
 * return of its own. A missing quarter contributes zero, not an error.
 */
describe("assembleAndComputeFiling — QuarterlySales cumulative sums", () => {
  const createdClientIds: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.quarterlySales.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  });

  async function makeClient(code: string) {
    const client = await prisma.client.create({
      data: {
        code,
        registeredName: "Quarterly Sales Cumulative Test Client",
        tin: "777888999",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    createdClientIds.push(client.id);
    return client;
  }

  it("Q2 sums Q1 + Q2 only, not Q3 or Q4", async () => {
    const client = await makeClient(`qs-cum-q2-${Date.now()}`);
    await prisma.quarterlySales.createMany({
      data: [
        { clientId: client.id, taxableYear: 2026, quarter: "Q1", grossSalesCents: 100_000_00 },
        { clientId: client.id, taxableYear: 2026, quarter: "Q2", grossSalesCents: 200_000_00 },
        { clientId: client.id, taxableYear: 2026, quarter: "Q3", grossSalesCents: 400_000_00 },
        { clientId: client.id, taxableYear: 2026, quarter: "Q4", grossSalesCents: 800_000_00 },
      ],
    });

    const result = await assembleAndComputeFiling(client.id, 2026, "Q2");
    expect(result.cumulativeGrossSalesCents).toBe(300_000_00);
  });

  it("Q3 sums Q1 + Q2 + Q3", async () => {
    const client = await makeClient(`qs-cum-q3-${Date.now()}`);
    await prisma.quarterlySales.createMany({
      data: [
        { clientId: client.id, taxableYear: 2026, quarter: "Q1", grossSalesCents: 100_000_00 },
        { clientId: client.id, taxableYear: 2026, quarter: "Q2", grossSalesCents: 200_000_00 },
        { clientId: client.id, taxableYear: 2026, quarter: "Q3", grossSalesCents: 400_000_00 },
        { clientId: client.id, taxableYear: 2026, quarter: "Q4", grossSalesCents: 800_000_00 },
      ],
    });

    const result = await assembleAndComputeFiling(client.id, 2026, "Q3");
    expect(result.cumulativeGrossSalesCents).toBe(700_000_00);
  });

  it("ANNUAL sums all four quarters, including Q4 which has no quarterly return of its own", async () => {
    const client = await makeClient(`qs-cum-annual-${Date.now()}`);
    await prisma.quarterlySales.createMany({
      data: [
        { clientId: client.id, taxableYear: 2026, quarter: "Q1", grossSalesCents: 100_000_00 },
        { clientId: client.id, taxableYear: 2026, quarter: "Q2", grossSalesCents: 200_000_00 },
        { clientId: client.id, taxableYear: 2026, quarter: "Q3", grossSalesCents: 400_000_00 },
        { clientId: client.id, taxableYear: 2026, quarter: "Q4", grossSalesCents: 800_000_00 },
      ],
    });

    const result = await assembleAndComputeFiling(client.id, 2026, "ANNUAL");
    expect(result.cumulativeGrossSalesCents).toBe(1_500_000_00);
  });

  it("a missing quarter is treated as zero, not an error", async () => {
    const client = await makeClient(`qs-cum-missing-${Date.now()}`);
    // Only Q1 exists — Q2's own row was never entered.
    await prisma.quarterlySales.create({
      data: { clientId: client.id, taxableYear: 2026, quarter: "Q1", grossSalesCents: 100_000_00 },
    });

    const result = await assembleAndComputeFiling(client.id, 2026, "Q2");
    expect(result.cumulativeGrossSalesCents).toBe(100_000_00);
  });

  it("cumulativeGrossSalesCents and cumulativeNonOperatingCents are tracked as separate, distinct sums", async () => {
    const client = await makeClient(`qs-cum-nonop-${Date.now()}`);
    await prisma.quarterlySales.createMany({
      data: [
        { clientId: client.id, taxableYear: 2026, quarter: "Q1", grossSalesCents: 100_000_00, nonOperatingIncomeCents: 5_000_00 },
        { clientId: client.id, taxableYear: 2026, quarter: "Q2", grossSalesCents: 200_000_00, nonOperatingIncomeCents: 3_000_00 },
      ],
    });

    const result = await assembleAndComputeFiling(client.id, 2026, "Q2");
    expect(result.cumulativeGrossSalesCents).toBe(300_000_00);
    expect(result.cumulativeNonOperatingCents).toBe(8_000_00);
  });

  /**
   * Rework brief #2 §3.1 — "no sales recorded" must be distinct from
   * "cumulative total happens to be zero." A filing can carry a healthy
   * cumulative total from earlier quarters while its OWN quarter is still
   * blank, and that must read as "not entered yet," not as a real ₱0.00.
   */
  describe("hasSalesRecordedForPeriod", () => {
    it("is false when this filing's own quarter has no row, even if earlier quarters do", async () => {
      const client = await makeClient(`qs-hasrecorded-blank-${Date.now()}`);
      await prisma.quarterlySales.create({
        data: { clientId: client.id, taxableYear: 2026, quarter: "Q1", grossSalesCents: 100_000_00 },
      });
      // Q2's own row was never entered -- cumulative through Q2 is still
      // nonzero (100,000 from Q1), but Q2 itself has nothing recorded.
      const cumulative = await assembleAndComputeFiling(client.id, 2026, "Q2");
      expect(cumulative.cumulativeGrossSalesCents).toBe(100_000_00);
      expect(await hasSalesRecordedForPeriod(client.id, 2026, "Q2")).toBe(false);
    });

    it("is true once this filing's own quarter has a row, even ₱0", async () => {
      const client = await makeClient(`qs-hasrecorded-zero-${Date.now()}`);
      await prisma.quarterlySales.create({
        data: { clientId: client.id, taxableYear: 2026, quarter: "Q2", grossSalesCents: 0 },
      });
      expect(await hasSalesRecordedForPeriod(client.id, 2026, "Q2")).toBe(true);
    });

    it("ANNUAL's own quarter is Q4, the one no quarterly filing covers", async () => {
      const client = await makeClient(`qs-hasrecorded-annual-${Date.now()}`);
      await prisma.quarterlySales.createMany({
        data: [
          { clientId: client.id, taxableYear: 2026, quarter: "Q1", grossSalesCents: 100_000_00 },
          { clientId: client.id, taxableYear: 2026, quarter: "Q2", grossSalesCents: 100_000_00 },
          { clientId: client.id, taxableYear: 2026, quarter: "Q3", grossSalesCents: 100_000_00 },
        ],
      });
      expect(await hasSalesRecordedForPeriod(client.id, 2026, "ANNUAL")).toBe(false);

      await prisma.quarterlySales.create({
        data: { clientId: client.id, taxableYear: 2026, quarter: "Q4", grossSalesCents: 100_000_00 },
      });
      expect(await hasSalesRecordedForPeriod(client.id, 2026, "ANNUAL")).toBe(true);
    });
  });
});
