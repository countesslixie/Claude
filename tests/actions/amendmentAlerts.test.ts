import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { updateSalesTransaction, createQuickTransaction } from "@/lib/actions/salesTransactions";
import { assembleAndComputeFiling } from "@/lib/filingComputation";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * SPEC.md 5 / §16 item 16: editing a transaction in an already-filed
 * period raises an AmendmentAlert showing the delta between the frozen
 * computationSnapshot and a live recomputation — and does NOT mutate
 * computationSnapshot. This is "the single most important integrity
 * rule in the system" per SPEC.md 5.
 */
describe("AmendmentAlert wiring", () => {
  const createdClientIds: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.amendmentAlert.deleteMany({ where: { filing: { clientId: { in: createdClientIds } } } });
    await prisma.salesTransaction.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  });

  it("editing a transaction's gross amount in a filed period raises an AmendmentAlert without mutating computationSnapshot", async () => {
    const client = await prisma.client.create({
      data: {
        code: `p3-amend-${Date.now()}`,
        registeredName: "Amendment Alert Test Client",
        tin: "121212121",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    createdClientIds.push(client.id);

    const tx = await prisma.salesTransaction.create({
      data: {
        clientId: client.id,
        transactionDate: new Date("2026-01-15T00:00:00.000Z"),
        taxableYear: 2026,
        quarter: 1,
        payorName: "Original Payor",
        grossAmountCents: 200_000_00,
        withholdingTaxCents: 0,
        netReceivedCents: 200_000_00,
        incomeType: "OPERATING",
      },
    });

    // Freeze Q1 the way a real "file this return" action would: compute
    // once via the real engine, store that exact result as the snapshot.
    const snapshot = await assembleAndComputeFiling(client.id, 2026, "Q1");
    const snapshotJson = JSON.stringify(snapshot);
    const filing = await prisma.filing.create({
      data: {
        clientId: client.id,
        taxableYear: 2026,
        period: "Q1",
        formType: "F1701Q",
        statutoryDueDate: new Date("2026-05-15T00:00:00.000Z"),
        adjustedDueDate: new Date("2026-05-15T00:00:00.000Z"),
        computationSnapshot: snapshotJson,
        filedAt: new Date("2026-05-15T00:00:00.000Z"),
      },
    });

    const alertsBefore = await prisma.amendmentAlert.count({ where: { filingId: filing.id } });
    expect(alertsBefore).toBe(0);

    // Edit the gross amount — this changes Q1's cumulative gross, so the
    // live recomputation will diverge from the frozen snapshot.
    const result = await updateSalesTransaction(tx.id, {
      transactionDate: "2026-01-15",
      orNumber: "",
      payorName: "Original Payor",
      payorTin: "",
      grossAmount: "400000",
      withholdingRateBps: "0",
      withholdingAmount: "",
      netReceivedOverride: "",
      incomeType: "OPERATING",
      description: "",
    });
    expect(result.ok).toBe(true);

    const filingAfter = await prisma.filing.findUniqueOrThrow({ where: { id: filing.id } });
    expect(filingAfter.computationSnapshot).toBe(snapshotJson); // byte-identical — never mutated

    const alerts = await prisma.amendmentAlert.findMany({ where: { filingId: filing.id } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].deltaCents).not.toBe(0);
    expect(alerts[0].snapshotJson).toBe(snapshotJson);
    expect(alerts[0].acknowledgedAt).toBeNull();
  });

  it("editing a transaction in a period that was never filed raises no alert", async () => {
    const client = await prisma.client.create({
      data: {
        code: `p3-amend-unfiled-${Date.now()}`,
        registeredName: "Unfiled Period Test Client",
        tin: "131313131",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    createdClientIds.push(client.id);

    const created = await createQuickTransaction(client.id, {
      transactionDate: "2026-02-01",
      orNumber: "",
      payorName: "Payor",
      payorTin: "",
      grossAmount: "50000",
      withholdingRateBps: "0",
      withholdingAmount: "",
      netReceivedOverride: "",
      incomeType: "OPERATING",
      description: "",
    });
    expect(created.ok).toBe(true);

    const result = await updateSalesTransaction(created.createdId!, {
      transactionDate: "2026-02-01",
      orNumber: "",
      payorName: "Payor",
      payorTin: "",
      grossAmount: "75000",
      withholdingRateBps: "0",
      withholdingAmount: "",
      netReceivedOverride: "",
      incomeType: "OPERATING",
      description: "",
    });
    expect(result.ok).toBe(true);

    const alertCount = await prisma.amendmentAlert.count({
      where: { filing: { clientId: client.id } },
    });
    expect(alertCount).toBe(0); // no frozen filing exists at all for this client/year
  });
});
