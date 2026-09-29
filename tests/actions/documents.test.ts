import { describe, it, expect, afterAll, vi } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { uploadDocument } from "@/lib/actions/documents";
import { markStepDone } from "@/lib/actions/workflowSteps";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * SPEC.md §16 items 17-18: upload writes to the exact §8 path and
 * records SHA-256; a duplicate hash within a client warns, doesn't
 * silently overwrite.
 */
describe("uploadDocument", () => {
  const createdClientIds: string[] = [];
  let clientCode = "";

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.document.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.quarterlySales.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.workflowStep.deleteMany({ where: { filing: { clientId: { in: createdClientIds } } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
    if (clientCode) {
      await rm(path.join(process.cwd(), "storage", clientCode), { recursive: true, force: true });
    }
  });

  it("writes the file to the exact §8 storage path, records SHA-256, and warns (not blocks) on a duplicate", async () => {
    clientCode = `p3-doc-test-${Date.now()}`;
    const client = await prisma.client.create({
      data: {
        code: clientCode,
        registeredName: "Phase 3 Document Test Client",
        tin: "777888999",
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

    // D75 (brief #5m §3) -- SAVE_PROOF_PAYMENT is now locked until File
    // (steps 5, 6, 7) and step 8 (MAKE_PAYMENT) are all Done. Resolved
    // here so this test can stay about the upload path itself, not the
    // new Pay-group lock (covered separately in workflowSteps.test.ts).
    // D76 -- a real Q2 sales figure keeps this a genuine "payable" return,
    // so steps 8/9 stay PENDING rather than auto-NA'ing (nothing to pay).
    await prisma.quarterlySales.create({
      data: { clientId: client.id, taxableYear: 2026, quarter: "Q2", grossSalesCents: 500_000_00, finalizedAt: new Date() },
    });
    const fileReturnStep = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "FILE_RETURN" },
    });
    await markStepDone(fileReturnStep.id);
    for (const [stepCode, slotCode] of [
      ["SAVE_SUBMISSION_SS", "submission_screenshot"],
      ["SAVE_FORM_COPY", "filed_form"],
    ] as const) {
      const s = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode } });
      const fd = new FormData();
      fd.set("file", new File(["bytes"], `${stepCode}.pdf`, { type: "application/pdf" }));
      fd.set("workflowStepId", s.id);
      fd.set("docSlotCode", slotCode);
      fd.set("documentDate", "2026-08-15");
      await uploadDocument(fd);
    }
    const makePaymentStep = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "MAKE_PAYMENT" },
    });
    await markStepDone(makePaymentStep.id);

    const step = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "SAVE_PROOF_PAYMENT" },
    });

    const fileContent = "proof-of-payment-contents";
    const file = new File([fileContent], "proof.pdf", { type: "application/pdf" });

    const formData = new FormData();
    formData.set("file", file);
    formData.set("workflowStepId", step.id);
    formData.set("docSlotCode", "proof");
    formData.set("documentDate", "2026-08-12");

    const result = await uploadDocument(formData);
    expect(result.ok).toBe(true);
    expect(result.duplicateWarning).toBeUndefined();

    const doc = await prisma.document.findUniqueOrThrow({ where: { id: result.documentId! } });
    expect(doc.storedPath).toBe(`${clientCode}/2026/Q2/SAVE_PROOF_PAYMENT__proof__20260812__01.pdf`);
    expect(doc.sha256).toHaveLength(64);
    expect(doc.category).toBe("PAYMENT_CONFIRMATION");
    expect(doc.originalFilename).toBe("proof.pdf");

    const storedFile = await import("node:fs/promises").then((fs) =>
      fs.readFile(path.join(process.cwd(), "storage", doc.storedPath)),
    );
    expect(storedFile.toString()).toBe(fileContent);

    // Second upload, identical content, different slot -> warns, doesn't
    // block. EAFS_SUBMIT's slot is never locked/self-completing (D75's new
    // Pay-group lock and D67's File-group lock don't apply to it), so this
    // stays purely about the duplicate-hash warning.
    const step2 = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "EAFS_SUBMIT" },
    });
    const duplicateFormData = new FormData();
    duplicateFormData.set("file", new File([fileContent], "proof-again.pdf", { type: "application/pdf" }));
    duplicateFormData.set("workflowStepId", step2.id);
    duplicateFormData.set("docSlotCode", "eafs_confirmation");
    duplicateFormData.set("documentDate", "2026-08-12");

    const duplicateResult = await uploadDocument(duplicateFormData);
    expect(duplicateResult.ok).toBe(true); // never blocked
    expect(duplicateResult.duplicateWarning).toContain("proof.pdf");

    // submission_screenshot + filed_form (unlocking File) + proof + the
    // eafs_confirmation duplicate = 4; both the proof and its duplicate
    // are still counted, never silently overwritten.
    const totalDocs = await prisma.document.count({ where: { clientId: client.id, deletedAt: null } });
    expect(totalDocs).toBe(4);
  });
});
