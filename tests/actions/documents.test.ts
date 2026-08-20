import { describe, it, expect, afterAll, vi } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { uploadDocument } from "@/lib/actions/documents";
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

    // Second upload, identical content, different slot -> warns, doesn't block.
    const step2 = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "SAVE_SUBMISSION_SS" },
    });
    const duplicateFormData = new FormData();
    duplicateFormData.set("file", new File([fileContent], "proof-again.pdf", { type: "application/pdf" }));
    duplicateFormData.set("workflowStepId", step2.id);
    duplicateFormData.set("docSlotCode", "submission_screenshot");
    duplicateFormData.set("documentDate", "2026-08-12");

    const duplicateResult = await uploadDocument(duplicateFormData);
    expect(duplicateResult.ok).toBe(true); // never blocked
    expect(duplicateResult.duplicateWarning).toContain("proof.pdf");

    const totalDocs = await prisma.document.count({ where: { clientId: client.id, deletedAt: null } });
    expect(totalDocs).toBe(2); // both saved, not silently overwritten
  });
});
