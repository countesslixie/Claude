import { describe, it, expect, afterAll, vi } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { generateFilingsForClientYear, recomputeRequiresSawt } from "@/lib/workflow/filingGeneration";
import { uploadDocument } from "@/lib/actions/documents";
import { markStepDone, markStepWaitingExternal, skipStep, logFollowUp, markGroupDone } from "@/lib/actions/workflowSteps";
import { parseDocSlots } from "@/lib/workflow/types";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("workflow step actions", () => {
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
   * D27 (reconciled from laughing-darwin's commit 7bfbd5d) — the
   * corrected blocking rule: markStepDone is blocked while a required doc
   * slot is empty, and succeeds once filled. Q2 is used here (not Q1) so
   * this isn't also exercising the election hard-blocker, a separate
   * exception.
   */
  it("markStepDone is blocked while a required doc slot is empty, succeeds once filled", async () => {
    const { filing } = await makeClientWithQ2Filing("p3-step-done");
    const step = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "SAVE_FORM_COPY" },
    });

    const blocked = await markStepDone(step.id);
    expect(blocked.ok).toBe(false);

    const formData = new FormData();
    formData.set("file", new File(["form-bytes"], "form.pdf", { type: "application/pdf" }));
    formData.set("workflowStepId", step.id);
    formData.set("docSlotCode", "filed_form");
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

  it("marking RECEIVE_TRRC WAITING_EXTERNAL flips the filing status to WAITING_BIR", async () => {
    // Q3 (adjusted due Nov 16, 2026) — not yet past due relative to "now"
    // when this suite runs, unlike Q2 (due Aug 17), so BLOCKED doesn't
    // pre-empt WAITING_BIR here (BLOCKED correctly takes priority when a
    // filing genuinely is overdue — see lib/workflow/status.ts).
    const { client } = await makeClientWithQ2Filing("p3-step-waitbir");
    const filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q3" } },
    });
    const trrcStep = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "RECEIVE_TRRC" },
    });

    const result = await markStepWaitingExternal(trrcStep.id);
    expect(result.ok).toBe(true);

    const updatedFiling = await prisma.filing.findUniqueOrThrow({ where: { id: filing.id } });
    expect(updatedFiling.status).toBe("WAITING_BIR");

    const followUp = await logFollowUp(trrcStep.id);
    expect(followUp.ok).toBe(true);
    const updatedStep = await prisma.workflowStep.findUniqueOrThrow({ where: { id: trrcStep.id } });
    expect(updatedStep.followUpCount).toBe(1);
  });

  it("skipStep requires a non-empty reason — no silent skips (SPEC.md 7.2)", async () => {
    const { filing } = await makeClientWithQ2Filing("p3-step-skip");
    const step = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "MAKE_PAYMENT" },
    });

    const blocked = await skipStep(step.id, "");
    expect(blocked.ok).toBe(false);

    const allowed = await skipStep(step.id, "Client remitted directly, no separate payment step needed.");
    expect(allowed.ok).toBe(true);
    const updated = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step.id } });
    expect(updated.status).toBe("SKIPPED");
    expect(updated.skippedReason).toBeTruthy();
  });

  it("§9.4/§5.4: marking PREPARE_RETURN done saves the app's own computation sheet into the vault, with no upload", async () => {
    const { filing } = await makeClientWithQ2Filing("p3-step-compsheet");
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

      for (const stepCode of ["RECORD_SALES", "ADVISE_CLIENT", "FILE_RETURN", "MAKE_PAYMENT", "PREPARE_RETURN"]) {
        const step = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode } });
        const result = await markStepDone(step.id);
        expect(result.ok).toBe(true);
      }

      // RECEIVE_2307's 2307-scan slot is optional -- a client with no
      // certificates at all still has to be able to pass through.
      const receive2307 = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "RECEIVE_2307" },
      });
      expect((await markStepDone(receive2307.id)).ok).toBe(true);

      // EAFS_SUBMIT's confirmation is the one documented exception:
      // optional, never demanded, never blocking.
      const eafs = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "EAFS_SUBMIT" },
      });
      expect((await markStepDone(eafs.id)).ok).toBe(true);
    });

    it("step 13 waiting blocks step 14; step 14 unblocks once step 13 is DONE", async () => {
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

      // Attach validation's own document so the ONLY thing standing in the
      // way is the step 13 -> 14 dependency itself.
      const formData = new FormData();
      formData.set("file", new File(["validation-bytes"], "validation.pdf", { type: "application/pdf" }));
      formData.set("workflowStepId", validationStep.id);
      formData.set("docSlotCode", "validation_email");
      formData.set("documentDate", "2026-08-15");
      await uploadDocument(formData);

      await markStepWaitingExternal(ackStep.id); // step 13 waiting, not done
      const stillBlocked = await markStepDone(validationStep.id);
      expect(stillBlocked.ok).toBe(false);

      // Step 10 (RECEIVE_TRRC) waiting blocks nothing downstream --
      // marking it WAITING_EXTERNAL has no effect on step 14's outcome.
      const trrcStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "RECEIVE_TRRC" },
      });
      await markStepWaitingExternal(trrcStep.id);
      const stillBlockedAfterTrrcWaiting = await markStepDone(validationStep.id);
      expect(stillBlockedAfterTrrcWaiting.ok).toBe(false);

      // Now resolve step 13 -- step 14 should unblock.
      const ackFormData = new FormData();
      ackFormData.set("file", new File(["ack"], "ack.pdf", { type: "application/pdf" }));
      ackFormData.set("workflowStepId", ackStep.id);
      ackFormData.set("docSlotCode", "acknowledgement");
      ackFormData.set("documentDate", "2026-08-15");
      await uploadDocument(ackFormData);
      const ackDone = await markStepDone(ackStep.id);
      expect(ackDone.ok).toBe(true);

      const nowAllowed = await markStepDone(validationStep.id);
      expect(nowAllowed.ok).toBe(true);
    });
  });

  describe("brief #4a/#4b: markGroupDone", () => {
    it("brief #4b -- Prepare's Mark done is blocked until steps 1 and 2 are resolved", async () => {
      const { filing } = await makeClientWithQ2Filing("p4-group-prepare-blocked");

      const blocked = await markGroupDone(filing.id, "PREPARE");
      expect(blocked.ok).toBe(false);
      expect(blocked.error).toMatch(/quarterly sales/i);

      const recordSalesStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "RECORD_SALES" },
      });
      await markStepDone(recordSalesStep.id);
      await skipStep(
        (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECEIVE_2307" } })).id,
        "No 2307s expected this quarter.",
      );

      const result = await markGroupDone(filing.id, "PREPARE");
      expect(result.ok).toBe(true);

      const steps = await prisma.workflowStep.findMany({
        where: { filingId: filing.id, stepCode: { in: ["RECORD_SALES", "RECEIVE_2307", "PREPARE_RETURN", "ADVISE_CLIENT"] } },
      });
      expect(steps.every((s) => s.status === "DONE" || s.status === "SKIPPED")).toBe(true);
    });

    it("is blocked while a required document is missing, and succeeds once it's attached -- the same rule as the per-step control", async () => {
      const { filing } = await makeClientWithQ2Filing("p4-group-pay-blocked");

      const blocked = await markGroupDone(filing.id, "PAY");
      expect(blocked.ok).toBe(false);

      const proofStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "SAVE_PROOF_PAYMENT" },
      });
      const formData = new FormData();
      formData.set("file", new File(["proof-bytes"], "proof.pdf", { type: "application/pdf" }));
      formData.set("workflowStepId", proofStep.id);
      formData.set("docSlotCode", "proof");
      formData.set("documentDate", "2026-08-15");
      await uploadDocument(formData);

      const allowed = await markGroupDone(filing.id, "PAY");
      expect(allowed.ok).toBe(true);

      const steps = await prisma.workflowStep.findMany({
        where: { filingId: filing.id, stepCode: { in: ["MAKE_PAYMENT", "SAVE_PROOF_PAYMENT"] } },
      });
      expect(steps.every((s) => s.status === "DONE")).toBe(true);
    });

    it("§2 -- completing Pay (group 3) while File (group 2) is still open raises no warning: they're independent", async () => {
      const { filing } = await makeClientWithQ2Filing("p4-group-independent");

      const proofStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "SAVE_PROOF_PAYMENT" },
      });
      const formData = new FormData();
      formData.set("file", new File(["proof-bytes"], "proof.pdf", { type: "application/pdf" }));
      formData.set("workflowStepId", proofStep.id);
      formData.set("docSlotCode", "proof");
      formData.set("documentDate", "2026-08-15");
      await uploadDocument(formData);

      // File (group 2) is untouched -- nothing in it has been attached or marked.
      const payResult = await markGroupDone(filing.id, "PAY");
      expect(payResult.ok).toBe(true);

      const fileSteps = await prisma.workflowStep.findMany({
        where: { filingId: filing.id, stepCode: { in: ["FILE_RETURN", "SAVE_SUBMISSION_SS", "SAVE_FORM_COPY", "RECEIVE_TRRC"] } },
      });
      expect(fileSteps.every((s) => s.status === "PENDING")).toBe(true);
    });

    it("processes a group's steps in ascending sequence, so the step 13 -> 14 dependency (D29) resolves on its own within one group call", async () => {
      const { client, filing } = await makeClientWithQ2Filing("p4-group-sawt-dependency");
      await prisma.form2307.create({
        data: {
          clientId: client.id,
          taxableYear: 2026,
          payorName: "Group Dependency Test Payor",
          payorTin: "444555666",
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

      const alphalistStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "ALPHALIST_ENTRY" },
      });
      const ackStep = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "SAWT_ACK" } });
      const validationStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "SAWT_VALIDATION" },
      });

      // ALPHALIST_ENTRY (step 11, earlier in the group) needs both its
      // slots filled too, or markGroupDone would stop there before ever
      // reaching the 13 -> 14 dependency this test is actually about.
      for (const [step, slotCode] of [
        [alphalistStep, "generated_report"],
        [alphalistStep, "dat_file"],
        [ackStep, "acknowledgement"],
        [validationStep, "validation_email"],
      ] as const) {
        const formData = new FormData();
        formData.set("file", new File(["bytes"], `${slotCode}.pdf`, { type: "application/pdf" }));
        formData.set("workflowStepId", step.id);
        formData.set("docSlotCode", slotCode);
        formData.set("documentDate", "2026-08-15");
        await uploadDocument(formData);
      }

      const result = await markGroupDone(filing.id, "SAWT");
      expect(result.ok).toBe(true);

      const updatedAck = await prisma.workflowStep.findUniqueOrThrow({ where: { id: ackStep.id } });
      const updatedValidation = await prisma.workflowStep.findUniqueOrThrow({ where: { id: validationStep.id } });
      expect(updatedAck.status).toBe("DONE");
      expect(updatedValidation.status).toBe("DONE");
    });

    it("skips steps already DONE/NA/SKIPPED and leaves them untouched", async () => {
      const { filing } = await makeClientWithQ2Filing("p4-group-skip-resolved");

      // Steps 1 and 2 must be resolved first (brief #4b) before Prepare's
      // own Mark done will run at all.
      const recordSalesStep = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "RECORD_SALES" },
      });
      await markStepDone(recordSalesStep.id);
      const receive2307Step = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "RECEIVE_2307" },
      });
      await skipStep(receive2307Step.id, "No 2307s expected this quarter.");

      const adviseStep = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "ADVISE_CLIENT" } });
      await skipStep(adviseStep.id, "Client already briefed verbally.");

      const result = await markGroupDone(filing.id, "PREPARE");
      expect(result.ok).toBe(true);

      const updatedAdvise = await prisma.workflowStep.findUniqueOrThrow({ where: { id: adviseStep.id } });
      expect(updatedAdvise.status).toBe("SKIPPED");
      expect(updatedAdvise.skippedReason).toBe("Client already briefed verbally.");
    });
  });
});
