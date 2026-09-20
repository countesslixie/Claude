"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import { deriveFilingStatus } from "@/lib/workflow/status";
import { isElectionBlocked } from "@/lib/workflow/election";
import { ensureComputationSheetSaved } from "@/lib/documents/computationSheet";

export type StepActionResult = { ok: boolean; error?: string };

/**
 * Filing.status is derived from its steps, never set by hand (SPEC.md
 * 7.2). Every step mutation below recomputes it as its last write.
 */
async function recomputeFilingStatus(filingId: string, actorId: string): Promise<void> {
  const filing = await prisma.filing.findUniqueOrThrow({ where: { id: filingId } });
  const steps = await prisma.workflowStep.findMany({ where: { filingId } });
  const status = deriveFilingStatus({
    steps: steps.map((s) => ({ status: s.status, waitingOnLabel: s.waitingOnLabel })),
    adjustedDueDate: filing.adjustedDueDate,
    now: new Date(),
  });
  if (status !== filing.status) {
    await prisma.filing.update({ where: { id: filingId }, data: { status, actorId } });
  }
}

/**
 * §5.1/D27 — nothing in the checklist gates on documents; a step can be
 * marked DONE at any time regardless of what is or isn't attached.
 * Missing documents surface as an informational completeness note on
 * the filing instead (lib/workflow/completeness.ts), never a block here.
 *
 * The one exception (§7) is the election hard-blocker: a Q1 filing for a
 * client whose election isn't confirmed ELECTED cannot be marked DONE,
 * because the computation above it may be running at the wrong tax rate
 * entirely. This is the only thing that blocks.
 */
export async function markStepDone(stepId: string): Promise<StepActionResult> {
  const step = await prisma.workflowStep.findUnique({
    where: { id: stepId },
    include: { filing: true },
  });
  if (!step) return { ok: false, error: "Step not found." };

  const clientTaxYear = await prisma.clientTaxYear.findUnique({
    where: { clientId_taxableYear: { clientId: step.filing.clientId, taxableYear: step.filing.taxableYear } },
  });
  if (isElectionBlocked(step.filing.period, clientTaxYear?.electionStatus)) {
    return {
      ok: false,
      error:
        "8% election for this taxable year is not confirmed Elected — Q1 steps cannot be marked done until this is resolved (SPEC.md 3.1: an unconfirmed election may default to graduated rates, making this filing's computation wrong).",
    };
  }

  const actorId = await getActorId();
  const before = step;
  const updated = await prisma.workflowStep.update({
    where: { id: stepId },
    data: { status: "DONE", completedAt: new Date(), startedAt: step.startedAt ?? new Date(), actorId },
  });

  await logActivity({ entityType: "WorkflowStep", entityId: stepId, action: "UPDATE", before, after: updated, actorId });
  await recomputeFilingStatus(step.filingId, actorId);
  if (step.stepCode === "PREPARE_RETURN") await ensureComputationSheetSaved(step.filingId);
  revalidatePath(`/clients/${step.filing.clientId}/filings/${step.filingId}`);
  revalidatePath("/filings");

  return { ok: true };
}

export async function markStepInProgress(stepId: string): Promise<StepActionResult> {
  const step = await prisma.workflowStep.findUnique({ where: { id: stepId }, include: { filing: true } });
  if (!step) return { ok: false, error: "Step not found." };

  const actorId = await getActorId();
  const updated = await prisma.workflowStep.update({
    where: { id: stepId },
    data: { status: "IN_PROGRESS", startedAt: step.startedAt ?? new Date(), actorId },
  });

  await logActivity({ entityType: "WorkflowStep", entityId: stepId, action: "UPDATE", before: step, after: updated, actorId });
  await recomputeFilingStatus(step.filingId, actorId);
  if (step.stepCode === "PREPARE_RETURN") await ensureComputationSheetSaved(step.filingId);
  revalidatePath(`/clients/${step.filing.clientId}/filings/${step.filingId}`);
  revalidatePath("/filings");

  return { ok: true };
}

/** Stamps waitingSince — aging is computed from that stamp (SPEC.md 7.2). */
export async function markStepWaitingExternal(stepId: string): Promise<StepActionResult> {
  const step = await prisma.workflowStep.findUnique({ where: { id: stepId }, include: { filing: true } });
  if (!step) return { ok: false, error: "Step not found." };
  if (!step.isWaitingState) return { ok: false, error: "This step isn't a waiting-on-external step." };

  const actorId = await getActorId();
  const updated = await prisma.workflowStep.update({
    where: { id: stepId },
    data: { status: "WAITING_EXTERNAL", waitingSince: new Date(), startedAt: step.startedAt ?? new Date(), actorId },
  });

  await logActivity({ entityType: "WorkflowStep", entityId: stepId, action: "UPDATE", before: step, after: updated, actorId });
  await recomputeFilingStatus(step.filingId, actorId);
  revalidatePath(`/clients/${step.filing.clientId}/filings/${step.filingId}`);
  revalidatePath("/filings");

  return { ok: true };
}

/** A step may be SKIPPED only with a written reason — no silent skips (SPEC.md 7.2). */
export async function skipStep(stepId: string, reason: string): Promise<StepActionResult> {
  if (!reason.trim()) return { ok: false, error: "A reason is required to skip a step." };

  const step = await prisma.workflowStep.findUnique({ where: { id: stepId }, include: { filing: true } });
  if (!step) return { ok: false, error: "Step not found." };

  const actorId = await getActorId();
  const updated = await prisma.workflowStep.update({
    where: { id: stepId },
    data: { status: "SKIPPED", skippedReason: reason.trim(), actorId },
  });

  await logActivity({ entityType: "WorkflowStep", entityId: stepId, action: "UPDATE", before: step, after: updated, actorId });
  await recomputeFilingStatus(step.filingId, actorId);
  revalidatePath(`/clients/${step.filing.clientId}/filings/${step.filingId}`);
  revalidatePath("/filings");

  return { ok: true };
}

/**
 * "Log follow-up": increments followUpCount and re-stamps the clock
 * (SPEC.md 7.2). For RECEIVE_2307, aging is anchored on
 * Filing.certificatesExpectedBy regardless of waitingSince (SPEC.md
 * 3.6), so re-stamping waitingSince here is harmless bookkeeping — it
 * doesn't change what the dashboard shows for that step.
 */
export async function logFollowUp(stepId: string): Promise<StepActionResult> {
  const step = await prisma.workflowStep.findUnique({ where: { id: stepId }, include: { filing: true } });
  if (!step) return { ok: false, error: "Step not found." };
  if (step.status !== "WAITING_EXTERNAL") return { ok: false, error: "This step isn't currently waiting." };

  const actorId = await getActorId();
  const updated = await prisma.workflowStep.update({
    where: { id: stepId },
    data: { waitingSince: new Date(), followUpCount: { increment: 1 }, actorId },
  });

  await logActivity({ entityType: "WorkflowStep", entityId: stepId, action: "UPDATE", before: step, after: updated, actorId });
  revalidatePath(`/clients/${step.filing.clientId}/filings/${step.filingId}`);
  revalidatePath("/filings");
  revalidatePath("/");

  return { ok: true };
}

/** Void-returning wrapper for direct use as a <form action> (e.g. the dashboard's one-click follow-up). */
export async function logFollowUpAction(stepId: string): Promise<void> {
  await logFollowUp(stepId);
}
