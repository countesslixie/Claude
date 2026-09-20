import { describe, it, expect, afterAll, vi } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { generateFilingsForClientYear, recomputeRequiresSawt } from "@/lib/workflow/filingGeneration";
import { uploadDocument } from "@/lib/actions/documents";
import { markStepDone, markStepWaitingExternal, skipStep, logFollowUp } from "@/lib/actions/workflowSteps";
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

  it("§16 item 13: markStepDone is blocked while a required doc slot is empty, succeeds once filled", async () => {
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

  it("§16 item 14: SEND_CLIENT_PACKAGE names the specific missing document from steps 7/9/10/14", async () => {
    const { filing } = await makeClientWithQ2Filing("p3-step-package");
    const sendPackageStep = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "SEND_CLIENT_PACKAGE" },
    });

    // sent_email slot itself is unfilled too, but that alone isn't what
    // we're asserting — the dependency check should fire regardless.
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

  describe("rework brief #2: the corrected blocking rule", () => {
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
      const noSlotSteps = ["ADVISE_CLIENT", "EMAIL_DAT", "SEND_CLIENT_PACKAGE"];
      for (const stepCode of noSlotSteps) {
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

    it("non-blocking steps with no doc slot mark DONE freely, and non-blocking steps with an optional slot mark DONE without it", async () => {
      const { filing } = await makeClientWithQ2Filing("p2-nonblocking");

      for (const stepCode of ["RECORD_SALES", "ADVISE_CLIENT", "FILE_RETURN", "MAKE_PAYMENT"]) {
        const step = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode } });
        const result = await markStepDone(step.id);
        expect(result.ok).toBe(true);
      }

      // RECEIVE_2307's 2307-scan slot is optional -- a client with no
      // certificates at all still has to be able to pass through (§3).
      const receive2307 = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "RECEIVE_2307" },
      });
      expect((await markStepDone(receive2307.id)).ok).toBe(true);

      // EAFS_SUBMIT's confirmation is the one documented exception (§2.3):
      // optional, never demanded, never blocking.
      const eafs = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "EAFS_SUBMIT" },
      });
      expect((await markStepDone(eafs.id)).ok).toBe(true);
    });

    it("PREPARE_RETURN generates its own computation sheet into the vault -- no upload -- and marks DONE without one", async () => {
      const { filing } = await makeClientWithQ2Filing("p2-prep-return");
      const step = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "PREPARE_RETURN" },
      });

      const preCount = await prisma.document.count({ where: { workflowStepId: step.id } });
      expect(preCount).toBe(0);

      const result = await markStepDone(step.id);
      expect(result.ok).toBe(true);

      const docs = await prisma.document.findMany({ where: { workflowStepId: step.id } });
      expect(docs).toHaveLength(1);
      expect(docs[0].docSlotCode).toBe("draft_computation");
      expect(docs[0].category).toBe("COMPUTATION_SHEET");
      expect(docs[0].mimeType).toBe("text/html");
    });

    it("step 13 waiting blocks step 14; step 14 unblocks once step 13 is DONE", async () => {
      const { client, filing } = await makeClientWithQ2Filing("p2-sawt-dependency");
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

      // Step 10 (RECEIVE_TRRC) waiting blocks nothing downstream (§4) --
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
});
