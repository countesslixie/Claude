import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { getDeclaredIncome, previousQuartersFromStartingFigures, incomeQuarterStatus } from "@/lib/declaredIncome";
import { getAnnualCertificatesVsSalesReconciliation } from "@/lib/reconciliation";

/**
 * D158 — the Income table and the certificates-vs-declared-sales check read
 * ONE function, so the year total is the same on both pages.
 */
describe("declared income (Income table and reconciliation share it)", () => {
  const ids: string[] = [];
  afterAll(async () => {
    await prisma.quarterlySalesCustomer.deleteMany({ where: { quarterlySales: { clientId: { in: ids } } } });
    await prisma.quarterlySales.deleteMany({ where: { clientId: { in: ids } } });
    await prisma.form2307.deleteMany({ where: { clientId: { in: ids } } });
    await prisma.startingFigures.deleteMany({ where: { clientId: { in: ids } } });
    await prisma.clientTaxYear.deleteMany({ where: { clientId: { in: ids } } });
    await prisma.client.deleteMany({ where: { id: { in: ids } } });
  });

  async function makeClient(label: string) {
    const c = await prisma.client.create({
      data: { code: `d158-${label}-${Date.now()}`, registeredName: "Declared Income Test", tin: "123123123", rdoCode: "999", registeredAddress: "N/A", taxpayerType: "PURELY_SELF_EMPLOYED", booksType: "MANUAL" },
    });
    ids.push(c.id);
    return c;
  }
  const sales = (clientId: string, quarter: "Q3" | "Q4", gross: number, nonOp = 0) =>
    prisma.quarterlySales.create({ data: { clientId, taxableYear: 2026, quarter, grossSalesCents: gross, nonOperatingIncomeCents: nonOp } });

  it("Previous quarters = item 51 minus its non-operating slice, and the year total matches the reconciliation (client WITH starting figures)", async () => {
    const c = await makeClient("sf");
    const ty = await prisma.clientTaxYear.create({ data: { clientId: c.id, taxableYear: 2026, regime: "RATE_8_PERCENT", electionStatus: "ELECTED" } });
    await prisma.startingFigures.create({
      data: { clientId: c.id, taxableYear: 2026, clientTaxYearId: ty.id, latestOutsideReturn: "Q2", cumulativeIncomeCents: 30_000_000, nonOperatingIncomeCents: 1_000_000 },
    });
    await sales(c.id, "Q3", 30_000_000, 500_000);

    const declared = await getDeclaredIncome(c.id, 2026);
    expect(declared.previousQuarters).toEqual({ grossSalesCents: 29_000_000, nonOperatingIncomeCents: 1_000_000 });
    expect(declared.previousQuarters).toEqual(
      previousQuartersFromStartingFigures({ latestOutsideReturn: "Q2", cumulativeIncomeCents: 30_000_000, nonOperatingIncomeCents: 1_000_000 }),
    );
    expect(declared.grossSalesTotalCents).toBe(59_000_000);
    expect(declared.nonOperatingTotalCents).toBe(1_500_000);

    const rec = await getAnnualCertificatesVsSalesReconciliation(c.id, 2026);
    expect(rec.declaredSalesTotalCents).toBe(declared.grossSalesTotalCents);
  });

  it("the year total matches the reconciliation for a client WITHOUT starting figures, and there is no Previous quarters row", async () => {
    const c = await makeClient("nosf");
    await sales(c.id, "Q3", 12_345_600);
    await sales(c.id, "Q4", 0);
    const declared = await getDeclaredIncome(c.id, 2026);
    expect(declared.previousQuarters).toBeNull();
    expect(declared.grossSalesTotalCents).toBe(12_345_600);
    expect((await getAnnualCertificatesVsSalesReconciliation(c.id, 2026)).declaredSalesTotalCents).toBe(12_345_600);
  });

  it("starting figures that name no outside return give no Previous quarters", () => {
    expect(previousQuartersFromStartingFigures({ latestOutsideReturn: "NONE", cumulativeIncomeCents: 5, nonOperatingIncomeCents: 0 })).toBeNull();
    expect(previousQuartersFromStartingFigures(null)).toBeNull();
  });

  it("status words: Not yet entered, Draft, Saved, Filed", () => {
    expect(incomeQuarterStatus({ hasRow: false, finalized: false, filed: false })).toBe("NOT_ENTERED");
    expect(incomeQuarterStatus({ hasRow: true, finalized: false, filed: false })).toBe("DRAFT");
    expect(incomeQuarterStatus({ hasRow: true, finalized: true, filed: false })).toBe("SAVED");
    expect(incomeQuarterStatus({ hasRow: true, finalized: true, filed: true })).toBe("FILED");
  });
});
