import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { saveQuarterlySales } from "@/lib/actions/quarterlySales";
import { assembleAndComputeFiling } from "@/lib/filingComputation";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * SPEC.md 5 / §16 item 16: editing declared sales (D26: QuarterlySales,
 * the only place income enters the system) in an already-filed period
 * raises an AmendmentAlert showing the delta between the frozen
 * computationSnapshot and a live recomputation — and does NOT mutate
 * computationSnapshot. This is "the single most important integrity
 * rule in the system" per SPEC.md 5.
 */
describe("AmendmentAlert wiring", () => {
  const createdClientIds: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.amendmentAlert.deleteMany({ where: { filing: { clientId: { in: createdClientIds } } } });
    await prisma.quarterlySales.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  });

  it("editing a quarter's declared gross sales in a filed period raises an AmendmentAlert without mutating computationSnapshot", async () => {
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

    await prisma.quarterlySales.create({
      data: {
        clientId: client.id,
        taxableYear: 2026,
        quarter: "Q1",
        grossSalesCents: 200_000_00,
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
    const result = await saveQuarterlySales(
      client.id,
      2026,
      "Q1",
      {},
      formDataOf({ intent: "final" }, [{ customerName: "Client X", amount: "400000" }]),
    );
    expect(result.saved).toBe(true);

    const filingAfter = await prisma.filing.findUniqueOrThrow({ where: { id: filing.id } });
    expect(filingAfter.computationSnapshot).toBe(snapshotJson); // byte-identical — never mutated

    const alerts = await prisma.amendmentAlert.findMany({ where: { filingId: filing.id } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].deltaCents).not.toBe(0);
    expect(alerts[0].snapshotJson).toBe(snapshotJson);
    expect(alerts[0].acknowledgedAt).toBeNull();
  });

  it("editing a quarter's declared sales for a taxable year with no filing at all raises no alert", async () => {
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

    const created = await saveQuarterlySales(
      client.id,
      2026,
      "Q2",
      {},
      formDataOf({ intent: "final" }, [{ customerName: "Client Y", amount: "50000" }]),
    );
    expect(created.saved).toBe(true);

    const result = await saveQuarterlySales(
      client.id,
      2026,
      "Q2",
      {},
      formDataOf({ intent: "final" }, [{ customerName: "Client Y", amount: "75000" }]),
    );
    expect(result.saved).toBe(true);

    const alertCount = await prisma.amendmentAlert.count({
      where: { filing: { clientId: client.id } },
    });
    expect(alertCount).toBe(0); // no frozen filing exists at all for this client/year
  });
});

function formDataOf(
  values: Record<string, string>,
  customers: { customerName: string; amount: string }[] = [],
): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  for (const row of customers) {
    fd.append("customerName", row.customerName);
    fd.append("amount", row.amount);
  }
  return fd;
}
