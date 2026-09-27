import { describe, it, expect, afterAll, vi } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { saveQuarterlySales } from "@/lib/actions/quarterlySales";
import { addCertificate, deleteCertificate, type CertificateFormState } from "@/lib/actions/form2307";
import { setAllCertificatesReceived } from "@/lib/actions/filings";
import { markStepDone, skipStep } from "@/lib/actions/workflowSteps";
import { uploadDocument } from "@/lib/actions/documents";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * Brief #5d §6 — while a filing's own return isn't filed (step 5,
 * FILE_RETURN, not DONE), a change to the figures behind the computation
 * made after step 3 (PREPARE_RETURN) is Done reopens both step 3 and
 * step 4 (ADVISE_CLIENT). A no-change save and a Replace scan don't. A
 * filed filing is untouched (its mutating actions are already refused
 * outright before reopening logic would ever run).
 */
describe("reopening steps 3/4 after a change to the computation's figures", () => {
  const createdClientIds: string[] = [];
  const clientCodes: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.document.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.form2307.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.quarterlySalesCustomer.deleteMany({ where: { quarterlySales: { clientId: { in: createdClientIds } } } });
    await prisma.quarterlySales.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.workflowStep.deleteMany({ where: { filing: { clientId: { in: createdClientIds } } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
    for (const code of clientCodes) {
      await rm(path.join(process.cwd(), "storage", code), { recursive: true, force: true });
    }
  });

  function salesFormData(intent: "draft" | "final", amount: string, customerName = "Client A"): FormData {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.append("customerName", customerName);
    fd.append("amount", amount);
    return fd;
  }

  function certFormData(overrides: Record<string, string> = {}): FormData {
    const fd = new FormData();
    fd.set("payorName", "Test Payor");
    fd.set("payorTin", "111222333");
    fd.set("payorAddress", "N/A");
    fd.set("atcCode", "WI010");
    fd.set("incomePayment", "10000");
    fd.set("taxWithheld", "500");
    fd.set("periodFrom", "2026-04-01");
    fd.set("periodTo", "2026-06-30");
    fd.set("file", new File(["scan-bytes"], "scan.pdf", { type: "application/pdf" }));
    for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
    return fd;
  }

  /** A Q2 filing with step 1 final-saved, step 2 skipped, and step 3 marked Done. */
  async function makePreparedFilingNoCerts(codePrefix: string) {
    const code = `${codePrefix}-${Date.now()}`;
    clientCodes.push(code);
    const client = await prisma.client.create({
      data: {
        code,
        registeredName: "Reopen Test Client",
        tin: "555666777",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    createdClientIds.push(client.id);
    await generateFilingsForClientYear(client.id, 2026);
    const filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q2" } },
    });

    await saveQuarterlySales(client.id, 2026, "Q2", {}, salesFormData("final", "1000"));

    const step2 = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECEIVE_2307" } });
    await skipStep(step2.id, "No 2307s expected this quarter.");

    const step3 = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "PREPARE_RETURN" } });
    const step4 = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "ADVISE_CLIENT" } });
    const prepareResult = await markStepDone(step3.id);
    if (!prepareResult.ok) throw new Error(`Setup failed to prepare filing: ${prepareResult.error}`);
    await markStepDone(step4.id);

    return { client, filing, step3, step4 };
  }

  /** A Q2 filing with one certificate on file, step 1 final-saved, step 2 Done, and step 3 marked Done. */
  async function makePreparedFilingWithCert(codePrefix: string) {
    const code = `${codePrefix}-${Date.now()}`;
    clientCodes.push(code);
    const client = await prisma.client.create({
      data: {
        code,
        registeredName: "Reopen Test Client (with certs)",
        tin: "555666778",
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

    await saveQuarterlySales(client.id, 2026, "Q2", {}, salesFormData("final", "1000"));
    await addCertificate(filing.id, {} as CertificateFormState, certFormData());
    await setAllCertificatesReceived(filing.id, true);

    const step2 = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECEIVE_2307" } });
    expect(step2.status).toBe("DONE");

    const step3 = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "PREPARE_RETURN" } });
    const step4 = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "ADVISE_CLIENT" } });
    const prepareResult = await markStepDone(step3.id);
    if (!prepareResult.ok) throw new Error(`Setup failed to prepare filing: ${prepareResult.error}`);
    await markStepDone(step4.id);

    return { client, filing, step3, step4 };
  }

  it("a final save that changes the sales figures reopens steps 3 and 4", async () => {
    const { client, filing, step3, step4 } = await makePreparedFilingNoCerts("reopen-final-changed");

    await saveQuarterlySales(client.id, 2026, "Q2", {}, salesFormData("final", "2000"));

    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step3.id } })).status).toBe("PENDING");
    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step4.id } })).status).toBe("PENDING");
    void filing;
  });

  it("a final save with no changes does NOT reopen steps 3 and 4", async () => {
    const { client, step3, step4 } = await makePreparedFilingNoCerts("reopen-final-unchanged");

    // Same customer name and amount as setup.
    await saveQuarterlySales(client.id, 2026, "Q2", {}, salesFormData("final", "1000"));

    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step3.id } })).status).toBe("DONE");
    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step4.id } })).status).toBe("DONE");
  });

  it("a draft save reopens steps 3 and 4 unconditionally (mirrors step 1's own D40 behavior)", async () => {
    const { client, step3, step4 } = await makePreparedFilingNoCerts("reopen-draft");

    // Same amount as setup — a draft save still reopens even though the
    // figures themselves didn't change, since it already reopens step 1.
    await saveQuarterlySales(client.id, 2026, "Q2", {}, salesFormData("draft", "1000"));

    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step3.id } })).status).toBe("PENDING");
    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step4.id } })).status).toBe("PENDING");
  });

  it("adding a certificate reopens steps 3 and 4", async () => {
    const { filing, step3, step4 } = await makePreparedFilingWithCert("reopen-add-cert");

    // A late-arriving certificate: untick "all received" first (server-side
    // rule, brief #5a), then add it.
    await setAllCertificatesReceived(filing.id, false);
    await addCertificate(filing.id, {} as CertificateFormState, certFormData({ payorName: "Second Payor" }));

    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step3.id } })).status).toBe("PENDING");
    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step4.id } })).status).toBe("PENDING");
  });

  it("removing a certificate reopens steps 3 and 4", async () => {
    const { filing, step3, step4 } = await makePreparedFilingWithCert("reopen-remove-cert");
    const cert = await prisma.form2307.findFirstOrThrow({ where: { claimedOnFilingId: filing.id, deletedAt: null } });

    await setAllCertificatesReceived(filing.id, false);
    await deleteCertificate(cert.id, "removed in test");

    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step3.id } })).status).toBe("PENDING");
    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step4.id } })).status).toBe("PENDING");
  });

  it("unticking 'all certificates received' reopens steps 3 and 4", async () => {
    const { filing, step3, step4 } = await makePreparedFilingWithCert("reopen-untick");

    await setAllCertificatesReceived(filing.id, false);

    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step3.id } })).status).toBe("PENDING");
    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step4.id } })).status).toBe("PENDING");
  });

  it("Replace scan does NOT reopen steps 3 and 4", async () => {
    const { filing, step3, step4 } = await makePreparedFilingWithCert("reopen-replace-scan");
    const cert = await prisma.form2307.findFirstOrThrow({ where: { claimedOnFilingId: filing.id, deletedAt: null } });
    const step2 = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECEIVE_2307" } });

    const replaceFormData = new FormData();
    replaceFormData.set("file", new File(["new-scan-bytes"], "rescan.pdf", { type: "application/pdf" }));
    replaceFormData.set("workflowStepId", step2.id);
    replaceFormData.set("docSlotCode", "form2307_scan");
    replaceFormData.set("form2307Id", cert.id);
    replaceFormData.set("documentDate", "2026-06-10");
    await uploadDocument(replaceFormData);

    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step3.id } })).status).toBe("DONE");
    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step4.id } })).status).toBe("DONE");
  });

  it("a filed filing (step 5 Done) is untouched — the mutation itself is refused before any reopening logic runs", async () => {
    const { client, filing, step3, step4 } = await makePreparedFilingNoCerts("reopen-filed");

    const fileReturnStep = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "FILE_RETURN" },
    });
    await markStepDone(fileReturnStep.id);

    const result = await saveQuarterlySales(client.id, 2026, "Q2", {}, salesFormData("final", "9999"));
    expect(result.error).toMatch(/locked/i);

    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step3.id } })).status).toBe("DONE");
    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step4.id } })).status).toBe("DONE");
  });
});
