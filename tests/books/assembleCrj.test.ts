import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { assembleCrj } from "@/lib/books/assembleCrj";

describe("assembleCrj", () => {
  const createdClientIds: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.salesTransaction.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  });

  it("§16 item 21: includes only transactions within the requested period's date range, and the grand total matches their sum", async () => {
    const client = await prisma.client.create({
      data: {
        code: `crj-assemble-test-${Date.now()}`,
        registeredName: "CRJ Assemble Test Client",
        tin: "777888999",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    createdClientIds.push(client.id);

    const inQ2 = { date: new Date("2026-04-15T00:00:00.000Z"), gross: 100000 };
    const alsoInQ2 = { date: new Date("2026-06-30T00:00:00.000Z"), gross: 200000 };
    const outsideQ2 = { date: new Date("2026-07-01T00:00:00.000Z"), gross: 999999 }; // Q3, must be excluded

    for (const [i, t] of [inQ2, alsoInQ2, outsideQ2].entries()) {
      await prisma.salesTransaction.create({
        data: {
          clientId: client.id,
          transactionDate: t.date,
          taxableYear: 2026,
          quarter: t === outsideQ2 ? 3 : 2,
          orNumber: `OR-${i}`,
          payorName: "Test Payor",
          grossAmountCents: t.gross,
          withholdingTaxCents: 0,
          netReceivedCents: t.gross,
        },
      });
    }

    const journal = await assembleCrj(client.id, 2026, "Q2");
    expect(journal.grandTotals.transactionCount).toBe(2);
    expect(journal.grandTotals.grossAmountCents).toBe(inQ2.gross + alsoInQ2.gross);
    expect(journal.grandTotals.grossAmountCents).not.toBe(inQ2.gross + alsoInQ2.gross + outsideQ2.gross);
  });
});
