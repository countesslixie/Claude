import { describe, it, expect, afterAll, vi } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";
import { uploadDocument } from "@/lib/actions/documents";
import { markStepDone, markStepWaitingExternal, skipStep, logFollowUp } from "@/lib/actions/workflowSteps";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("workflow step actions", () => {
  const createdClientIds: string[] = [];
  const clientCodes: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.document.deleteMany({ where: { clientId: { in: createdClientIds } } });
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
});
