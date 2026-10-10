import { describe, it, expect, afterAll, vi } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { uploadDocument, deleteDocument } from "@/lib/actions/documents";
import { markStepDone } from "@/lib/actions/workflowSteps";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";
import { parseDocSlots } from "@/lib/workflow/types";
import { addFiledFormPage2Slot, FILED_FORM_SLOTS } from "../../prisma/backfills";
import { markEarlierQuartersFiled, resolvePrepare } from "../helpers/filedEarlier";
import { testStorageRoot } from "@/tests/helpers/testEnv";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/** D193 -- step 7 takes two files, Page 1 (the old slot) and Page 2; Done only with both. */
describe("step 7: the filed form's two pages (D193)", () => {
  const clientIds: string[] = [];
  const codes: string[] = [];

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.workflowStep.deleteMany({ where: { filing: { clientId: { in: clientIds } } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    for (const c of codes) await rm(path.join(testStorageRoot(), c), { recursive: true, force: true });
  });

  async function makeFiling(prefix: string, fileIt = true) {
    const code = `${prefix}-${Date.now()}`;
    codes.push(code);
    const client = await prisma.client.create({
      data: { code, registeredName: "Page Test Client", tin: "999000222", rdoCode: "999", registeredAddress: "N/A", taxpayerType: "PURELY_SELF_EMPLOYED", booksType: "MANUAL", defaultWithholdingRateBps: 500 },
    });
    clientIds.push(client.id);
    await generateFilingsForClientYear(client.id, 2026);
    await markEarlierQuartersFiled(client.id, 2026, "Q2");
    const filing = await prisma.filing.findUniqueOrThrow({ where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q2" } } });
    const step7 = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "SAVE_FORM_COPY" } });
    if (fileIt) {
      const s5 = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "FILE_RETURN" } });
      await resolvePrepare(filing.id);
      expect((await markStepDone(s5.id)).ok).toBe(true);
    }
    return { filing, step7 };
  }

  const upload = (stepId: string, slot: string, name: string) => {
    const fd = new FormData();
    fd.set("file", new File([name], name, { type: "application/pdf" }));
    fd.set("workflowStepId", stepId);
    fd.set("docSlotCode", slot);
    fd.set("documentDate", "2026-08-15");
    return uploadDocument(fd);
  };
  const status = async (id: string) => (await prisma.workflowStep.findUniqueOrThrow({ where: { id } })).status;

  it("a new filing's step 7 has the two required slots, Page 1 keeping the old slot code", async () => {
    const { step7 } = await makeFiling("p6r-slots", false);
    const slots = parseDocSlots(step7.requiredDocSlots);
    expect(slots.map((s) => [s.slotCode, s.label, s.required])).toEqual([["filed_form", "Page 1", true], ["filed_form_page2", "Page 2", true]]);
  });

  it("uploads are refused until step 5 is Done", async () => {
    const { step7 } = await makeFiling("p6r-locked", false);
    for (const slot of ["filed_form", "filed_form_page2"]) {
      const r = await upload(step7.id, slot, "x.pdf");
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/step 5/i);
    }
    expect(await status(step7.id)).toBe("PENDING");
  });

  it("page 1 alone leaves it Pending; page 2 completes it", async () => {
    const { step7 } = await makeFiling("p6r-both");
    expect((await upload(step7.id, "filed_form", "p1.pdf")).ok).toBe(true);
    expect(await status(step7.id)).toBe("PENDING");
    expect((await upload(step7.id, "filed_form_page2", "p2.pdf")).ok).toBe(true);
    expect(await status(step7.id)).toBe("DONE");
  });

  it("Replace is one-for-one per page and leaves the other page alone", async () => {
    const { step7 } = await makeFiling("p6r-replace");
    await upload(step7.id, "filed_form", "p1.pdf");
    await upload(step7.id, "filed_form_page2", "p2.pdf");
    await upload(step7.id, "filed_form_page2", "p2-new.pdf");
    const live = await prisma.document.findMany({ where: { workflowStepId: step7.id, deletedAt: null }, orderBy: { docSlotCode: "asc" } });
    expect(live.map((d) => [d.docSlotCode, d.originalFilename])).toEqual([["filed_form", "p1.pdf"], ["filed_form_page2", "p2-new.pdf"]]);
    expect(await status(step7.id)).toBe("DONE");
  });

  it("removing either page returns it to Pending", async () => {
    for (const slot of ["filed_form", "filed_form_page2"]) {
      const { step7 } = await makeFiling(`p6r-remove-${slot.length}`);
      const a = await upload(step7.id, "filed_form", "p1.pdf");
      const b = await upload(step7.id, "filed_form_page2", "p2.pdf");
      expect(await status(step7.id)).toBe("DONE");
      await deleteDocument(slot === "filed_form" ? a.documentId! : b.documentId!, "test");
      expect(await status(step7.id)).toBe("PENDING");
    }
  });

  it("a step 7 already Done with one old-slot file stays Done, and the backfill leaves it alone", async () => {
    const { step7 } = await makeFiling("p6r-old-done");
    // The step as it was before this brief: the one old slot.
    const oldSlots = JSON.stringify([{ slotCode: "filed_form", label: "Filed form PDF", required: true, acceptedTypes: ["pdf"] }]);
    await prisma.workflowStep.update({ where: { id: step7.id }, data: { requiredDocSlots: oldSlots } });
    await upload(step7.id, "filed_form", "old.pdf");
    expect(await status(step7.id)).toBe("DONE");
    await addFiledFormPage2Slot(prisma);
    const after = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step7.id } });
    expect(after.status).toBe("DONE");
    expect(after.requiredDocSlots).toBe(oldSlots);
    expect(await prisma.document.count({ where: { workflowStepId: step7.id, deletedAt: null } })).toBe(1);
  });

  it("the backfill touches only non-Done step 7 rows on non-Complete filings, only requiredDocSlots, and is idempotent", async () => {
    const open = (await makeFiling("p6r-bf-open", false)).step7;
    const complete = (await makeFiling("p6r-bf-complete", false)).step7;
    const oldSlots = JSON.stringify([{ slotCode: "filed_form", label: "Filed form PDF", required: true, acceptedTypes: ["pdf"] }]);
    await prisma.workflowStep.updateMany({ where: { id: { in: [open.id, complete.id] } }, data: { requiredDocSlots: oldSlots } });
    await prisma.filing.update({ where: { id: complete.filingId }, data: { status: "COMPLETE" } });

    const openBefore = await prisma.workflowStep.findUniqueOrThrow({ where: { id: open.id } });
    await addFiledFormPage2Slot(prisma);
    const openAfter = await prisma.workflowStep.findUniqueOrThrow({ where: { id: open.id } });
    expect(openAfter.requiredDocSlots).toBe(JSON.stringify(FILED_FORM_SLOTS));
    expect({ ...openAfter, requiredDocSlots: null, updatedAt: null }).toEqual({ ...openBefore, requiredDocSlots: null, updatedAt: null });
    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: complete.id } })).requiredDocSlots).toBe(oldSlots);

    expect(await addFiledFormPage2Slot(prisma)).toBe(0); // second run changes nothing
    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: open.id } })).requiredDocSlots).toBe(JSON.stringify(FILED_FORM_SLOTS));
  });
});
