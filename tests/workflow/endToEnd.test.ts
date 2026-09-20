import { describe, it, expect, afterAll, vi } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { generateFilingsForClientYear, recomputeRequiresSawt } from "@/lib/workflow/filingGeneration";
import { markStepDone } from "@/lib/actions/workflowSteps";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * Rework brief acceptance criteria: no step can be blocked from DONE by
 * a missing document, asserted across all 16 steps (§5.1/D27) — driving
 * a filing from step 1 to step 16 with NO documents attached at all
 * still reaches COMPLETE.
 */
describe("end-to-end: driving a filing from step 1 to step 16 with no documents attached", () => {
  const createdClientIds: string[] = [];
  let clientCode = "";

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.document.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.form2307.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.workflowStep.deleteMany({ where: { filing: { clientId: { in: createdClientIds } } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
    if (clientCode) {
      await rm(path.join(process.cwd(), "storage", clientCode), { recursive: true, force: true });
    }
  });

  it("marking every step DONE with zero documents attached still drives the filing to COMPLETE", async () => {
    clientCode = `p3-e2e-${Date.now()}`;
    const client = await prisma.client.create({
      data: {
        code: clientCode,
        registeredName: "End-to-End Test Client",
        tin: "000111222",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
        defaultWithholdingRateBps: 500,
      },
    });
    createdClientIds.push(client.id);

    await generateFilingsForClientYear(client.id, 2026);
    // Q2, not Q1: this test is about document gating (§5.1), not the
    // election hard-blocker (§7) — see tests/workflow/election.test.ts
    // for that one.
    const filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q2" } },
    });

    // Give this filing a 2307, so requiresSawt flips true and steps
    // 11-14 become real (not auto-NA) — the harder path through the board.
    await prisma.form2307.create({
      data: {
        clientId: client.id,
        taxableYear: 2026,
        payorName: "E2E Payor",
        payorTin: "333444555",
        periodFrom: new Date("2026-04-01T00:00:00.000Z"),
        periodTo: new Date("2026-06-30T00:00:00.000Z"),
        quarterCovered: 2,
        atcCode: "WI010",
        incomePaymentCents: 10_000_00,
        taxWithheldCents: 500_00,
        withholdingRateBps: 500,
        status: "RECORDED",
      },
    });
    await recomputeRequiresSawt(client.id, 2026, "Q2");

    const steps = await prisma.workflowStep.findMany({ where: { filingId: filing.id }, orderBy: { sequence: "asc" } });
    expect(steps).toHaveLength(16);
    expect(steps.every((s) => s.status !== "NA")).toBe(true); // requiresSawt true -> nothing auto-NA'd

    for (const step of steps) {
      const doneResult = await markStepDone(step.id);
      expect(doneResult.ok).toBe(true);
    }

    // PREPARE_RETURN is the one exception: the app saves its own
    // computation sheet into its slot as a side effect of being marked
    // done (§5.4) — not a document the bookkeeper attached.
    const attachedDocs = await prisma.document.count({ where: { filingId: filing.id, deletedAt: null } });
    expect(attachedDocs).toBe(1);

    const finalSteps = await prisma.workflowStep.findMany({ where: { filingId: filing.id } });
    expect(finalSteps.every((s) => s.status === "DONE")).toBe(true);

    const finalFiling = await prisma.filing.findUniqueOrThrow({ where: { id: filing.id } });
    expect(finalFiling.status).toBe("COMPLETE");
  });
});
