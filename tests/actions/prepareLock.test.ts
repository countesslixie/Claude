import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";
import { markStepDone, markStepInProgress, skipStep } from "@/lib/actions/workflowSteps";
import { nextActionForFiling, stepLockReason, prepareFinishedBlockReason } from "@/lib/workflow/groups";
import type { WorkflowStepStatus } from "@/lib/workflow/types";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/** D100 (brief #5r) — step 5 waits for all of Prepare; D101 — step 16 is Mark done only and saves its email. */
describe("step 5 waits for Prepare (D100)", () => {
  const clientIds: string[] = [];
  let n = 0;

  afterAll(async () => {
    await prisma.workflowStep.deleteMany({ where: { filing: { clientId: { in: clientIds } } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.clientTaxYear.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  });

  async function makeQ1(): Promise<{ filingId: string; clientId: string }> {
    const client = await prisma.client.create({
      data: {
        code: `prep-lock-${Date.now()}-${n++}`,
        registeredName: "Prepare Lock Test Client",
        email: "client@example.com",
        tin: "444555666",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    clientIds.push(client.id);
    await prisma.clientTaxYear.create({
      data: { clientId: client.id, taxableYear: 2026, regime: "RATE_8_PERCENT", electionStatus: "ELECTED" },
    });
    await generateFilingsForClientYear(client.id, 2026);
    const filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q1" } },
    });
    return { filingId: filing.id, clientId: client.id };
  }

  const setStatus = (filingId: string, stepCode: string, status: WorkflowStepStatus) =>
    prisma.workflowStep.updateMany({ where: { filingId, stepCode }, data: { status } });
  const step5 = (filingId: string) => prisma.workflowStep.findFirstOrThrow({ where: { filingId, stepCode: "FILE_RETURN" } });

  async function expectRefusedAndUntouched(filingId: string) {
    const before = await step5(filingId);
    const result = await markStepDone(before.id);
    expect(result).toEqual({ ok: false, error: "Finish Prepare first." });
    const after = await step5(filingId);
    expect(after.status).toBe(before.status);
    expect(after.completedAt).toBeNull();
    const filing = await prisma.filing.findUniqueOrThrow({ where: { id: filingId } });
    expect(filing.computationSnapshot).toBeNull(); // no snapshot frozen
    expect(filing.filedAt).toBeNull();
  }

  it("is refused with step 3 open, and the refused call writes nothing", async () => {
    const { filingId } = await makeQ1();
    await setStatus(filingId, "RECORD_SALES", "DONE");
    await setStatus(filingId, "RECEIVE_2307", "SKIPPED");
    await setStatus(filingId, "ADVISE_CLIENT", "DONE");
    await expectRefusedAndUntouched(filingId);
  });

  it("is refused with step 4 open, and the refused call writes nothing", async () => {
    const { filingId } = await makeQ1();
    await setStatus(filingId, "RECORD_SALES", "DONE");
    await setStatus(filingId, "RECEIVE_2307", "DONE");
    await setStatus(filingId, "PREPARE_RETURN", "DONE");
    await expectRefusedAndUntouched(filingId);
  });

  it("is refused with step 1 open", async () => {
    const { filingId } = await makeQ1();
    await setStatus(filingId, "RECEIVE_2307", "DONE");
    await setStatus(filingId, "PREPARE_RETURN", "DONE");
    await setStatus(filingId, "ADVISE_CLIENT", "DONE");
    await expectRefusedAndUntouched(filingId);
  });

  it("is allowed with step 2 Skipped and steps 1, 3 and 4 Done", async () => {
    const { filingId } = await makeQ1();
    await setStatus(filingId, "RECORD_SALES", "DONE");
    await setStatus(filingId, "RECEIVE_2307", "SKIPPED");
    await setStatus(filingId, "PREPARE_RETURN", "DONE");
    await setStatus(filingId, "ADVISE_CLIENT", "DONE");
    const result = await markStepDone((await step5(filingId)).id);
    expect(result.ok, result.error).toBe(true);
    const filing = await prisma.filing.findUniqueOrThrow({ where: { id: filingId } });
    expect(filing.computationSnapshot).not.toBeNull();
    expect(filing.filedAt).not.toBeNull();
  });

  const steps = (statuses: Partial<Record<string, WorkflowStepStatus>>) =>
    ["RECORD_SALES", "RECEIVE_2307", "PREPARE_RETURN", "ADVISE_CLIENT", "FILE_RETURN"].map((stepCode) => ({
      stepCode,
      status: statuses[stepCode] ?? ("PENDING" as WorkflowStepStatus),
    }));

  it("stepLockReason shows the Prepare reason when both locks apply", () => {
    const open = steps({});
    expect(stepLockReason("FILE_RETURN", open, "File Q1 2026 first.")).toBe("Finish Prepare first.");
    expect(stepLockReason("FILE_RETURN", open)).toBe("Finish Prepare first.");
  });

  it("stepLockReason falls back to the filing-order reason once Prepare is finished, and to nothing when neither applies", () => {
    const done = steps({ RECORD_SALES: "DONE", RECEIVE_2307: "SKIPPED", PREPARE_RETURN: "DONE", ADVISE_CLIENT: "DONE" });
    expect(prepareFinishedBlockReason(done)).toBeNull();
    expect(stepLockReason("FILE_RETURN", done, "File Q1 2026 first.")).toBe("File Q1 2026 first.");
    expect(stepLockReason("FILE_RETURN", done)).toBeNull();
  });

  it("Next never offers step 5 while it is locked by Prepare: it points at the open Prepare step", () => {
    const s = steps({ RECORD_SALES: "DONE", RECEIVE_2307: "DONE", PREPARE_RETURN: "DONE" }); // step 4 open
    expect(nextActionForFiling(s)).toEqual({ kind: "work", stepCode: "ADVISE_CLIENT" });
    expect(nextActionForFiling(steps({}))).toEqual({ kind: "work", stepCode: "RECORD_SALES" });
  });

  it("D101: step 16 can't be started or skipped, enforced server-side", async () => {
    const { filingId } = await makeQ1();
    const step16 = await prisma.workflowStep.findFirstOrThrow({ where: { filingId, stepCode: "SEND_CLIENT_PACKAGE" } });
    const skip = await skipStep(step16.id, "not needed");
    expect(skip.ok).toBe(false);
    const start = await markStepInProgress(step16.id);
    expect(start.ok).toBe(false);
    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step16.id } })).status).toBe(step16.status);
  });

  it("D101: marking step 16 Done saves the exact email on the filing", async () => {
    const { filingId } = await makeQ1();
    // Everything ahead of step 16 resolved; documents-bearing steps set to not applicable so the package check passes.
    await prisma.workflowStep.updateMany({
      where: { filingId, stepCode: { in: ["RECORD_SALES", "RECEIVE_2307", "PREPARE_RETURN", "ADVISE_CLIENT", "SAVE_SUBMISSION_SS", "EAFS_SUBMIT"] } },
      data: { status: "DONE" },
    });
    const result5 = await markStepDone((await step5(filingId)).id);
    expect(result5.ok, result5.error).toBe(true);
    await prisma.workflowStep.updateMany({
      where: { filingId, stepCode: { in: ["SAVE_FORM_COPY", "SAVE_PROOF_PAYMENT", "RECEIVE_TRRC", "SAWT_VALIDATION"] } },
      data: { status: "NA" },
    });
    const step16 = await prisma.workflowStep.findFirstOrThrow({ where: { filingId, stepCode: "SEND_CLIENT_PACKAGE" } });
    const before = await prisma.filing.findUniqueOrThrow({ where: { id: filingId } });
    expect(before.clientPackageEmailSavedAt).toBeNull();

    const done = await markStepDone(step16.id);
    expect(done.ok, done.error).toBe(true);
    const after = await prisma.filing.findUniqueOrThrow({ where: { id: filingId } });
    expect(after.clientPackageEmailTo).toBe("client@example.com");
    expect(after.clientPackageEmailSubject).toContain("1701Q Q1 2026");
    expect(after.clientPackageEmailBody).toContain("Summary:");
    expect(after.clientPackageEmailSavedAt).not.toBeNull();
  });
});
