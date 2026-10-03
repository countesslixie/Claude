import { describe, it, expect, afterAll, vi } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";
import {
  markStepDone,
  markStepInProgress,
  markStepWaitingExternal,
  skipStep,
  unskipStep,
  logFollowUp,
  reopenSkippedReceive2307,
  reopenPreparedFiling,
  recomputeReceive2307Status,
  recomputeFileGroupDocStepStatus,
} from "@/lib/actions/workflowSteps";
import { uploadDocument, deleteDocument } from "@/lib/actions/documents";
import { addCertificate, deleteCertificate, type CertificateFormState } from "@/lib/actions/form2307";
import {
  setAllCertificatesReceived,
  dismissCompletenessNote,
  updateFilingOtherCredits,
  savePayment,
} from "@/lib/actions/filings";
import { FILING_LOCKED_MESSAGE, FilingLockedError } from "@/lib/workflow/filingLock";
import { markEarlierQuartersFiled } from "../helpers/filedEarlier";
import { testStorageRoot } from "@/tests/helpers/testEnv";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * D153 — a Complete filing is read-only for good. Every server action that
 * changes a filing, its steps, its documents or its certificates refuses
 * with one plain message; the same action still works on an in-progress
 * filing. "Complete" here is the derived Filing.status (the green pill).
 */
