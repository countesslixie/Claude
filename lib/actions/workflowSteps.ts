"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import { deriveFilingStatus } from "@/lib/workflow/status";
import { isElectionBlocked } from "@/lib/workflow/election";
import { ensureComputationSheetSaved } from "@/lib/documents/computationSheet";
import { missingRequiredSlots, checkSendClientPackageReadiness } from "@/lib/workflow/docSlots";
import { parseDocSlots } from "@/lib/workflow/types";

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
 * D27 (rework brief #2 §2) — the corrected blocking rule, reconciled onto
 * this branch's income model: the app blocks on documents it receives,
 * never on proof that the bookkeeper did something. Steps 6, 7, 9, 10, 11
 * (both slots), 13, 14 require their document; everything else — most
 * importantly steps 4, 12, 16 (no slot at all) and step 3/15 (optional) —
 * marks DONE freely regardless of what's attached.
 *
 * Two things are checked ahead of the document gate, in order:
 *   1. The election hard-blocker (unaffected by D27 — it guards a wrong
 *      tax rate, not a missing file): a Q1 filing whose election isn't
 *      confirmed ELECTED cannot be marked DONE on any step.
 *   2. Step 13 -> 14 (D29): a validation email cannot arrive before the
 *      acknowledgement it follows, so SAWT_VALIDATION stays blocked while
 *      SAWT_ACK is unresolved. One explicit edge, not a general
 *      "waiting blocks the next step" rule.
 * SEND_CLIENT_PACKAGE's own dependency check (steps 7/9/10/14 must each
 * have their document, SPEC.md 7.1) runs before its own (now nonexistent)
 * slot would, so its specific "what's missing" message isn't masked.
 */
export async function markStepDone(stepId: string): Promise<StepActionResult> {
  const step = await prisma.workflowStep.findUnique({
    where: { id: stepId },
    include: { documents: true, filing: { include: { workflowSteps: { include: { documents: true } } } } },
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

  // Step 13 -> 14 (D29) — the one genuine sequencing dependency in the
  // workflow. Every other waiting step (notably RECEIVE_TRRC and
  // SAWT_VALIDATION itself) blocks nothing downstream.
  if (step.stepCode === "SAWT_VALIDATION") {
    const ackStep = step.filing.workflowSteps.find((s) => s.stepCode === "SAWT_ACK");
    if (ackStep && ackStep.status !== "DONE" && ackStep.status !== "NA" && ackStep.status !== "SKIPPED") {
      return {
        ok: false,
        error: "Cannot complete — the acknowledgement email (step 13) hasn't been received yet.",
      };
    }
  }

  if (step.stepCode === "SEND_CLIENT_PACKAGE") {
    const dependencySteps = step.filing.workflowSteps.map((s) => ({
      stepCode: s.stepCode,
      status: s.status,
      requiredDocSlots: parseDocSlots(s.requiredDocSlots),
    }));
    const documentsByStepCode = new Map(
      step.filing.workflowSteps.map((s) => [
        s.stepCode,
        s.documents.map((d) => ({ docSlotCode: d.docSlotCode, deletedAt: d.deletedAt })),
      ]),
    );
    const readiness = checkSendClientPackageReadiness(dependencySteps, documentsByStepCode);
    if (!readiness.ok) {
      const names = readiness.missing.map((m) => `${m.stepLabel}: ${m.slotLabel}`).join("; ");
      return { ok: false, error: `Package incomplete — missing: ${names}.` };
    }
  }

  const slots = parseDocSlots(step.requiredDocSlots);
  const missing = missingRequiredSlots(slots, step.documents);
  if (missing.length > 0) {
    return { ok: false, error: `Missing required document: ${missing.map((s) => s.label).join(", ")}.` };
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
