import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { assembleAndComputeFiling } from "@/lib/filingComputation";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * Brief #5f §8 — starting figures for a mid-year client feed the app's
 * own first return of the year and the Annual. These are pure assembly
 * tests (inline fixtures, no real Filing/WorkflowStep rows generated) —
 * assembleAndComputeFiling only needs the Client, ClientTaxYear and
 * StartingFigures rows to exist.
 */
describe("assembleAndComputeFiling — starting figures (mid-year client)", () => {
  const createdClientIds: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.startingFigures.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.quarterlySalesCustomer.deleteMany({ where: { quarterlySales: { clientId: { in: createdClientIds } } } });
    await prisma.quarterlySales.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.clientTaxYear.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  });

  async function makeClientWithStartingFigures(
    code: string,
    opts: { cumulativeIncomeCents: number; nonOperatingIncomeCents?: number },
  ) {
    const client = await prisma.client.create({
      data: {
        code,
        registeredName: "Starting Figures Test Client",
        tin: "888999000",
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
        priorYearExcessCreditCents: 5_000_00, // ₱5,000.00 — item 55
      },
    });
    await prisma.startingFigures.create({
      data: {
        clientId: client.id,
        taxableYear: 2026,
        clientTaxYearId: taxYear.id,
        latestOutsideReturn: "Q2",
        priorYearExcessCreditCents: 5_000_00,
        cumulativeIncomeCents: opts.cumulativeIncomeCents,
        nonOperatingIncomeCents: opts.nonOperatingIncomeCents ?? 0,
        withholdingPreviousQuartersCents: 10_000_00, // ₱10,000.00 — item 57 of the outside return
        withholdingThisQuarterCents: 15_000_00, // ₱15,000.00 — item 58 of the outside return
        paymentsPreviousQuartersCents: 2_000_00, // ₱2,000.00 — item 56 of the outside return
        amountPaidThisReturnCents: 8_000_00, // ₱8,000.00 — her proof of payment
        otherCreditsCents: 0,
      },
    });
    return client;
  }

  it("Q3 (the first return done in the app): items 50, 55, 56 and 57 equal the expected sums", async () => {
    const client = await makeClientWithStartingFigures(`sf-q3-${Date.now()}`, { cumulativeIncomeCents: 500_000_00 });

    const q3 = await assembleAndComputeFiling(client.id, 2026, "Q3");
    if (!("item50PreviousCumulativeCents" in q3)) throw new Error("expected 1701Q result");

    expect(q3.item50PreviousCumulativeCents).toBe(500_000_00); // starting cumulative income, item 51 of Q2
    expect(q3.item55PriorYearExcessCreditCents).toBe(5_000_00); // item 55, from ClientTaxYear
    expect(q3.item56PriorPeriodPaymentsCents).toBe(10_000_00); // 2,000 + 8,000
    expect(q3.item57CwtPriorQuartersCents).toBe(25_000_00); // 10,000 + 15,000
    expect(q3.item58CwtThisQuarterCents).toBe(0); // no in-app certificates on Q3 itself yet
  });

  it("the Annual: items 47, 52, 58 and 59 equal the expected sums, including the non-operating split", async () => {
    const client = await makeClientWithStartingFigures(`sf-annual-${Date.now()}`, {
      cumulativeIncomeCents: 500_000_00,
      nonOperatingIncomeCents: 50_000_00,
    });

    // In-app quarters' own sales — Q3 (the first in-app quarter) and Q4
    // (always in-app; there's no "outside Q4").
    await prisma.quarterlySales.create({
      data: { clientId: client.id, taxableYear: 2026, quarter: "Q3", grossSalesCents: 300_000_00, nonOperatingIncomeCents: 10_000_00 },
    });
    await prisma.quarterlySales.create({
      data: { clientId: client.id, taxableYear: 2026, quarter: "Q4", grossSalesCents: 100_000_00 },
    });

    const annual = await assembleAndComputeFiling(client.id, 2026, "ANNUAL");
    if (!("item65PayableCents" in annual)) throw new Error("expected 1701A result");

    // Starting gross-only = 500,000 - 50,000 = 450,000; + Q3 300,000 + Q4 100,000 = 850,000.
    expect(annual.item47GrossSalesCents).toBe(850_000_00);
    // Starting non-operating 50,000 + Q3's 10,000 + Q4's 0 = 60,000.
    expect(annual.item52NonOperatingCents).toBe(60_000_00);
    expect(annual.item58PriorPeriodPaymentsCents).toBe(10_000_00); // 2,000 + 8,000, no in-app Q1-Q3 payments yet
    expect(annual.item59CwtQ1ToQ3Cents).toBe(25_000_00); // 10,000 + 15,000, no in-app Q1-Q3 certificates yet
  });

  it("a stray QuarterlySales row for an outside quarter is excluded — starting figures replace it, never add to it", async () => {
    const client = await makeClientWithStartingFigures(`sf-stray-${Date.now()}`, { cumulativeIncomeCents: 500_000_00 });

    // Q1 is "filed outside the app" for this client (latestOutsideReturn
    // Q2) — a leftover row here (e.g. old seed data) must not double-count.
    await prisma.quarterlySales.create({
      data: { clientId: client.id, taxableYear: 2026, quarter: "Q1", grossSalesCents: 999_999_00 },
    });

    const q3 = await assembleAndComputeFiling(client.id, 2026, "Q3");
    if (!("item50PreviousCumulativeCents" in q3)) throw new Error("expected 1701Q result");
    expect(q3.item50PreviousCumulativeCents).toBe(500_000_00); // unchanged by the stray Q1 row

    const annual = await assembleAndComputeFiling(client.id, 2026, "ANNUAL");
    if (!("item65PayableCents" in annual)) throw new Error("expected 1701A result");
    expect(annual.item47GrossSalesCents).toBe(500_000_00); // starting gross-only (nonOperating 0) — the stray Q1 row never counted
  });
});
