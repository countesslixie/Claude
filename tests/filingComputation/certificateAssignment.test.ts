import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { assembleAndComputeFiling } from "@/lib/filingComputation";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * D34 (brief #4b, supersedes D10) — a certificate counts in the filing
 * whose step 2 it was entered under (Form2307.claimedOnFilingId), set
 * once at entry and never reassigned by dateReceived or a cutoff date.
 * A certificate entered under Q2's step 2 counts in Q2's cumulative CWT
 * and every later period in the same taxable year, but not Q1 — even
 * though it physically arrived before Q2 was filed.
 */
describe("assembleAndComputeFiling — certificate credited to the filing it was entered under (D34)", () => {
  const TAXABLE_YEAR = 2026;
  const createdClientIds: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.form2307.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  });

  it("a certificate entered under Q2's step 2 counts in Q2 and Q3, never Q1", async () => {
    const client = await prisma.client.create({
      data: {
        code: `d34-test-${Date.now()}`,
        registeredName: "D34 Assignment Test Client",
        tin: "111222333",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    createdClientIds.push(client.id);

    await prisma.filing.create({
      data: {
        clientId: client.id,
        taxableYear: TAXABLE_YEAR,
        period: "Q1",
        formType: "F1701Q",
        statutoryDueDate: new Date("2026-05-15T00:00:00.000Z"),
        adjustedDueDate: new Date("2026-05-15T00:00:00.000Z"),
      },
    });
    const q2Filing = await prisma.filing.create({
      data: {
        clientId: client.id,
        taxableYear: TAXABLE_YEAR,
        period: "Q2",
        formType: "F1701Q",
        statutoryDueDate: new Date("2026-08-15T00:00:00.000Z"),
        adjustedDueDate: new Date("2026-08-17T00:00:00.000Z"),
      },
    });

    // Entered under Q2's step 2 — even though, economically, the payor's
    // payment was for services in Q1 and the certificate arrived before
    // Q2 was ever filed. What matters now is which filing's step 2 she
    // entered it under, not dateReceived against a cutoff.
    const cert = await prisma.form2307.create({
      data: {
        clientId: client.id,
        taxableYear: TAXABLE_YEAR,
        payorName: "Payor A",
        periodFrom: new Date("2026-01-01T00:00:00.000Z"),
        periodTo: new Date("2026-03-31T00:00:00.000Z"),
        quarterCovered: 1,
        atcCode: "WI010",
        incomePaymentCents: 10_000_00,
        taxWithheldCents: 500_00,
        withholdingRateBps: 500,
        status: "RECORDED",
        claimedOnFilingId: q2Filing.id,
      },
    });

    const q1 = await assembleAndComputeFiling(client.id, TAXABLE_YEAR, "Q1");
    expect(q1.cumulativeCwtCents).toBe(0);

    const q2 = await assembleAndComputeFiling(client.id, TAXABLE_YEAR, "Q2");
    expect(q2.cumulativeCwtCents).toBe(cert.taxWithheldCents);

    const q3 = await assembleAndComputeFiling(client.id, TAXABLE_YEAR, "Q3");
    expect(q3.cumulativeCwtCents).toBe(cert.taxWithheldCents);
  });

  it("a certificate not yet entered under any filing (claimedOnFilingId null) contributes nothing", async () => {
    const client = await prisma.client.create({
      data: {
        code: `d34-unclaimed-${Date.now()}`,
        registeredName: "D34 Unclaimed Test Client",
        tin: "222333444",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    createdClientIds.push(client.id);

    await prisma.form2307.create({
      data: {
        clientId: client.id,
        taxableYear: TAXABLE_YEAR,
        payorName: "Payor B",
        periodFrom: new Date("2026-01-01T00:00:00.000Z"),
        periodTo: new Date("2026-03-31T00:00:00.000Z"),
        quarterCovered: 1,
        atcCode: "WI010",
        incomePaymentCents: 5_000_00,
        taxWithheldCents: 250_00,
        withholdingRateBps: 500,
        status: "RECORDED",
      },
    });

    const q1 = await assembleAndComputeFiling(client.id, TAXABLE_YEAR, "Q1");
    expect(q1.cumulativeCwtCents).toBe(0);
  });
});
