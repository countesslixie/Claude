import { describe, it, expect, afterAll, vi } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { prisma } from "@/lib/prisma";
import { uploadDocument } from "@/lib/actions/documents";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";
import { GET } from "@/app/api/filings/[id]/package/route";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/** SPEC.md §16 item 19: the filing package zip contains every document plus a manifest listing empty slots. */
describe("GET /api/filings/[id]/package", () => {
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

  it("zips every attached document and lists required slots still empty in the manifest", async () => {
    clientCode = `p3-pkg-test-${Date.now()}`;
    const client = await prisma.client.create({
      data: {
        code: clientCode,
        registeredName: "Phase 3 Package Test Client",
        tin: "888999000",
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

    // Attach a document to SAVE_FORM_COPY (step 7)...
    const formCopyStep = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "SAVE_FORM_COPY" },
    });
    const formData = new FormData();
    formData.set("file", new File(["filed-form-bytes"], "filed-form.pdf", { type: "application/pdf" }));
    formData.set("workflowStepId", formCopyStep.id);
    formData.set("docSlotCode", "filed_form");
    formData.set("documentDate", "2026-08-15");
    const uploadResult = await uploadDocument(formData);
    expect(uploadResult.ok).toBe(true);

    // ...but leave SAVE_PROOF_PAYMENT (step 9) empty, so it shows in the manifest's empty-slots section.

    const response = await GET(new Request(`http://localhost/api/filings/${filing.id}/package`), {
      params: Promise.resolve({ id: filing.id }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");

    const arrayBuffer = await response.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    const zipFilenames = Object.keys(zip.files);
    expect(zipFilenames.some((f) => f.includes("filed-form.pdf"))).toBe(true);
    expect(zipFilenames).toContain("manifest.txt");

    const manifestText = await zip.file("manifest.txt")!.async("string");
    expect(manifestText).toContain("SAVE_FORM_COPY / filed_form — filed-form.pdf");
    expect(manifestText).toContain("SAVE_PROOF_PAYMENT / proof — Payment confirmation"); // listed as empty
  });
});