describe("a Complete filing is locked (D153)", () => {
  const createdClientIds: string[] = [];
  const clientCodes: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.document.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.form2307.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.workflowStep.deleteMany({ where: { filing: { clientId: { in: createdClientIds } } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
    for (const code of clientCodes) await rm(path.join(testStorageRoot(), code), { recursive: true, force: true });
  });

  /** A client with a generated Q2 2026 filing; `complete` forces every step resolved and the filing Complete. */
  async function fresh(complete: boolean, opts: { step2Skipped?: boolean } = {}) {
    const code = `d153-${complete ? "c" : "p"}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    clientCodes.push(code);
    const client = await prisma.client.create({
      data: {
        code,
        registeredName: "Complete Lock Test Client",
        tin: "999888777",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    createdClientIds.push(client.id);
    await generateFilingsForClientYear(client.id, 2026);
    await markEarlierQuartersFiled(client.id, 2026, "Q2");
    let filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q2" } },
    });
    if (complete) {
      await prisma.workflowStep.updateMany({ where: { filingId: filing.id }, data: { status: "DONE" } });
      if (opts.step2Skipped) {
        await prisma.workflowStep.updateMany({
          where: { filingId: filing.id, stepCode: "RECEIVE_2307" },
          data: { status: "SKIPPED", skippedReason: "No certificates this quarter." },
        });
      }
      filing = await prisma.filing.update({ where: { id: filing.id }, data: { status: "COMPLETE" } });
    }
    return { client, filing };
  }

  const step = (filingId: string, stepCode: string) =>
    prisma.workflowStep.findFirstOrThrow({ where: { filingId, stepCode } });

  /** Marks File (5, 6, 7) Done directly so Pay and the BIR upload boxes are open on an in-progress filing. */
  async function openFileGroup(filingId: string) {
    await prisma.workflowStep.updateMany({
      where: { filingId, stepCode: { in: ["FILE_RETURN", "SAVE_SUBMISSION_SS", "SAVE_FORM_COPY"] } },
      data: { status: "DONE" },
    });
  }

  function certFormData(): FormData {
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
    return fd;
  }

  function uploadForm(stepId: string, slotCode: string): FormData {
    const fd = new FormData();
    fd.set("file", new File(["contents"], `${slotCode}.pdf`, { type: "application/pdf" }));
    fd.set("workflowStepId", stepId);
    fd.set("docSlotCode", slotCode);
    return fd;
  }

  function creditsForm(): FormData {
    const fd = new FormData();
    fd.set("otherCredits", "1000");
    fd.set("otherCreditsDescription", "Test credit");
    return fd;
  }

  function paymentForm(): FormData {
    const fd = new FormData();
    fd.set("amountPaid", "100.00");
    fd.set("paymentDate", "2026-08-10");
    fd.set("paymentChannel", "GCash");
    return fd;
  }

  // ---- step actions -------------------------------------------------------

  it("markStepDone refuses on a Complete filing and works on an in-progress one", async () => {
    const c = await fresh(true);
    const refused = await markStepDone((await step(c.filing.id, "RECEIVE_2307")).id);
    expect(refused).toEqual({ ok: false, error: FILING_LOCKED_MESSAGE });

    const p = await fresh(false);
    const ok = await markStepDone((await step(p.filing.id, "RECEIVE_2307")).id);
    expect(ok.ok).toBe(true);
  });

  it("markStepInProgress refuses on a Complete filing and works on an in-progress one", async () => {
    const c = await fresh(true);
    expect(await markStepInProgress((await step(c.filing.id, "RECEIVE_2307")).id)).toEqual({ ok: false, error: FILING_LOCKED_MESSAGE });

    const p = await fresh(false);
    expect((await markStepInProgress((await step(p.filing.id, "RECEIVE_2307")).id)).ok).toBe(true);
  });

  it("markStepWaitingExternal refuses on a Complete filing and works on an in-progress one", async () => {
    const c = await fresh(true);
    expect(await markStepWaitingExternal((await step(c.filing.id, "RECEIVE_2307")).id)).toEqual({ ok: false, error: FILING_LOCKED_MESSAGE });

    const p = await fresh(false);
    await prisma.workflowStep.updateMany({ where: { filingId: p.filing.id, stepCode: "RECEIVE_2307" }, data: { status: "PENDING" } });
    expect((await markStepWaitingExternal((await step(p.filing.id, "RECEIVE_2307")).id)).ok).toBe(true);
  });

  it("logFollowUp refuses on a Complete filing and works on an in-progress one", async () => {
    const c = await fresh(true);
    await prisma.workflowStep.updateMany({ where: { filingId: c.filing.id, stepCode: "RECEIVE_2307" }, data: { status: "WAITING_EXTERNAL" } });
    expect(await logFollowUp((await step(c.filing.id, "RECEIVE_2307")).id)).toEqual({ ok: false, error: FILING_LOCKED_MESSAGE });

    const p = await fresh(false); // step 2 starts Waiting on client (D152)
    expect((await logFollowUp((await step(p.filing.id, "RECEIVE_2307")).id)).ok).toBe(true);
  });

  it("skipStep refuses on a Complete filing and works on an in-progress one", async () => {
    const c = await fresh(true);
    expect(await skipStep((await step(c.filing.id, "RECEIVE_2307")).id, "none")).toEqual({ ok: false, error: FILING_LOCKED_MESSAGE });
    expect((await step(c.filing.id, "RECEIVE_2307")).status).toBe("DONE");

    const p = await fresh(false);
    expect((await skipStep((await step(p.filing.id, "RECEIVE_2307")).id, "none")).ok).toBe(true);
  });

  it("unskipStep (Undo skip) refuses on a Complete filing and works on an in-progress one", async () => {
    const c = await fresh(true, { step2Skipped: true });
    expect(await unskipStep((await step(c.filing.id, "RECEIVE_2307")).id)).toEqual({ ok: false, error: FILING_LOCKED_MESSAGE });
    expect((await step(c.filing.id, "RECEIVE_2307")).status).toBe("SKIPPED");

    const p = await fresh(false);
    const s2 = await step(p.filing.id, "RECEIVE_2307");
    await skipStep(s2.id, "none");
    expect((await unskipStep(s2.id)).ok).toBe(true);
    expect((await step(p.filing.id, "RECEIVE_2307")).status).toBe("WAITING_EXTERNAL");
  });

  it("the internal re-derivations leave a Complete filing's steps alone, and still work on an in-progress one", async () => {
    const c = await fresh(true, { step2Skipped: true });
    await reopenSkippedReceive2307(c.filing.id, "someone", "test");
    await reopenPreparedFiling(c.filing.id);
    await recomputeReceive2307Status(c.filing.id);
    await recomputeFileGroupDocStepStatus((await step(c.filing.id, "SAVE_SUBMISSION_SS")).id);
    expect((await step(c.filing.id, "RECEIVE_2307")).status).toBe("SKIPPED");
    expect((await step(c.filing.id, "SAVE_SUBMISSION_SS")).status).toBe("DONE"); // no file, yet it is not reverted

    const p = await fresh(false);
    await skipStep((await step(p.filing.id, "RECEIVE_2307")).id, "none");
    const actor = (await prisma.user.findFirstOrThrow()).id;
    await reopenSkippedReceive2307(p.filing.id, actor, "test");
    expect((await step(p.filing.id, "RECEIVE_2307")).status).toBe("WAITING_EXTERNAL");
  });

  // ---- documents ----------------------------------------------------------

  it("uploadDocument refuses on a Complete filing and works on an in-progress one", async () => {
    const c = await fresh(true);
    const refused = await uploadDocument(uploadForm((await step(c.filing.id, "SAVE_SUBMISSION_SS")).id, "submission_screenshot"));
    expect(refused).toEqual({ ok: false, error: FILING_LOCKED_MESSAGE });
    expect(await prisma.document.count({ where: { filingId: c.filing.id } })).toBe(0);

    const p = await fresh(false);
    await openFileGroup(p.filing.id);
    await prisma.workflowStep.updateMany({ where: { filingId: p.filing.id, stepCode: "SAVE_SUBMISSION_SS" }, data: { status: "PENDING" } });
    const slot = JSON.parse((await step(p.filing.id, "SAVE_SUBMISSION_SS")).requiredDocSlots as string)[0].slotCode as string;
    const ok = await uploadDocument(uploadForm((await step(p.filing.id, "SAVE_SUBMISSION_SS")).id, slot));
    expect(ok.ok, ok.error).toBe(true);
  });

  it("deleteDocument refuses on a Complete filing and works on an in-progress one", async () => {
    const c = await fresh(true);
    const s = await step(c.filing.id, "SAVE_SUBMISSION_SS");
    const doc = await prisma.document.create({
      data: {
        clientId: c.client.id,
        filingId: c.filing.id,
        workflowStepId: s.id,
        docSlotCode: "submission_screenshot",
        category: "OTHER",
        originalFilename: "kept.pdf",
        storedPath: "nowhere/kept.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        sha256: "a".repeat(64),
        documentDate: new Date(),
        actorId: (await prisma.user.findFirstOrThrow()).id,
      },
    });
    await expect(deleteDocument(doc.id, "oops")).rejects.toThrow(FILING_LOCKED_MESSAGE);
    await expect(deleteDocument(doc.id, "oops")).rejects.toBeInstanceOf(FilingLockedError);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).deletedAt).toBeNull();

    const p = await fresh(false);
    const ps = await step(p.filing.id, "RECEIVE_2307");
    const pdoc = await prisma.document.create({
      data: {
        clientId: p.client.id,
        filingId: p.filing.id,
        workflowStepId: ps.id,
        docSlotCode: "form2307_scan",
        category: "OTHER",
        originalFilename: "gone.pdf",
        storedPath: "nowhere/gone.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        sha256: "b".repeat(64),
        documentDate: new Date(),
        actorId: (await prisma.user.findFirstOrThrow()).id,
      },
    });
    await deleteDocument(pdoc.id, "removed");
    expect((await prisma.document.findUniqueOrThrow({ where: { id: pdoc.id } })).deletedAt).not.toBeNull();
  });

  // ---- certificates -------------------------------------------------------

  it("addCertificate refuses on a Complete filing and works on an in-progress one", async () => {
    const c = await fresh(true);
    const refused = await addCertificate(c.filing.id, {} as CertificateFormState, certFormData());
    expect(refused.error).toBe(FILING_LOCKED_MESSAGE);
    expect(refused.saved).toBeUndefined();
    expect(await prisma.form2307.count({ where: { clientId: c.client.id } })).toBe(0);

    const p = await fresh(false);
    expect((await addCertificate(p.filing.id, {} as CertificateFormState, certFormData())).saved).toBe(true);
  });

  it("deleteCertificate refuses on a Complete filing and works on an in-progress one", async () => {
    const mk = (clientId: string, filingId: string) =>
      prisma.form2307.create({
        data: {
          clientId,
          taxableYear: 2026,
          payorName: "P",
          payorTin: "111222333",
          periodFrom: new Date("2026-04-01T00:00:00.000Z"),
          periodTo: new Date("2026-06-30T00:00:00.000Z"),
          quarterCovered: 2,
          atcCode: "WI010",
          incomePaymentCents: 1_000_00,
          taxWithheldCents: 50_00,
          withholdingRateBps: 500,
          status: "RECORDED",
          claimedOnFilingId: filingId,
        },
      });
    const c = await fresh(true);
    const cert = await mk(c.client.id, c.filing.id);
    expect(await deleteCertificate(cert.id, "x")).toEqual({ ok: false, error: FILING_LOCKED_MESSAGE });
    expect((await prisma.form2307.findUniqueOrThrow({ where: { id: cert.id } })).deletedAt).toBeNull();

    const p = await fresh(false);
    const pcert = await mk(p.client.id, p.filing.id);
    expect((await deleteCertificate(pcert.id, "x")).ok).toBe(true);
  });

  it("setAllCertificatesReceived refuses on a Complete filing and works on an in-progress one", async () => {
    const c = await fresh(true);
    await expect(setAllCertificatesReceived(c.filing.id, true)).rejects.toThrow(FILING_LOCKED_MESSAGE);
    expect((await prisma.filing.findUniqueOrThrow({ where: { id: c.filing.id } })).certificatesAllReceivedAt).toBeNull();

    const p = await fresh(false);
    await setAllCertificatesReceived(p.filing.id, true);
    expect((await prisma.filing.findUniqueOrThrow({ where: { id: p.filing.id } })).certificatesAllReceivedAt).not.toBeNull();
  });

  // ---- the filing's own figures ------------------------------------------

  it("dismissCompletenessNote refuses on a Complete filing and works on an in-progress one", async () => {
    const c = await fresh(true);
    await expect(dismissCompletenessNote(c.filing.id)).rejects.toThrow(FILING_LOCKED_MESSAGE);
    expect((await prisma.filing.findUniqueOrThrow({ where: { id: c.filing.id } })).completenessNoteDismissedAt).toBeNull();

    const p = await fresh(false);
    await dismissCompletenessNote(p.filing.id);
    expect((await prisma.filing.findUniqueOrThrow({ where: { id: p.filing.id } })).completenessNoteDismissedAt).not.toBeNull();
  });

  it("updateFilingOtherCredits refuses on a Complete filing and works on an in-progress one", async () => {
    const c = await fresh(true);
    const refused = await updateFilingOtherCredits(c.filing.id, {}, creditsForm());
    expect(refused.error).toBe(FILING_LOCKED_MESSAGE);
    expect((await prisma.filing.findUniqueOrThrow({ where: { id: c.filing.id } })).otherCreditsCents).toBeNull();

    const p = await fresh(false);
    expect((await updateFilingOtherCredits(p.filing.id, {}, creditsForm())).saved).toBe(true);
  });

  it("savePayment refuses on a Complete filing (even where D75/D94 would allow an edit) and works on an in-progress one", async () => {
    const c = await fresh(true);
    // Nothing later has filed, so isPaymentLocked is false — before D153 this edit was allowed.
    const refused = await savePayment(c.filing.id, {}, paymentForm());
    expect(refused.error).toBe(FILING_LOCKED_MESSAGE);
    expect((await prisma.filing.findUniqueOrThrow({ where: { id: c.filing.id } })).amountPaidCents).toBeNull();

    const p = await fresh(false);
    await openFileGroup(p.filing.id);
    const ok = await savePayment(p.filing.id, {}, paymentForm());
    expect(ok.saved, ok.error).toBe(true);
  });
});
