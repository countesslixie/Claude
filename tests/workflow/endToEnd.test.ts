import { describe, it, expect, afterAll, vi } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { generateFilingsForClientYear, recomputeRequiresSawt } from "@/lib/workflow/filingGeneration";
import { uploadDocument } from "@/lib/actions/documents";
import { markStepDone } from "@/lib/actions/workflowSteps";
import { parseDocSlots } from "@/lib/workflow/types";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * SPEC.md §16 item 20: a seeded client with 2307s can be driven from
 * step 1 to step 16, with all documents attached, and finishes at
 * COMPLETE.
 */
describe("end-to-end: driving a filing from step 1 to step 16", () => {
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

  it("completing every step's required documents and marking each DONE drives the filing to COMPLETE", async () => {
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
      const slots = parseDocSlots(step.requiredDocSlots);
      for (const slot of slots) {
        const formData = new FormData();
        formData.set("file", new File([`${step.stepCode}-${slot.slotCode}-contents`], `${slot.slotCode}.pdf`, { type: "application/pdf" }));
        formData.set("workflowStepId", step.id);
        formData.set("docSlotCode", slot.slotCode);
        formData.set("documentDate", "2026-08-15");
        const uploadResult = await uploadDocument(formData);
        expect(uploadResult.ok).toBe(true);
      }

      const doneResult = await markStepDone(step.id);
      expect(doneResult.ok).toBe(true);
    }

    const finalSteps = await prisma.workflowStep.findMany({ where: { filingId: filing.id } });
    expect(finalSteps.every((s) => s.status === "DONE")).toBe(true);

    const finalFiling = await prisma.filing.findUniqueOrThrow({ where: { id: filing.id } });
    expect(finalFiling.status).toBe("COMPLETE");
  });
});
