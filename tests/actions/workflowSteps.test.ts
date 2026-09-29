import { describe, it, expect, afterAll, vi } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { generateFilingsForClientYear, recomputeRequiresSawt } from "@/lib/workflow/filingGeneration";
import { uploadDocument, deleteDocument } from "@/lib/actions/documents";
import {
  markStepDone,
  markStepInProgress,
  markStepWaitingExternal,
  skipStep,
  unskipStep,
  logFollowUp,
} from "@/lib/actions/workflowSteps";
import { summarizeGroup, WORKFLOW_GROUPS, FILE_GROUP_NO_START_NO_SKIP, type GroupStepInput } from "@/lib/workflow/groups";
import { checkSendClientPackageReadiness } from "@/lib/workflow/docSlots";
import { computeFilingCompleteness } from "@/lib/workflow/completeness";
import { parseDocSlots } from "@/lib/workflow/types";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("workflow step actions", () => {
  const createdClientIds: string[] = [];
  const clientCodes: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.document.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.form2307.deleteMany({ where: { clientId: { in: createdClientIds } } });
    // D75 (brief #5m §3) -- seedPayableQ2Sales (this file's own new
    // helper) creates QuarterlySales rows, which the previous cleanup
    // never needed to touch.
    await prisma.quarterlySales.deleteMany({ where: { clientId: { in: createdClientIds } } });
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
        registeredName: "Workflow Steps Test Client",
        tin: "999000111",
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
    return { client, filing };
  }

  /**
   * D76 (brief #5m §3.4) -- a client with NO declared sales at all
   * computes zero tax payable, which now auto-NA's steps 8/9 the moment
   * FILE_RETURN is marked Done. Most of the Pay-group tests below are
   * about a PAYABLE return, so they seed a real Q2 gross figure first
   * (safely above the ₱250,000 deduction) to land in the ordinary
   * PENDING path instead.
   */
  async function seedPayableQ2Sales(clientId: string) {
    // ₱500,000 -- safely above the ₱250,000 deduction, so tax payable is
    // genuinely > 0 (100_000_00 alone, ₱100,000, computes to exactly ₱0
    // payable after the deduction -- still "nothing to pay").
    await prisma.quarterlySales.create({
      data: { clientId, taxableYear: 2026, quarter: "Q2", grossSalesCents: 500_000_00, finalizedAt: new Date() },
    });
  }

  /**
   * D75 (brief #5m §3.1) -- Pay (steps 8, 9) opens only once ALL of File
   * (steps 5, 6, 7) is Done, not just step 5. Marks step 5 done and
   * uploads steps 6/7's own documents (self-completing, D67) so callers
   * can then reach step 8/9 in tests that aren't themselves about File.
   */
  async function fileTheReturn(filingId: string) {
    const fileReturnStep = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId, stepCode: "FILE_RETURN" },
    });
    await markStepDone(fileReturnStep.id);
    for (const [stepCode, slotCode] of [
      ["SAVE_SUBMISSION_SS", "submission_screenshot"],
      ["SAVE_FORM_COPY", "filed_form"],
    ] as const) {
      const step = await prisma.workflowStep.findFirstOrThrow({ where: { filingId, stepCode } });
      const fd = new FormData();
      fd.set("file", new File(["bytes"], `${stepCode}.pdf`, { type: "application/pdf" }));
      fd.set("workflowStepId", step.id);
      fd.set("docSlotCode", slotCode);
      fd.set("documentDate", "2026-08-15");
      await uploadDocument(fd);
    }
  }

  /**
   * D27 (reconciled from laughing-darwin's commit 7bfbd5d) — the
   * corrected blocking rule: markStepDone is blocked while a required doc
   * slot is empty, and succeeds once filled. Q2 is used here (not Q1) so
   * this isn't also exercising the election hard-blocker, a separate
   * exception.
   */
  it("markStepDone is blocked while a required doc slot is empty, succeeds once filled", async () => {
    const { client, filing } = await makeClientWithQ2Filing("p3-step-done");
    await seedPayableQ2Sales(client.id);
    // D75 (brief #5m §3) -- SAVE_PROOF_PAYMENT (Pay group) now also needs
    // File done and step 8 (MAKE_PAYMENT) done before it even unlocks.
    // This test is about the generic doc-slot blocking rule (D27) itself,
    // once reachable.
    await fileTheReturn(filing.id);
    const makePaymentStep = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "MAKE_PAYMENT" },
    });
    expect((await markStepDone(makePaymentStep.id)).ok).toBe(true);

    const step = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "SAVE_PROOF_PAYMENT" },
    });

    const blocked = await markStepDone(step.id);
    expect(blocked.ok).toBe(false);

    const formData = new FormData();
    formData.set("file", new File(["proof-bytes"], "proof.pdf", { type: "application/pdf" }));
    formData.set("workflowStepId", step.id);
    formData.set("docSlotCode", "proof");
    formData.set("documentDate", "2026-08-15");
    await uploadDocument(formData);

    const allowed = await markStepDone(step.id);
    expect(allowed.ok).toBe(true);

    const updated = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step.id } });
    expect(updated.status).toBe("DONE");
    expect(updated.completedAt).not.toBeNull();
  });

  it("SEND_CLIENT_PACKAGE names the specific missing document from steps 7/9/10/14", async () => {
    const { filing } = await makeClientWithQ2Filing("p3-step-package");
    const sendPackageStep = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "SEND_CLIENT_PACKAGE" },
    });

    const result = await markStepDone(sendPackageStep.id);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("step 7");
  });

  it("D68: marking FILE_RETURN done moves step 10 to WAITING_EXTERNAL automatically, flipping the filing status to WAITING_BIR", async () => {
    // Q3 (adjusted due Nov 16, 2026) — not yet past due relative to "now"
    // when this suite runs, unlike Q2 (due Aug 17), so BLOCKED doesn't
    // pre-empt WAITING_BIR here (BLOCKED correctly takes priority when a
    // filing genuinely is overdue — see lib/workflow/status.ts).
    const { client } = await makeClientWithQ2Filing("p3-step-waitbir");
    const filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q3" } },
    });
    const fileReturnStep = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "FILE_RETURN" },
    });
    const trrcStep = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "RECEIVE_TRRC" },
    });
    const submissionStep = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "SAVE_SUBMISSION_SS" },
    });
    const formCopyStep = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "SAVE_FORM_COPY" },
    });
    expect(trrcStep.status).toBe("PENDING");

    const result = await markStepDone(fileReturnStep.id);
    expect(result.ok).toBe(true);

    const updatedTrrc = await prisma.workflowStep.findUniqueOrThrow({ where: { id: trrcStep.id } });
    expect(updatedTrrc.status).toBe("WAITING_EXTERNAL");
    expect(updatedTrrc.waitingSince).not.toBeNull();

    // Steps 6 and 7 unlock (D67) but don't wait on anyone -- they stay Pending.
    const updatedSubmission = await prisma.workflowStep.findUniqueOrThrow({ where: { id: submissionStep.id } });
    const updatedFormCopy = await prisma.workflowStep.findUniqueOrThrow({ where: { id: formCopyStep.id } });
    expect(updatedSubmission.status).toBe("PENDING");
    expect(updatedFormCopy.status).toBe("PENDING");

    const updatedFiling = await prisma.filing.findUniqueOrThrow({ where: { id: filing.id } });
    expect(updatedFiling.status).toBe("WAITING_BIR");

    // D72 (brief #5m §2) -- no Log follow-up on any BIR wait, including
    // step 10; refused here, not just missing from the UI.
    const followUp = await logFollowUp(trrcStep.id);
    expect(followUp.ok).toBe(false);
    const updatedStep = await prisma.workflowStep.findUniqueOrThrow({ where: { id: trrcStep.id } });
    expect(updatedStep.followUpCount).toBe(0);
  });

  describe("D72 (brief #5m §2): Log follow-up is refused on every BIR wait", () => {
    it("refuses RECEIVE_TRRC, SAWT_ACK and SAWT_VALIDATION even when genuinely WAITING_EXTERNAL", async () => {
      const { filing } = await makeClientWithQ2Filing("p5m-no-followup-bir");
      for (const stepCode of ["RECEIVE_TRRC", "SAWT_ACK", "SAWT_VALIDATION"]) {
        const step = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode } });
        await prisma.workflowStep.update({ where: { id: step.id }, data: { status: "WAITING_EXTERNAL", waitingSince: new Date() } });
        const result = await logFollowUp(step.id);
        expect(result.ok).toBe(false);
      }
    });

    it("a Client wait (e.g. RECORD_SALES) is unaffected -- Log follow-up still works there", async () => {
      const { filing } = await makeClientWithQ2Filing("p5m-followup-client-ok");
      const step = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECORD_SALES" } });
      expect(step.status).toBe("WAITING_EXTERNAL");
      const result = await logFollowUp(step.id);
      expect(result.ok).toBe(true);
    });
  });

  it("skipStep requires a non-empty reason — no silent skips (SPEC.md 7.2)", async () => {
    const { filing } = await makeClientWithQ2Filing("p3-step-skip");
    // D75 (brief #5m §3) -- MAKE_PAYMENT can no longer be skipped at all
    // (see the dedicated Pay-group test below); EAFS_SUBMIT is still an
    // ordinary skippable step, so it's used here for the generic
    // reason-required rule.
    const step = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "EAFS_SUBMIT" },
    });

    const blocked = await skipStep(step.id, "");
    expect(blocked.ok).toBe(false);

    const allowed = await skipStep(step.id, "Client remitted directly, no separate payment step needed.");
    expect(allowed.ok).toBe(true);
    const updated = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step.id } });
    expect(updated.status).toBe("SKIPPED");
    expect(updated.skippedReason).toBeTruthy();
  });

  it("brief #5f §1: step 3 (PREPARE_RETURN) can never be skipped, even with a reason, enforced server-side", async () => {
    const { filing } = await makeClientWithQ2Filing("p3-step3-noskip");
    const step3 = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "PREPARE_RETURN" },
    });

    const blocked = await skipStep(step3.id, "Trying to skip anyway.");
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/can't be skipped/i);

    const unchanged = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step3.id } });
    expect(unchanged.status).not.toBe("SKIPPED");
  });

  it("§9.4/§5.4: marking PREPARE_RETURN done saves the app's own computation sheet into the vault, with no upload", async () => {
    const { filing } = await makeClientWithQ2Filing("p3-step-compsheet");

    // Brief #4c -- step 3 requires steps 1/2 resolved first.
    const recordSalesStep = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "RECORD_SALES" },
    });
    await markStepDone(recordSalesStep.id);
    await skipStep(
      (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECEIVE_2307" } })).id,
      "No 2307s expected this quarter.",
    );

    const step = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "PREPARE_RETURN" },
    });

    const result = await markStepDone(step.id);
    expect(result.ok).toBe(true);

    const saved = await prisma.document.findFirst({
      where: { workflowStepId: step.id, docSlotCode: "draft_computation", deletedAt: null },
    });
    expect(saved).not.toBeNull();
    expect(saved?.mimeType).toBe("text/html");
  });

  describe("D27 reconciliation: the corrected blocking rule", () => {
    it("step 1 is Record quarterly sales (no doc slot) and step 2 is Receive Form 2307 from client (optional slot)", async () => {
      const step1 = await prisma.workflowStepTemplate.findUniqueOrThrow({ where: { stepCode: "RECORD_SALES" } });
      expect(step1.sequence).toBe(1);
      expect(step1.title).toBe("Record quarterly sales");
      expect(parseDocSlots(step1.requiredDocSlots)).toEqual([]);

      const step2 = await prisma.workflowStepTemplate.findUniqueOrThrow({ where: { stepCode: "RECEIVE_2307" } });
      expect(step2.sequence).toBe(2);
      expect(parseDocSlots(step2.requiredDocSlots).every((s) => !s.required)).toBe(true);
    });

    it("steps 4, 12, and 16 have no doc slots at all; step 15's slot is optional", async () => {
      for (const stepCode of ["ADVISE_CLIENT", "EMAIL_DAT", "SEND_CLIENT_PACKAGE"]) {
        const template = await prisma.workflowStepTemplate.findUniqueOrThrow({ where: { stepCode } });
        expect(parseDocSlots(template.requiredDocSlots)).toEqual([]);
      }

      const eafs = await prisma.workflowStepTemplate.findUniqueOrThrow({ where: { stepCode: "EAFS_SUBMIT" } });
      const eafsSlots = parseDocSlots(eafs.requiredDocSlots);
      expect(eafsSlots.length).toBeGreaterThan(0);
      expect(eafsSlots.every((s) => !s.required)).toBe(true);
    });

    it("the seven blocking steps (6,7,9,10,11,13,14) still require their documents", async () => {
      const blockingSteps: Record<string, number> = {
        SAVE_SUBMISSION_SS: 1,
        SAVE_FORM_COPY: 1,
        SAVE_PROOF_PAYMENT: 1,
        RECEIVE_TRRC: 1,
        ALPHALIST_ENTRY: 2,
        SAWT_ACK: 1,
        SAWT_VALIDATION: 1,
      };
      for (const [stepCode, expectedRequired] of Object.entries(blockingSteps)) {
        const template = await prisma.workflowStepTemplate.findUniqueOrThrow({ where: { stepCode } });
        const slots = parseDocSlots(template.requiredDocSlots);
        expect(slots.filter((s) => s.required)).toHaveLength(expectedRequired);
      }
    });

    it("non-blocking steps mark DONE freely, with or without their optional slot", async () => {
      const { filing } = await makeClientWithQ2Filing("p3-nonblocking");

      // RECORD_SALES and RECEIVE_2307 resolved first -- brief #4c requires
      // both before PREPARE_RETURN (step 3) can be marked done, same as
      // Prepare's own group-level "Mark done". PREPARE_RETURN must in turn
      // precede ADVISE_CLIENT (brief #5e §1).
      for (const stepCode of ["RECORD_SALES", "RECEIVE_2307", "PREPARE_RETURN", "ADVISE_CLIENT"]) {
        const step = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode } });
        const result = await markStepDone(step.id);
        expect(result.ok).toBe(true);
      }
      // D75 (brief #5m §3) -- MAKE_PAYMENT now also needs File (5, 6, 7)
      // Done first.
      await fileTheReturn(filing.id);
      const makePaymentStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "MAKE_PAYMENT" },
      });
      expect((await markStepDone(makePaymentStep.id)).ok).toBe(true);

      // EAFS_SUBMIT's confirmation is the one documented exception:
      // optional, never demanded, never blocking.
      const eafs = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "EAFS_SUBMIT" },
      });
      expect((await markStepDone(eafs.id)).ok).toBe(true);
    });

    it("D71 (brief #5m §2): step 14 is locked until step 13 is Done, then waits on BIR automatically and completes on upload -- the 13->14 dependency now enforced by the lock itself", async () => {
      const { client, filing } = await makeClientWithQ2Filing("p3-sawt-dependency");
      await prisma.form2307.create({
        data: {
          clientId: client.id,
          taxableYear: 2026,
          payorName: "Dependency Test Payor",
          payorTin: "111222333",
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

      const ackStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "SAWT_ACK" },
      });
      const validationStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "SAWT_VALIDATION" },
      });
      expect(validationStep.status).toBe("PENDING");

      // Locked while step 13 isn't Done -- the upload itself is refused,
      // not just markStepDone (D71, the same shape D67 gave steps 6/7).
      const formData = new FormData();
      formData.set("file", new File(["validation-bytes"], "validation.pdf", { type: "application/pdf" }));
      formData.set("workflowStepId", validationStep.id);
      formData.set("docSlotCode", "validation_email");
      formData.set("documentDate", "2026-08-15");
      const stillLocked = await uploadDocument(formData);
      expect(stillLocked.ok).toBe(false);
      expect(stillLocked.error).toMatch(/step 13/i);

      await markStepWaitingExternal(ackStep.id); // step 13 waiting, not done -- still locked
      const stillLockedWhileWaiting = await uploadDocument(formData);
      expect(stillLockedWhileWaiting.ok).toBe(false);

      // Resolve step 13 -- step 14 should auto-transition to
      // WAITING_EXTERNAL by itself, no manual Mark waiting involved.
      const ackFormData = new FormData();
      ackFormData.set("file", new File(["ack"], "ack.pdf", { type: "application/pdf" }));
      ackFormData.set("workflowStepId", ackStep.id);
      ackFormData.set("docSlotCode", "acknowledgement");
      ackFormData.set("documentDate", "2026-08-15");
      await uploadDocument(ackFormData);
      const ackDone = await markStepDone(ackStep.id);
      expect(ackDone.ok).toBe(true);

      const nowWaiting = await prisma.workflowStep.findUniqueOrThrow({ where: { id: validationStep.id } });
      expect(nowWaiting.status).toBe("WAITING_EXTERNAL");
      expect(nowWaiting.waitingSince).not.toBeNull();

      // Step 10 (RECEIVE_TRRC) waiting blocks nothing downstream -- filing
      // the return (which now auto-starts step 10 waiting on BIR, D68) has
      // no effect on step 14.
      await fileTheReturn(filing.id);
      const trrcStep = await prisma.workflowStep.findUniqueOrThrow({ where: { id: (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECEIVE_TRRC" } })).id } });
      expect(trrcStep.status).toBe("WAITING_EXTERNAL");

      const nowAllowed = await uploadDocument(formData);
      expect(nowAllowed.ok).toBe(true);
      const done = await prisma.workflowStep.findUniqueOrThrow({ where: { id: validationStep.id } });
      expect(done.status).toBe("DONE");
    });

    it("D29 (unaffected by D70/D71): the 13->14 dependency check inside markStepDone itself still refuses a direct call while step 13 isn't Done", async () => {
      // Exercises the legacy stepCode-based check directly (not reachable
      // via the normal UI any more, since step 14 is self-completing) --
      // proving it's genuinely unaffected by the group restructuring, per
      // the brief's own instruction.
      const { client, filing } = await makeClientWithQ2Filing("p3-sawt-dependency-direct");
      // SAWT_ACK/SAWT_VALIDATION are NA (not PENDING) for a client with no
      // certificates -- a real one is needed so the dependency check
      // itself (not the NA short-circuit) is what's under test.
      await prisma.form2307.create({
        data: {
          clientId: client.id,
          taxableYear: 2026,
          payorName: "Direct Dependency Test Payor",
          payorTin: "222333444",
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
      const ackStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "SAWT_ACK" },
      });
      const validationStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "SAWT_VALIDATION" },
      });
      // Force step 14 into a state markStepDone would otherwise accept,
      // bypassing D71's own lock, to isolate the D29 check specifically.
      await prisma.workflowStep.update({ where: { id: validationStep.id }, data: { status: "WAITING_EXTERNAL" } });
      const formData = new FormData();
      formData.set("file", new File(["validation-bytes"], "validation.pdf", { type: "application/pdf" }));
      formData.set("workflowStepId", validationStep.id);
      formData.set("docSlotCode", "validation_email");
      formData.set("documentDate", "2026-08-15");
      await prisma.document.create({
        data: {
          clientId: filing.clientId,
          filingId: filing.id,
          workflowStepId: validationStep.id,
          docSlotCode: "validation_email",
          category: "VALIDATION_EMAIL",
          originalFilename: "validation.pdf",
          storedPath: "test/validation.pdf",
          mimeType: "application/pdf",
          sizeBytes: 10,
          sha256: "0".repeat(64),
          documentDate: new Date("2026-08-15T00:00:00.000Z"),
        },
      });

      const stillBlocked = await markStepDone(validationStep.id);
      expect(stillBlocked.ok).toBe(false);
      expect(stillBlocked.error).toMatch(/acknowledgement/i);

      const ackFormData = new FormData();
      ackFormData.set("file", new File(["ack"], "ack.pdf", { type: "application/pdf" }));
      ackFormData.set("workflowStepId", ackStep.id);
      ackFormData.set("docSlotCode", "acknowledgement");
      ackFormData.set("documentDate", "2026-08-15");
      await uploadDocument(ackFormData);
      await markStepDone(ackStep.id);

      const nowAllowed = await markStepDone(validationStep.id);
      expect(nowAllowed.ok).toBe(true);
    });
  });

  describe("brief #4c: step 3's own markStepDone enforces steps 1/2 resolved (fixes a bypass of the group-level block)", () => {
    it("markStepDone on PREPARE_RETURN directly is blocked while step 1 and step 2 are unresolved", async () => {
      const { filing } = await makeClientWithQ2Filing("p4c-step3-direct-blocked");

      const prepareReturnStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "PREPARE_RETURN" },
      });

      const blocked = await markStepDone(prepareReturnStep.id);
      expect(blocked.ok).toBe(false);
      expect(blocked.error).toMatch(/quarterly sales/i);

      const stillPending = await prisma.workflowStep.findUniqueOrThrow({ where: { id: prepareReturnStep.id } });
      expect(stillPending.status).not.toBe("DONE");
    });

    it("unblocks once step 1 is DONE and step 2 is DONE or SKIPPED, and step 4 is never gated by this rule", async () => {
      const { filing } = await makeClientWithQ2Filing("p4c-step3-direct-unblocked");

      const recordSalesStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "RECORD_SALES" },
      });
      await markStepDone(recordSalesStep.id);

      // Step 3 is still blocked on step 2 alone.
      const prepareReturnStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "PREPARE_RETURN" },
      });
      const stillBlocked = await markStepDone(prepareReturnStep.id);
      expect(stillBlocked.ok).toBe(false);
      expect(stillBlocked.error).not.toMatch(/quarterly sales/i);
      expect(stillBlocked.error).toMatch(/2307/i);

      await skipStep(
        (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECEIVE_2307" } })).id,
        "No 2307s expected this quarter.",
      );

      const nowAllowed = await markStepDone(prepareReturnStep.id);
      expect(nowAllowed.ok).toBe(true);

      // Brief #5e §1 -- step 4 (ADVISE_CLIENT) is now blocked until step 3
      // is Done (superseding brief #4c's "step 4 is never gated" note,
      // which was itself the bug brief #5e §1 fixes). Here step 3 is
      // already Done (above), so step 4 succeeds.
      const step4Result = await markStepDone(
        (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "ADVISE_CLIENT" } })).id,
      );
      expect(step4Result.ok).toBe(true);
    });
  });

  describe("brief #5e §1: step 4 (ADVISE_CLIENT) requires step 3 (PREPARE_RETURN) to be Done first", () => {
    it("regression: markStepDone on ADVISE_CLIENT directly is blocked while step 3 is still open, even with steps 1/2 resolved", async () => {
      const { filing } = await makeClientWithQ2Filing("p5e-step4-gate-blocked");

      // Resolve steps 1 and 2 so Prepare's own gate (brief #4c) isn't what's
      // blocking this -- step 3 itself is deliberately left PENDING.
      await markStepDone(
        (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECORD_SALES" } })).id,
      );
      await skipStep(
        (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECEIVE_2307" } })).id,
        "No 2307s expected this quarter.",
      );

      const adviseStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "ADVISE_CLIENT" },
      });
      const blocked = await markStepDone(adviseStep.id);
      expect(blocked.ok).toBe(false);
      expect(blocked.error).toMatch(/step 3|prepared/i);

      const stillPending = await prisma.workflowStep.findUniqueOrThrow({ where: { id: adviseStep.id } });
      expect(stillPending.status).not.toBe("DONE");
    });

    it("unblocks once step 3 is Done", async () => {
      const { filing } = await makeClientWithQ2Filing("p5e-step4-gate-unblocked");

      await markStepDone(
        (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECORD_SALES" } })).id,
      );
      await skipStep(
        (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECEIVE_2307" } })).id,
        "No 2307s expected this quarter.",
      );
      await markStepDone(
        (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "PREPARE_RETURN" } })).id,
      );

      const adviseStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "ADVISE_CLIENT" },
      });
      const allowed = await markStepDone(adviseStep.id);
      expect(allowed.ok).toBe(true);
    });

    it("resolving steps 3 and 4 one at a time (no group action) never bypasses the gate", async () => {
      const { filing } = await makeClientWithQ2Filing("p5e-step4-gate-group");

      await markStepDone(
        (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECORD_SALES" } })).id,
      );
      await skipStep(
        (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECEIVE_2307" } })).id,
        "No 2307s expected this quarter.",
      );

      const step3Id = (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "PREPARE_RETURN" } })).id;
      const step4Id = (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "ADVISE_CLIENT" } })).id;
      expect((await markStepDone(step3Id)).ok).toBe(true);
      expect((await markStepDone(step4Id)).ok).toBe(true);

      const step3 = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step3Id } });
      const step4 = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step4Id } });
      expect(step3.status).toBe("DONE");
      expect(step4.status).toBe("DONE");
    });
  });

  describe("brief #5d §7: step 4 (ADVISE_CLIENT) is no longer a waiting step", () => {
    it("markStepWaitingExternal is refused server-side for step 4", async () => {
      const { filing } = await makeClientWithQ2Filing("p5d-step4-no-waiting");
      const adviseStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "ADVISE_CLIENT" },
      });
      expect(adviseStep.isWaitingState).toBe(false);

      const result = await markStepWaitingExternal(adviseStep.id);
      expect(result.ok).toBe(false);

      const unchanged = await prisma.workflowStep.findUniqueOrThrow({ where: { id: adviseStep.id } });
      expect(unchanged.status).not.toBe("WAITING_EXTERNAL");
    });
  });

  describe("brief #5i §3: markGroupDone is gone -- per-step actions alone resolve a group", () => {
    it("markGroupDone no longer exists as an export", async () => {
      const mod = await import("@/lib/actions/workflowSteps");
      expect((mod as Record<string, unknown>).markGroupDone).toBeUndefined();
    });

    it("marking the last unresolved step in a group resolves the group (Pay: 2 steps)", async () => {
      const { client, filing } = await makeClientWithQ2Filing("p5i-group-per-step-pay");
      await seedPayableQ2Sales(client.id);
      // D75 (brief #5m §3) -- Pay now opens only once File is Done.
      await fileTheReturn(filing.id);

      const makePaymentStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "MAKE_PAYMENT" },
      });
      expect((await markStepDone(makePaymentStep.id)).ok).toBe(true);

      const pay = WORKFLOW_GROUPS.find((g) => g.code === "PAY")!;
      const stepsBeforeLast: GroupStepInput[] = [
        { stepCode: "MAKE_PAYMENT", status: "DONE" },
        { stepCode: "SAVE_PROOF_PAYMENT", status: "PENDING" },
      ];
      expect(summarizeGroup(pay, stepsBeforeLast).isComplete).toBe(false);

      // The last unresolved step in the group -- self-completes on
      // upload (D75), no group-level action and no manual Mark done.
      const proofStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "SAVE_PROOF_PAYMENT" },
      });
      const formData = new FormData();
      formData.set("file", new File(["proof-bytes"], "proof.pdf", { type: "application/pdf" }));
      formData.set("workflowStepId", proofStep.id);
      formData.set("docSlotCode", "proof");
      formData.set("documentDate", "2026-08-15");
      expect((await uploadDocument(formData)).ok).toBe(true);

      const steps = await prisma.workflowStep.findMany({
        where: { filingId: filing.id, stepCode: { in: ["MAKE_PAYMENT", "SAVE_PROOF_PAYMENT"] } },
      });
      expect(steps.every((s) => s.status === "DONE")).toBe(true);
      const summary = summarizeGroup(
        pay,
        steps.map((s) => ({ stepCode: s.stepCode, status: s.status })),
      );
      expect(summary.isComplete).toBe(true);
    });

    it("Prepare resolves once steps 1-4 are each individually resolved, with step 2 skipped", async () => {
      const { filing } = await makeClientWithQ2Filing("p5i-group-prepare-per-step");

      const recordSalesStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "RECORD_SALES" },
      });
      await markStepDone(recordSalesStep.id);
      await skipStep(
        (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECEIVE_2307" } })).id,
        "No 2307s expected this quarter.",
      );
      await markStepDone(
        (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "PREPARE_RETURN" } })).id,
      );
      await markStepDone(
        (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "ADVISE_CLIENT" } })).id,
      );

      const steps = await prisma.workflowStep.findMany({
        where: { filingId: filing.id, stepCode: { in: ["RECORD_SALES", "RECEIVE_2307", "PREPARE_RETURN", "ADVISE_CLIENT"] } },
      });
      expect(steps.every((s) => s.status === "DONE" || s.status === "SKIPPED")).toBe(true);
    });
  });

  describe("brief #5i §1/§2: skipped steps stay visible, and undo-skip restores derived status", () => {
    it("unskipStep restores step 2 to Done when the checkbox and scans already make it so", async () => {
      const { client, filing } = await makeClientWithQ2Filing("p5i-unskip-receive2307-done");

      const cert = await prisma.form2307.create({
        data: {
          clientId: client.id,
          taxableYear: 2026,
          payorName: "Unskip Test Payor",
          payorTin: "111222333",
          periodFrom: new Date("2026-04-01T00:00:00.000Z"),
          periodTo: new Date("2026-06-30T00:00:00.000Z"),
          quarterCovered: 2,
          atcCode: "WI010",
          incomePaymentCents: 10_000_00,
          taxWithheldCents: 500_00,
          withholdingRateBps: 500,
          status: "RECORDED",
          claimedOnFilingId: filing.id,
        },
      });
      const receive2307Step = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "RECEIVE_2307" },
      });
      const formData = new FormData();
      formData.set("file", new File(["scan-bytes"], "scan.pdf", { type: "application/pdf" }));
      formData.set("workflowStepId", receive2307Step.id);
      formData.set("docSlotCode", "form2307_scan");
      formData.set("documentDate", "2026-08-15");
      formData.set("form2307Id", cert.id);
      await uploadDocument(formData);
      await prisma.filing.update({ where: { id: filing.id }, data: { certificatesAllReceivedAt: new Date() } });

      // Skip it by hand, then undo -- it should come back Done, not PENDING.
      await prisma.workflowStep.update({ where: { id: receive2307Step.id }, data: { status: "SKIPPED", skippedReason: "Entered in error." } });

      const result = await unskipStep(receive2307Step.id);
      expect(result.ok).toBe(true);

      const updated = await prisma.workflowStep.findUniqueOrThrow({ where: { id: receive2307Step.id } });
      expect(updated.status).toBe("DONE");
      expect(updated.skippedReason).toBeNull();
    });

    it("unskipStep restores step 2 to open (waiting on client) when nothing backs it", async () => {
      const { filing } = await makeClientWithQ2Filing("p5i-unskip-receive2307-open");
      const receive2307Step = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "RECEIVE_2307" },
      });
      await skipStep(receive2307Step.id, "No 2307s expected this quarter.");

      const result = await unskipStep(receive2307Step.id);
      expect(result.ok).toBe(true);

      const updated = await prisma.workflowStep.findUniqueOrThrow({ where: { id: receive2307Step.id } });
      expect(updated.status).toBe("WAITING_EXTERNAL");
      expect(updated.skippedReason).toBeNull();
    });

    it("unskipStep restores any other skippable step to PENDING", async () => {
      const { filing } = await makeClientWithQ2Filing("p5i-unskip-other-step");
      // D75 (brief #5m §3) -- MAKE_PAYMENT can no longer be skipped at
      // all; EAFS_SUBMIT is still an ordinary skippable step.
      const eafsStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "EAFS_SUBMIT" },
      });
      await skipStep(eafsStep.id, "Not required this quarter.");

      const result = await unskipStep(eafsStep.id);
      expect(result.ok).toBe(true);

      const updated = await prisma.workflowStep.findUniqueOrThrow({ where: { id: eafsStep.id } });
      expect(updated.status).toBe("PENDING");
      expect(updated.skippedReason).toBeNull();
    });

    it("unskipStep is refused once the filing's own step 5 (FILE_RETURN) is Done", async () => {
      const { filing } = await makeClientWithQ2Filing("p5i-unskip-locked");
      const receive2307Step = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "RECEIVE_2307" },
      });
      await skipStep(receive2307Step.id, "No 2307s expected this quarter.");
      await prisma.workflowStep.updateMany({
        where: { filingId: filing.id, stepCode: "FILE_RETURN" },
        data: { status: "DONE" },
      });

      const result = await unskipStep(receive2307Step.id);
      expect(result.ok).toBe(false);

      const unchanged = await prisma.workflowStep.findUniqueOrThrow({ where: { id: receive2307Step.id } });
      expect(unchanged.status).toBe("SKIPPED");
    });

    it("unskipping step 2 reopens steps 3/4 on an unfiled prepared filing (D50)", async () => {
      const { filing } = await makeClientWithQ2Filing("p5i-unskip-reopens");

      await markStepDone(
        (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECORD_SALES" } })).id,
      );
      const receive2307Step = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "RECEIVE_2307" },
      });
      await skipStep(receive2307Step.id, "No 2307s expected this quarter.");
      const step3Id = (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "PREPARE_RETURN" } })).id;
      const step4Id = (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "ADVISE_CLIENT" } })).id;
      await markStepDone(step3Id);
      await markStepDone(step4Id);

      await unskipStep(receive2307Step.id);

      const step3 = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step3Id } });
      const step4 = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step4Id } });
      expect(step3.status).toBe("PENDING");
      expect(step4.status).toBe("PENDING");
    });
  });

  describe("brief #5k: the File group's first walkthrough (steps 5, 6, 7, 10)", () => {
    it("D65: skipStep refuses all four File-group step codes, server-side", async () => {
      const { filing } = await makeClientWithQ2Filing("p5k-skip-refused");

      for (const stepCode of FILE_GROUP_NO_START_NO_SKIP) {
        const step = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode } });
        const result = await skipStep(step.id, "Trying to skip anyway.");
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/can't be skipped/i);
        const unchanged = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step.id } });
        expect(unchanged.status).not.toBe("SKIPPED");
      }
    });

    it("D65: markStepInProgress (Start) refuses all four File-group step codes, server-side", async () => {
      const { filing } = await makeClientWithQ2Filing("p5k-start-refused");

      for (const stepCode of FILE_GROUP_NO_START_NO_SKIP) {
        const step = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode } });
        const result = await markStepInProgress(step.id);
        expect(result.ok).toBe(false);
        const unchanged = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step.id } });
        expect(unchanged.status).not.toBe("IN_PROGRESS");
      }
    });

    it("D65: FILE_RETURN (step 5) itself keeps Mark done -- only Start and Skip are gone", async () => {
      const { filing } = await makeClientWithQ2Filing("p5k-step5-markdone-ok");
      const fileReturnStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "FILE_RETURN" },
      });
      expect((await markStepDone(fileReturnStep.id)).ok).toBe(true);
    });

    it("D67: attaching a document to steps 6, 7 or 10 is refused while step 5 isn't Done", async () => {
      const { filing } = await makeClientWithQ2Filing("p5k-attach-locked");

      for (const [stepCode, slotCode] of [
        ["SAVE_SUBMISSION_SS", "submission_screenshot"],
        ["SAVE_FORM_COPY", "filed_form"],
        ["RECEIVE_TRRC", "trrc"],
      ] as const) {
        const step = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode } });
        const formData = new FormData();
        formData.set("file", new File(["bytes"], "file.pdf", { type: "application/pdf" }));
        formData.set("workflowStepId", step.id);
        formData.set("docSlotCode", slotCode);
        formData.set("documentDate", "2026-08-15");
        const result = await uploadDocument(formData);
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/step 5/i);
        const unchanged = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step.id } });
        expect(unchanged.status).not.toBe("DONE");
      }
    });

    it("D67: once step 5 is Done, attaching the document marks steps 6/7 Done automatically -- no Mark done needed", async () => {
      const { filing } = await makeClientWithQ2Filing("p5k-attach-unlocked");
      const fileReturnStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "FILE_RETURN" },
      });
      expect((await markStepDone(fileReturnStep.id)).ok).toBe(true);

      for (const [stepCode, slotCode] of [
        ["SAVE_SUBMISSION_SS", "submission_screenshot"],
        ["SAVE_FORM_COPY", "filed_form"],
      ] as const) {
        const step = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode } });
        const formData = new FormData();
        formData.set("file", new File(["bytes"], "file.pdf", { type: "application/pdf" }));
        formData.set("workflowStepId", step.id);
        formData.set("docSlotCode", slotCode);
        formData.set("documentDate", "2026-08-15");
        const result = await uploadDocument(formData);
        expect(result.ok).toBe(true);

        const updated = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step.id } });
        expect(updated.status).toBe("DONE");
        expect(updated.completedAt).not.toBeNull();
      }
    });

    it("D67 §4.4: replacing the only file keeps the step Done, with the old file soft-deleted (one-for-one, D46's pattern)", async () => {
      const { filing } = await makeClientWithQ2Filing("p5k-replace");
      const fileReturnStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "FILE_RETURN" },
      });
      await markStepDone(fileReturnStep.id);

      const step = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "SAVE_FORM_COPY" },
      });
      const firstUpload = new FormData();
      firstUpload.set("file", new File(["v1"], "form-v1.pdf", { type: "application/pdf" }));
      firstUpload.set("workflowStepId", step.id);
      firstUpload.set("docSlotCode", "filed_form");
      firstUpload.set("documentDate", "2026-08-15");
      const firstResult = await uploadDocument(firstUpload);
      expect(firstResult.ok).toBe(true);

      const replaceUpload = new FormData();
      replaceUpload.set("file", new File(["v2"], "form-v2.pdf", { type: "application/pdf" }));
      replaceUpload.set("workflowStepId", step.id);
      replaceUpload.set("docSlotCode", "filed_form");
      replaceUpload.set("documentDate", "2026-08-16");
      const replaceResult = await uploadDocument(replaceUpload);
      expect(replaceResult.ok).toBe(true);

      const updated = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step.id } });
      expect(updated.status).toBe("DONE");

      const liveDocs = await prisma.document.findMany({ where: { workflowStepId: step.id, deletedAt: null } });
      expect(liveDocs).toHaveLength(1);
      expect(liveDocs[0].originalFilename).toBe("form-v2.pdf");

      const oldDoc = await prisma.document.findFirstOrThrow({ where: { id: firstResult.documentId! } });
      expect(oldDoc.deletedAt).not.toBeNull();
    });

    it("D67 §4.4: removing the only file reverts the step to PENDING", async () => {
      const { filing } = await makeClientWithQ2Filing("p5k-remove-reverts");
      const fileReturnStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "FILE_RETURN" },
      });
      await markStepDone(fileReturnStep.id);

      const step = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "SAVE_FORM_COPY" },
      });
      const upload = new FormData();
      upload.set("file", new File(["v1"], "form.pdf", { type: "application/pdf" }));
      upload.set("workflowStepId", step.id);
      upload.set("docSlotCode", "filed_form");
      upload.set("documentDate", "2026-08-15");
      const uploadResult = await uploadDocument(upload);
      expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step.id } })).status).toBe("DONE");

      await deleteDocument(uploadResult.documentId!, "test: simulate the only file removed");

      const reverted = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step.id } });
      expect(reverted.status).toBe("PENDING");
    });

    it("D68: an upload on step 10 completes it and clears waitingSince (it's already auto-waiting once step 5 is Done)", async () => {
      const { filing } = await makeClientWithQ2Filing("p5k-trrc-waiting-then-upload");
      const fileReturnStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "FILE_RETURN" },
      });
      await markStepDone(fileReturnStep.id);

      const trrcStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "RECEIVE_TRRC" },
      });
      expect(trrcStep.status).toBe("WAITING_EXTERNAL");
      expect(trrcStep.waitingSince).not.toBeNull();

      const upload = new FormData();
      upload.set("file", new File(["trrc-bytes"], "trrc.pdf", { type: "application/pdf" }));
      upload.set("workflowStepId", trrcStep.id);
      upload.set("docSlotCode", "trrc");
      upload.set("documentDate", "2026-08-17");
      const result = await uploadDocument(upload);
      expect(result.ok).toBe(true);

      const updated = await prisma.workflowStep.findUniqueOrThrow({ where: { id: trrcStep.id } });
      expect(updated.status).toBe("DONE");
      expect(updated.waitingSince).toBeNull();
    });

    it("Step 16's package-readiness check still finds documents attached to steps 7/9/10 via this new path", async () => {
      const { client, filing } = await makeClientWithQ2Filing("p5k-package-readiness");
      await seedPayableQ2Sales(client.id);
      // D75 (brief #5m §3) -- SAVE_PROOF_PAYMENT (step 9) now also needs
      // File (5, 6, 7) AND step 8 (MAKE_PAYMENT) Done before it unlocks.
      await fileTheReturn(filing.id);

      const trrcStep = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECEIVE_TRRC" } });
      const trrcUpload = new FormData();
      trrcUpload.set("file", new File(["bytes"], "trrc.pdf", { type: "application/pdf" }));
      trrcUpload.set("workflowStepId", trrcStep.id);
      trrcUpload.set("docSlotCode", "trrc");
      trrcUpload.set("documentDate", "2026-08-15");
      await uploadDocument(trrcUpload);

      const makePaymentStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "MAKE_PAYMENT" },
      });
      await markStepDone(makePaymentStep.id);

      const proofStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "SAVE_PROOF_PAYMENT" },
      });
      const proofUpload = new FormData();
      proofUpload.set("file", new File(["proof"], "proof.pdf", { type: "application/pdf" }));
      proofUpload.set("workflowStepId", proofStep.id);
      proofUpload.set("docSlotCode", "proof");
      proofUpload.set("documentDate", "2026-08-15");
      await uploadDocument(proofUpload);

      // SAWT_VALIDATION (step 14) is NA for this non-SAWT client -- excluded, not "missing".
      const stepsWithDocs = await prisma.workflowStep.findMany({
        where: { filingId: filing.id },
        include: { documents: { where: { deletedAt: null } } },
      });
      const dependencySteps = stepsWithDocs.map((s) => ({
        stepCode: s.stepCode,
        status: s.status,
        requiredDocSlots: parseDocSlots(s.requiredDocSlots),
      }));
      const documentsByStepCode = new Map<string, { docSlotCode: string | null; deletedAt: Date | null }[]>();
      for (const s of stepsWithDocs) {
        documentsByStepCode.set(s.stepCode, s.documents.map((d) => ({ docSlotCode: d.docSlotCode, deletedAt: null })));
      }

      const readiness = checkSendClientPackageReadiness(dependencySteps, documentsByStepCode);
      expect(readiness.ok).toBe(true);
      expect(readiness.missing).toEqual([]);
    });

    it("The completeness note doesn't count locked steps 6, 7 and 10 as missing while step 5 isn't Done", () => {
      const gaps = computeFilingCompleteness(
        [
          { stepCode: "SAVE_SUBMISSION_SS", title: "Save submission-page screenshot", status: "PENDING", requiredDocSlots: [{ slotCode: "submission_screenshot", label: "Submission-page screenshot", required: true, acceptedTypes: ["pdf"] }] },
          { stepCode: "SAVE_FORM_COPY", title: "Download and save filed form", status: "PENDING", requiredDocSlots: [{ slotCode: "filed_form", label: "Filed form PDF", required: true, acceptedTypes: ["pdf"] }] },
          { stepCode: "RECEIVE_TRRC", title: "Receive & save BIR confirmation (TRRC)", status: "PENDING", requiredDocSlots: [{ slotCode: "trrc", label: "TRRC email/PDF", required: true, acceptedTypes: ["pdf"] }] },
        ],
        new Map(),
      );
      // PENDING steps are excluded from this note entirely (only DONE/IN_PROGRESS
      // are scanned) -- steps 6/7/10 stay PENDING while locked, so they can
      // never appear here as "missing," locked or not.
      expect(gaps).toEqual([]);
    });
  });

  describe("brief #5l: the File group finished -- the TRRC waits by itself", () => {
    it("D68: removing the only TRRC returns step 10 to WAITING_EXTERNAL with step 5's own completedAt as waitingSince, not PENDING", async () => {
      const { filing } = await makeClientWithQ2Filing("p5l-trrc-remove-reverts-to-waiting");
      const fileReturnStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "FILE_RETURN" },
      });
      await markStepDone(fileReturnStep.id);
      const filedAt = (await prisma.workflowStep.findUniqueOrThrow({ where: { id: fileReturnStep.id } })).completedAt;

      const trrcStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "RECEIVE_TRRC" },
      });
      const upload = new FormData();
      upload.set("file", new File(["trrc-bytes"], "trrc.pdf", { type: "application/pdf" }));
      upload.set("workflowStepId", trrcStep.id);
      upload.set("docSlotCode", "trrc");
      upload.set("documentDate", "2026-08-17");
      const uploadResult = await uploadDocument(upload);
      expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: trrcStep.id } })).status).toBe("DONE");

      await deleteDocument(uploadResult.documentId!, "test: simulate the only TRRC removed");

      const reverted = await prisma.workflowStep.findUniqueOrThrow({ where: { id: trrcStep.id } });
      expect(reverted.status).toBe("WAITING_EXTERNAL");
      expect(reverted.waitingSince?.getTime()).toBe(filedAt?.getTime());
    });

    it("D68: Replace (one file swapped for another) keeps step 10 Done, unchanged", async () => {
      const { filing } = await makeClientWithQ2Filing("p5l-trrc-replace-stays-done");
      const fileReturnStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "FILE_RETURN" },
      });
      await markStepDone(fileReturnStep.id);

      const trrcStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "RECEIVE_TRRC" },
      });
      const firstUpload = new FormData();
      firstUpload.set("file", new File(["v1"], "trrc-v1.pdf", { type: "application/pdf" }));
      firstUpload.set("workflowStepId", trrcStep.id);
      firstUpload.set("docSlotCode", "trrc");
      firstUpload.set("documentDate", "2026-08-17");
      await uploadDocument(firstUpload);

      const replaceUpload = new FormData();
      replaceUpload.set("file", new File(["v2"], "trrc-v2.pdf", { type: "application/pdf" }));
      replaceUpload.set("workflowStepId", trrcStep.id);
      replaceUpload.set("docSlotCode", "trrc");
      replaceUpload.set("documentDate", "2026-08-18");
      const replaceResult = await uploadDocument(replaceUpload);
      expect(replaceResult.ok).toBe(true);

      const updated = await prisma.workflowStep.findUniqueOrThrow({ where: { id: trrcStep.id } });
      expect(updated.status).toBe("DONE");
      const liveDocs = await prisma.document.findMany({ where: { workflowStepId: trrcStep.id, deletedAt: null } });
      expect(liveDocs).toHaveLength(1);
      expect(liveDocs[0].originalFilename).toBe("trrc-v2.pdf");
    });

    it("D68: step 10 has no Mark waiting action -- markStepWaitingExternal refuses RECEIVE_TRRC even once step 5 is Done", async () => {
      const { filing } = await makeClientWithQ2Filing("p5l-trrc-no-manual-wait");
      const fileReturnStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "FILE_RETURN" },
      });
      await markStepDone(fileReturnStep.id);

      const trrcStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "RECEIVE_TRRC" },
      });
      const before = trrcStep.waitingSince;

      const result = await markStepWaitingExternal(trrcStep.id);
      expect(result.ok).toBe(false);

      const unchanged = await prisma.workflowStep.findUniqueOrThrow({ where: { id: trrcStep.id } });
      expect(unchanged.waitingSince?.getTime()).toBe(before?.getTime());
    });

    it("D29 regression: waiting at step 10 (auto-started once step 5 is Done) still blocks nothing in Pay", async () => {
      const { client, filing } = await makeClientWithQ2Filing("p5l-trrc-waiting-doesnt-block-pay");
      await seedPayableQ2Sales(client.id);
      // D75 (brief #5m §3) -- Pay opens only once ALL of File (5, 6, 7)
      // is Done, not just step 5.
      await fileTheReturn(filing.id);
      const trrcStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "RECEIVE_TRRC" },
      });
      expect(trrcStep.status).toBe("WAITING_EXTERNAL");

      const makePaymentStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "MAKE_PAYMENT" },
      });
      expect((await markStepDone(makePaymentStep.id)).ok).toBe(true);

      const proofStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "SAVE_PROOF_PAYMENT" },
      });
      const proofUpload = new FormData();
      proofUpload.set("file", new File(["proof-bytes"], "proof.pdf", { type: "application/pdf" }));
      proofUpload.set("workflowStepId", proofStep.id);
      proofUpload.set("docSlotCode", "proof");
      proofUpload.set("documentDate", "2026-08-15");
      expect((await uploadDocument(proofUpload)).ok).toBe(true);

      const pay = WORKFLOW_GROUPS.find((g) => g.code === "PAY")!;
      const steps = await prisma.workflowStep.findMany({
        where: { filingId: filing.id, stepCode: { in: ["MAKE_PAYMENT", "SAVE_PROOF_PAYMENT"] } },
      });
      const summary = summarizeGroup(
        pay,
        steps.map((s) => ({ stepCode: s.stepCode, status: s.status })),
      );
      expect(summary.isComplete).toBe(true);
    });
  });
});
