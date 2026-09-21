import { describe, it, expect, afterAll, vi } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { addCertificate, deleteCertificate, type CertificateFormState } from "@/lib/actions/form2307";
import { setAllCertificatesReceived } from "@/lib/actions/filings";
import { markStepDone } from "@/lib/actions/workflowSteps";
import { uploadDocument } from "@/lib/actions/documents";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * Brief #4b (D27/D34) — step 2 (RECEIVE_2307) holds one row per
 * certificate, entered under the filing whose step 2 it belongs to.
 * Done once "all certificates received" is ticked AND every row has its
 * own scan; locked once that filing's own return is filed.
 */
describe("step 2 — certificate entry (addCertificate/deleteCertificate)", () => {
  const createdClientIds: string[] = [];
  const clientCodes: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.document.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.form2307.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.workflowStep.deleteMany({ where: { filing: { clientId: { in: createdClientIds } } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
    for (const code of clientCodes) {
      await rm(path.join(process.cwd(), "storage", code), { recursive: true, force: true });
    }
  });

  async function makeClientWithQ2Filing(codePrefix: string) {
    const code = `${codePrefix}-${Date.now()}`;
    clientCodes.push(code);
    const client = await prisma.client.create({
      data: {
        code,
        registeredName: "Form2307 Action Test Client",
        tin: "222111000",
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
    const step = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECEIVE_2307" } });
    return { client, filing, step };
  }

  function certFormData(overrides: Record<string, string> = {}): FormData {
    const fd = new FormData();
    fd.set("payorName", "Test Payor");
    fd.set("incomePayment", "10000");
    fd.set("taxWithheld", "500");
    fd.set("dateReceived", "2026-06-10");
    for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
    return fd;
  }

  it("adds a certificate claimed on this filing, quarterCovered derived automatically", async () => {
    const { client, filing } = await makeClientWithQ2Filing("f2307-add");

    const result = await addCertificate(filing.id, {} as CertificateFormState, certFormData());
    expect(result.saved).toBe(true);

    const cert = await prisma.form2307.findFirstOrThrow({ where: { clientId: client.id, deletedAt: null } });
    expect(cert.claimedOnFilingId).toBe(filing.id);
    expect(cert.quarterCovered).toBe(2);
    expect(cert.status).toBe("RECORDED");
  });

  it("step 2 is Done only once 'all received' is ticked AND every row has its own scan", async () => {
    const { filing, step } = await makeClientWithQ2Filing("f2307-blocking");

    await addCertificate(filing.id, {} as CertificateFormState, certFormData());
    const cert = await prisma.form2307.findFirstOrThrow({ where: { claimedOnFilingId: filing.id, deletedAt: null } });

    // Ticking "all received" without a scan on the one row leaves step 2 not done.
    await setAllCertificatesReceived(filing.id, true);
    let updated = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step.id } });
    expect(updated.status).not.toBe("DONE");

    // Attach the scan, then step 2 completes.
    const formData = new FormData();
    formData.set("file", new File(["scan-bytes"], "scan.pdf", { type: "application/pdf" }));
    formData.set("workflowStepId", step.id);
    formData.set("docSlotCode", "form2307_scan");
    formData.set("form2307Id", cert.id);
    formData.set("documentDate", "2026-06-10");
    await uploadDocument(formData);

    updated = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step.id } });
    expect(updated.status).toBe("DONE");
  });

  it("unticking 'all received' reverts step 2 to not-done, even after it was Done", async () => {
    const { filing, step } = await makeClientWithQ2Filing("f2307-untick");

    await addCertificate(filing.id, {} as CertificateFormState, certFormData());
    const cert = await prisma.form2307.findFirstOrThrow({ where: { claimedOnFilingId: filing.id, deletedAt: null } });

    const formData = new FormData();
    formData.set("file", new File(["scan-bytes"], "scan.pdf", { type: "application/pdf" }));
    formData.set("workflowStepId", step.id);
    formData.set("docSlotCode", "form2307_scan");
    formData.set("form2307Id", cert.id);
    formData.set("documentDate", "2026-06-10");
    await uploadDocument(formData);
    await setAllCertificatesReceived(filing.id, true);
    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step.id } })).status).toBe("DONE");

    await setAllCertificatesReceived(filing.id, false);
    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step.id } })).status).toBe("WAITING_EXTERNAL");
  });

  it("step 2's list is locked once this filing's step 5 (FILE_RETURN) is done", async () => {
    const { filing } = await makeClientWithQ2Filing("f2307-locked");

    await addCertificate(filing.id, {} as CertificateFormState, certFormData());
    const cert = await prisma.form2307.findFirstOrThrow({ where: { claimedOnFilingId: filing.id, deletedAt: null } });

    const fileReturnStep = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "FILE_RETURN" },
    });
    await markStepDone(fileReturnStep.id);

    const addResult = await addCertificate(filing.id, {} as CertificateFormState, certFormData({ payorName: "Late Payor" }));
    expect(addResult.error).toMatch(/filed/i);

    const deleteResult = await deleteCertificate(cert.id, "test");
    expect(deleteResult.ok).toBe(false);
  });
});
