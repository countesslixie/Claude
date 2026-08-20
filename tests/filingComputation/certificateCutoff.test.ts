import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { assembleAndComputeFiling } from "@/lib/filingComputation";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * P5 (Phase 2b) — the scenario that motivated replacing period-end as the
 * CWT cutoff: a Q2 certificate arriving Aug 5 (after Jun 30 but before the
 * Q2 return is filed Aug 15) must be claimed on Q2, not pushed to Q3. A
 * certificate arriving Aug 20 — after the Q2 filing date — must NOT be
 * claimed on Q2, and must appear starting Q3's cumulative instead, exactly
 * once (no double-count).
 */
describe("assembleAndComputeFiling — certificate cutoff (P5)", () => {
  const TAXABLE_YEAR = 2026;
  const createdClientIds: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.form2307.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  });

  it("claims the Aug-5 certificate on Q2 (filed Aug 15) and defers the Aug-20 certificate to Q3, with no double-count", async () => {
    const client = await prisma.client.create({
      data: {
        code: `p5-test-${Date.now()}`,
        registeredName: "P5 Cutoff Test Client",
        tin: "111222333",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    createdClientIds.push(client.id);

    // Q2 filing, filed 2026-08-15 — this pins the cutoff for Q2 at filedAt.
    await prisma.filing.create({
      data: {
        clientId: client.id,
        taxableYear: TAXABLE_YEAR,
        period: "Q2",
        formType: "F1701Q",
        statutoryDueDate: new Date("2026-08-15T00:00:00.000Z"),
        adjustedDueDate: new Date("2026-08-17T00:00:00.000Z"),
        filedAt: new Date("2026-08-15T00:00:00.000Z"),
      },
    });
    // Q3 filing, filed at its own adjusted due date — pins Q3's cutoff
    // deterministically regardless of the real calendar date the test runs on.
    await prisma.filing.create({
      data: {
        clientId: client.id,
        taxableYear: TAXABLE_YEAR,
        period: "Q3",
        formType: "F1701Q",
        statutoryDueDate: new Date("2026-11-15T00:00:00.000Z"),
        adjustedDueDate: new Date("2026-11-16T00:00:00.000Z"),
        filedAt: new Date("2026-11-16T00:00:00.000Z"),
      },
    });

    const onTimeCert = await prisma.form2307.create({
      data: {
        clientId: client.id,
        taxableYear: TAXABLE_YEAR,
        payorName: "Payor A",
        payorTin: "444555666",
        periodFrom: new Date("2026-04-01T00:00:00.000Z"),
        periodTo: new Date("2026-06-30T00:00:00.000Z"),
        quarterCovered: 2,
        atcCode: "WI010",
        incomePaymentCents: 10_000_00,
        taxWithheldCents: 500_00,
        withholdingRateBps: 500,
        dateReceived: new Date("2026-08-05T00:00:00.000Z"), // arrives before Q2 is filed
        status: "RECORDED",
      },
    });
    const lateCert = await prisma.form2307.create({
      data: {
        clientId: client.id,
        taxableYear: TAXABLE_YEAR,
        payorName: "Payor B",
        payorTin: "777888999",
        periodFrom: new Date("2026-04-01T00:00:00.000Z"),
        periodTo: new Date("2026-06-30T00:00:00.000Z"),
        quarterCovered: 2,
        atcCode: "WI010",
        incomePaymentCents: 8_000_00,
        taxWithheldCents: 400_00,
        withholdingRateBps: 500,
        dateReceived: new Date("2026-08-20T00:00:00.000Z"), // arrives after Q2 is filed
        status: "RECORDED",
      },
    });

    const q2 = await assembleAndComputeFiling(client.id, TAXABLE_YEAR, "Q2");
    expect(q2.cumulativeCwtCents).toBe(onTimeCert.taxWithheldCents);
    expect(q2.certificateCutoffSource).toBe("FILED_AT");
    expect(q2.certificateCutoffDate).toEqual(new Date("2026-08-15T00:00:00.000Z"));

    const q3 = await assembleAndComputeFiling(client.id, TAXABLE_YEAR, "Q3");
    expect(q3.cumulativeCwtCents).toBe(onTimeCert.taxWithheldCents + lateCert.taxWithheldCents);
    expect(q3.certificateCutoffSource).toBe("FILED_AT");
  });
});
