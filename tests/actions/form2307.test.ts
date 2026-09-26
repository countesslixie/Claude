import { describe, it, expect, afterAll, vi } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { addCertificate, deleteCertificate, type CertificateFormState } from "@/lib/actions/form2307";
import { setAllCertificatesReceived } from "@/lib/actions/filings";
import { markStepDone } from "@/lib/actions/workflowSteps";
import { uploadDocument, deleteDocument } from "@/lib/actions/documents";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";
import { createPayorInline } from "@/lib/actions/payors";

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
    await prisma.payor.deleteMany({ where: { clientId: { in: createdClientIds } } });
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
    // Brief #5a -- payorTin, payorAddress and atcCode are now required;
    // WI010 is seeded (prisma/seed.ts), so it exists as a real active code.
    fd.set("payorTin", "111222333");
    fd.set("payorAddress", "N/A");
    fd.set("atcCode", "WI010");
    fd.set("incomePayment", "10000");
    fd.set("taxWithheld", "500");
    // Brief #4c -- "Period covered" is now required, pre-filled by the
    // form with the filing's own quarter; tests supply it directly.
    // Brief #4d removed dateReceived entirely.
    fd.set("periodFrom", "2026-04-01");
    fd.set("periodTo", "2026-06-30");
    // Brief #5a -- the scan is part of saving the certificate now; a
    // default file so every test below gets a valid save unless it's
    // specifically testing the missing-scan case.
    fd.set("file", new File(["scan-bytes"], "scan.pdf", { type: "application/pdf" }));
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

  it("step 2 is Done once 'all received' is ticked, since the scan is already attached by construction", async () => {
    const { filing, step } = await makeClientWithQ2Filing("f2307-blocking");

    await addCertificate(filing.id, {} as CertificateFormState, certFormData());

    // Not done before ticking, even though the scan is already there.
    let updated = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step.id } });
    expect(updated.status).not.toBe("DONE");

    await setAllCertificatesReceived(filing.id, true);
    updated = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step.id } });
    expect(updated.status).toBe("DONE");
  });

  it("brief #5a: 'every row has a scan' still matters — removing the only scan un-Dones step 2, and Replace scan restores it", async () => {
    const { filing, step } = await makeClientWithQ2Filing("f2307-replace-scan");

    await addCertificate(filing.id, {} as CertificateFormState, certFormData());
    const cert = await prisma.form2307.findFirstOrThrow({ where: { claimedOnFilingId: filing.id, deletedAt: null } });
    await setAllCertificatesReceived(filing.id, true);
    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step.id } })).status).toBe("DONE");

    const scan = await prisma.document.findFirstOrThrow({ where: { form2307Id: cert.id, deletedAt: null } });
    await deleteDocument(scan.id, "test: simulate a scan removed");
    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step.id } })).status).not.toBe("DONE");

    // Replace scan — a fresh upload against the same certificate.
    const replaceFormData = new FormData();
    replaceFormData.set("file", new File(["new-scan-bytes"], "rescan.pdf", { type: "application/pdf" }));
    replaceFormData.set("workflowStepId", step.id);
    replaceFormData.set("docSlotCode", "form2307_scan");
    replaceFormData.set("form2307Id", cert.id);
    replaceFormData.set("documentDate", "2026-06-10");
    await uploadDocument(replaceFormData);

    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step.id } })).status).toBe("DONE");
    const activeScans = await prisma.document.findMany({ where: { form2307Id: cert.id, deletedAt: null } });
    expect(activeScans).toHaveLength(1);
    expect(activeScans[0].originalFilename).toBe("rescan.pdf");
  });

  it("unticking 'all received' reverts step 2 to not-done, even after it was Done", async () => {
    const { filing, step } = await makeClientWithQ2Filing("f2307-untick");

    await addCertificate(filing.id, {} as CertificateFormState, certFormData());
    await setAllCertificatesReceived(filing.id, true);
    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step.id } })).status).toBe("DONE");

    await setAllCertificatesReceived(filing.id, false);
    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step.id } })).status).toBe("WAITING_EXTERNAL");
  });

  it("brief #4d: removing the last certificate row unticks 'all received' and reverts step 2", async () => {
    const { filing, step } = await makeClientWithQ2Filing("f2307-untick-on-delete");

    await addCertificate(filing.id, {} as CertificateFormState, certFormData());
    const cert = await prisma.form2307.findFirstOrThrow({ where: { claimedOnFilingId: filing.id, deletedAt: null } });
    await setAllCertificatesReceived(filing.id, true);
    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step.id } })).status).toBe("DONE");

    // Brief #5a: removing a row while "all received" is ticked is refused
    // — untick first (see the "add and remove refused" test below for the
    // general rule). Untick, then the removal (and its own revert) proceeds.
    await setAllCertificatesReceived(filing.id, false);
    await deleteCertificate(cert.id, "entered in error");

    const updatedFiling = await prisma.filing.findUniqueOrThrow({ where: { id: filing.id } });
    expect(updatedFiling.certificatesAllReceivedAt).toBeNull();
    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step.id } })).status).toBe("WAITING_EXTERNAL");
  });

  it("brief #5a: add and remove are refused server-side while 'all received' is ticked; unticking restores both", async () => {
    const { filing } = await makeClientWithQ2Filing("f2307-all-received-lock");

    await addCertificate(filing.id, {} as CertificateFormState, certFormData());
    const cert = await prisma.form2307.findFirstOrThrow({ where: { claimedOnFilingId: filing.id, deletedAt: null } });
    await setAllCertificatesReceived(filing.id, true);

    const addResult = await addCertificate(filing.id, {} as CertificateFormState, certFormData({ payorName: "Second Payor" }));
    expect(addResult.error).toMatch(/all certificates received/i);

    const deleteResult = await deleteCertificate(cert.id, "test");
    expect(deleteResult.ok).toBe(false);
    expect(deleteResult.error).toMatch(/all certificates received/i);

    await setAllCertificatesReceived(filing.id, false);
    const addAfterUntick = await addCertificate(filing.id, {} as CertificateFormState, certFormData({ payorName: "Second Payor" }));
    expect(addAfterUntick.saved).toBe(true);
    const deleteAfterUntick = await deleteCertificate(cert.id, "test");
    expect(deleteAfterUntick.ok).toBe(true);
  });

  it("brief #5a: rate fills from the ATC code by default, and a typed override is kept and flagged", async () => {
    const { filing } = await makeClientWithQ2Filing("f2307-rate-fill");
    const wi010 = await prisma.atcCode.findUniqueOrThrow({ where: { code: "WI010" } });

    await addCertificate(filing.id, {} as CertificateFormState, certFormData());
    const filled = await prisma.form2307.findFirstOrThrow({ where: { claimedOnFilingId: filing.id, deletedAt: null } });
    expect(filled.withholdingRateBps).toBe(wi010.rateBps);
    expect(filled.rateOverridden).toBe(false);

    await deleteCertificate(filled.id, "test cleanup");
    await addCertificate(
      filing.id,
      {} as CertificateFormState,
      certFormData({ payorName: "Overridden Payor", withholdingRatePercent: "7.5" }),
    );
    const overridden = await prisma.form2307.findFirstOrThrow({
      where: { claimedOnFilingId: filing.id, deletedAt: null, payorName: "Overridden Payor" },
    });
    expect(overridden.withholdingRateBps).toBe(750);
    expect(overridden.rateOverridden).toBe(true);
  });

  it("brief #5a: payor TIN, payor address and ATC code are required server-side, not only in the form", async () => {
    const { filing } = await makeClientWithQ2Filing("f2307-required-fields");

    const result = await addCertificate(
      filing.id,
      {} as CertificateFormState,
      certFormData({ payorTin: "", payorAddress: "", atcCode: "" }),
    );
    expect(result.fieldErrors?.payorTin).toBeTruthy();
    expect(result.fieldErrors?.payorAddress).toBeTruthy();
    expect(result.fieldErrors?.atcCode).toBeTruthy();

    const count = await prisma.form2307.count({ where: { claimedOnFilingId: filing.id, deletedAt: null } });
    expect(count).toBe(0);
  });

  it("brief #5a: a certificate cannot be saved without its scan", async () => {
    const { filing } = await makeClientWithQ2Filing("f2307-no-scan");

    const fd = certFormData();
    fd.delete("file");
    const result = await addCertificate(filing.id, {} as CertificateFormState, fd);
    expect(result.fieldErrors?.file).toBeTruthy();

    const count = await prisma.form2307.count({ where: { claimedOnFilingId: filing.id, deletedAt: null } });
    expect(count).toBe(0);
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

  /**
   * Brief #5b — "the dialog's details reaching a later certificate": the
   * dialog (components/payor-details-dialog.tsx) saves name/TIN/address/
   * usual ATC via createPayorInline; step 2's picker then autofills a
   * later certificate from exactly that saved record. The autofill
   * itself is client-side JS this suite has no tooling to drive (see
   * tests/actions/payors.test.ts's note) — this proves the data path it
   * depends on: what the dialog saves is exactly what a certificate for
   * that payor needs, unchanged.
   */
  it("brief #5b: a payor saved with full details (as the dialog would) supplies everything a later certificate needs", async () => {
    const { client, filing } = await makeClientWithQ2Filing("f2307-dialog-details");

    const saved = await createPayorInline(client.id, {
      name: "Dialog-Saved Payor",
      tin: "222333444",
      address: "9 Dialog Lane",
      usualAtcCode: "WI010",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const result = await addCertificate(
      filing.id,
      {} as CertificateFormState,
      certFormData({
        payorName: saved.payor.name,
        payorTin: saved.payor.tin!,
        payorAddress: saved.payor.address!,
        atcCode: saved.payor.usualAtcCode!,
      }),
    );
    expect(result.saved).toBe(true);

    const cert = await prisma.form2307.findFirstOrThrow({
      where: { claimedOnFilingId: filing.id, deletedAt: null, payorName: "Dialog-Saved Payor" },
    });
    expect(cert.payorTin).toBe("222333444");
    expect(cert.payorAddress).toBe("9 Dialog Lane");
    expect(cert.atcCode).toBe("WI010");
  });
});
