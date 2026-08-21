"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import { missingRequiredSlots, checkSendClientPackageReadiness } from "@/lib/workflow/docSlots";
import { deriveFilingStatus } from "@/lib/workflow/status";
import { parseDocSlots } from "@/lib/workflow/types";
import { getPeriodReconciliation } from "@/lib/reconciliation";
import { centsToPesos } from "@/lib/money";

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
 * A step with an empty required doc slot cannot be set DONE (SPEC.md
 * 7.2, §16 item 13). SEND_CLIENT_PACKAGE additionally requires steps
 * 7/9/10/14 to each have their own document already (SPEC.md 7.1, §16
 * item 14) — names exactly which is missing rather than a generic
 * "not ready" message.
 */
export async function markStepDone(stepId: string): Promise<StepActionResult> {
  const step = await prisma.workflowStep.findUnique({
    where: { id: stepId },
    include: { documents: true, filing: { include: { workflowSteps: { include: { documents: true } } } } },
  });
  if (!step) return { ok: false, error: "Step not found." };

  // SEND_CLIENT_PACKAGE's dependency check (steps 7/9/10/14, §16 item 14)
  // is checked first and reported on its own — it's the more specific,
  // "closes-the-loop" diagnostic SPEC.md 7.1 asks for, and in realistic
  // use the step's own sent_email slot is often ALSO still empty at the
  // same time, which would otherwise mask this message entirely.
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

  // ALPHALIST_ENTRY is blocked by a variance between cumulative CWT
  // claimed on the filing and cumulative certificates batched through
  // this period (SPEC.md 10 check 3) — names the specific certificates
  // responsible rather than a generic "doesn't match" message.
  if (step.stepCode === "ALPHALIST_ENTRY") {
    const reconciliation = await getPeriodReconciliation(
      step.filing.clientId,
      step.filing.taxableYear,
      step.filing.period,
    );
    if (reconciliation.hasVariance) {
      const varianceLabel = centsToPesos(reconciliation.varianceCents, { withSymbol: true });
      const names =
        reconciliation.unbatchedCertificates.length > 0
          ? reconciliation.unbatchedCertificates
              .map((c) => `${c.payorName} (${centsToPesos(c.taxWithheldCents, { withSymbol: true })})`)
              .join("; ")
          : "(no specific certificate identified — check the batch for certificates no longer eligible)";
      return {
        ok: false,
        error: `SAWT variance ${varianceLabel} — CWT claimed on the filing doesn't match certificates batched through this period. Not yet batched: ${names}.`,
      };
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
