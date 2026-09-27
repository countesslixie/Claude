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
import { WORKFLOW_GROUPS, prepareGroupBlockReason, adviseClientBlockReason } from "@/lib/workflow/groups";
import { isResolved } from "@/lib/workflow/status";
import { buildLiveAdviceMessageForFiling } from "@/lib/workflow/adviceMessage";

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

  // Brief #4c fix — the group-level block (brief #4b's prepareGroupBlockReason)
  // only ever covered the group's own "Mark done" button; step 3's own
  // per-step button had no such check and could be clicked directly while
  // steps 1/2 were still unresolved. Enforced here, server-side, so it
  // can't be bypassed by calling this action directly. Step 4 is
  // unaffected — this brief scoped the fix to step 3 only.
  if (step.stepCode === "PREPARE_RETURN") {
    const reason = prepareGroupBlockReason(step.filing.workflowSteps);
    if (reason) return { ok: false, error: reason };
  }

  // Brief #5e §1 — step 4 (ADVISE_CLIENT) requires step 3 (PREPARE_RETURN)
  // to be Done first, enforced here so it can't be bypassed by calling
  // this action directly (the same reasoning as step 3's own check above).
  // markGroupDone below calls this per-step in ascending sequence order,
  // so it naturally resolves step 3 before attempting step 4 and never
  // bypasses this rule.
  if (step.stepCode === "ADVISE_CLIENT") {
    const reason = adviseClientBlockReason(step.filing.workflowSteps);
    if (reason) return { ok: false, error: reason };
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

  // Brief #5e §3 — the message is saved exactly as sent at the moment
  // step 4 is marked Done, not rebuilt live afterward. If reopening later
  // clears it (see reopenPreparedFiling below), marking step 4 done again
  // rebuilds it fresh from whatever the figures are by then.
  if (step.stepCode === "ADVISE_CLIENT") {
    const message = await buildLiveAdviceMessageForFiling(step.filingId);
    if (message) {
      await prisma.filing.update({
        where: { id: step.filingId },
        data: {
          adviceMessageSubject: message.subject,
          adviceMessageBody: message.body,
          adviceMessageSavedAt: new Date(),
        },
      });
    }
  }

  revalidatePath(`/clients/${step.filing.clientId}/filings/${step.filingId}`);
  revalidatePath("/filings");

  return { ok: true };
}

/**
 * Brief #5d §6 — while a filing's own return isn't filed yet (step 5,
 * FILE_RETURN, not DONE), a change to the figures behind the computation
 * — made after step 3 (PREPARE_RETURN) was marked Done — reopens both
 * step 3 and step 4 (ADVISE_CLIENT): the return needs re-preparing and
 * the client needs re-advising with the corrected figures. Callers are
 * lib/actions/quarterlySales.ts (a figures-changing final save, or any
 * draft save) and lib/actions/form2307.ts (adding/removing a certificate,
 * or unticking "all received"). A no-op call — step 3 isn't currently
 * Done, or the filing is already filed — does nothing. The Prepare
 * group's own "Mark done" reverts from a Done pill back to a button as a
 * consequence, since it's derived live from its steps' status.
 */
export async function reopenPreparedFiling(filingId: string): Promise<void> {
  const filing = await prisma.filing.findUnique({ where: { id: filingId }, include: { workflowSteps: true } });
  if (!filing) return;

  const fileReturnStep = filing.workflowSteps.find((s) => s.stepCode === "FILE_RETURN");
  if (fileReturnStep?.status === "DONE") return; // filed filings are unaffected

  const prepareReturnStep = filing.workflowSteps.find((s) => s.stepCode === "PREPARE_RETURN");
  if (!prepareReturnStep || prepareReturnStep.status !== "DONE") return; // nothing to reopen

  const actorId = await getActorId();

  const updatedPrepare = await prisma.workflowStep.update({
    where: { id: prepareReturnStep.id },
    data: { status: "PENDING", completedAt: null, actorId },
  });
  await logActivity({
    entityType: "WorkflowStep",
    entityId: prepareReturnStep.id,
    action: "UPDATE",
    before: prepareReturnStep,
    after: updatedPrepare,
    actorId,
  });

  const adviseClientStep = filing.workflowSteps.find((s) => s.stepCode === "ADVISE_CLIENT");
  if (adviseClientStep && adviseClientStep.status !== "PENDING") {
    const updatedAdvise = await prisma.workflowStep.update({
      where: { id: adviseClientStep.id },
      data: { status: "PENDING", completedAt: null, actorId },
    });
    await logActivity({
      entityType: "WorkflowStep",
      entityId: adviseClientStep.id,
      action: "UPDATE",
      before: adviseClientStep,
      after: updatedAdvise,
      actorId,
    });
  }

  // Brief #5e §3 — clear the saved message along with reopening step 4:
  // it was sent for figures that no longer hold, so the card must show a
  // freshly-rebuilt live preview, not the stale saved text, until step 4
  // is marked Done again.
  if (filing.adviceMessageSavedAt != null) {
    await prisma.filing.update({
      where: { id: filingId },
      data: { adviceMessageSubject: null, adviceMessageBody: null, adviceMessageSavedAt: null, actorId },
    });
  }

  await recomputeFilingStatus(filingId, actorId);
  revalidatePath(`/clients/${filing.clientId}/filings/${filingId}`);
  revalidatePath("/filings");
}

/**
 * Brief #4a — one "Mark done" per group, marking every unresolved step in
 * that group at once (a clean quarter is five clicks, not sixteen). This
 * calls the exact same markStepDone() as the per-step control above, in
 * ascending sequence order, for every step in the group not already
 * DONE/NA/SKIPPED — so every existing check (the election hard-blocker,
 * the step 13 -> 14 dependency, SEND_CLIENT_PACKAGE's package-readiness
 * check, and the required-doc-slot gate) still applies exactly as it did
 * before grouping, with no logic duplicated here. Ascending order means a
 * group holding both ends of the 13 -> 14 dependency (SAWT) always
 * resolves 13 before attempting 14.
 *
 * Stops at the first step that can't be marked done and returns its
 * error — the group's Done button is disabled ahead of time whenever a
 * required document is missing (see lib/workflow/groups.ts's
 * summarizeGroup), so reaching an error here in practice means one of the
 * other checks (election, dependency, package readiness) applies, the
 * same ones that were never surfaced as a pre-click disabled reason at
 * the single-step level either.
 */
export async function markGroupDone(filingId: string, groupCode: string): Promise<StepActionResult> {
  const group = WORKFLOW_GROUPS.find((g) => g.code === groupCode);
  if (!group) return { ok: false, error: "Unknown group." };

  const steps = await prisma.workflowStep.findMany({
    where: { filingId, stepCode: { in: group.stepCodes } },
    orderBy: { sequence: "asc" },
  });

  // Brief #4b — Prepare's own Mark done only ever has steps 3-4 left
  // (steps 1-2 self-complete), and is blocked server-side by the same
  // rule the button is disabled by client-side (lib/workflow/groups.ts's
  // prepareGroupBlockReason): a return can't be prepared without the
  // sales figure or the certificates.
  if (group.code === "PREPARE") {
    const reason = prepareGroupBlockReason(steps);
    if (reason) return { ok: false, error: reason };
  }

  for (const step of steps) {
    if (isResolved(step.status)) continue;
    const result = await markStepDone(step.id);
    if (!result.ok) return result;
  }

  return { ok: true };
}

/**
 * Brief #4b (D34) — step 2 (RECEIVE_2307) is self-completing: DONE once
 * "all certificates received" is ticked (Filing.certificatesAllReceivedAt,
 * set by lib/actions/filings.ts's setAllCertificatesReceived) AND every
 * certificate entered under this filing (Form2307.claimedOnFilingId) has
 * its own scan attached. Called after every certificate add/delete, scan
 * upload/removal, and after the checkbox itself is toggled, so the step
 * is always in sync with what's actually on file. Reverts to
 * WAITING_EXTERNAL ("waiting on client") the moment either condition
 * stops holding — this is a two-way toggle, not a one-time completion,
 * so a certificate that arrives after ticking but before filing can
 * still be added: untick, add the row and its scan, re-tick. A step
 * already SKIPPED (the bookkeeper's own by-hand decision that this
 * filing has none) is left untouched.
 */
export async function recomputeReceive2307Status(filingId: string): Promise<void> {
  const filing = await prisma.filing.findUnique({ where: { id: filingId } });
  if (!filing) return;

  const step = await prisma.workflowStep.findFirst({ where: { filingId, stepCode: "RECEIVE_2307" } });
  if (!step || step.status === "SKIPPED") return;

  const certificates = await prisma.form2307.findMany({
    where: { claimedOnFilingId: filingId, deletedAt: null },
    include: { documents: { where: { deletedAt: null } } },
  });
  const everyRowHasScan = certificates.every((c) => c.documents.length > 0);
  const isComplete = filing.certificatesAllReceivedAt != null && everyRowHasScan;

  const actorId = await getActorId();

  if (isComplete && step.status !== "DONE") {
    const clientTaxYear = await prisma.clientTaxYear.findUnique({
      where: { clientId_taxableYear: { clientId: filing.clientId, taxableYear: filing.taxableYear } },
    });
    // The election hard-blocker still applies (D27/D32) — an unconfirmed
    // Q1 election leaves step 2 not-done rather than silently completing.
    if (isElectionBlocked(filing.period, clientTaxYear?.electionStatus)) return;

    const updated = await prisma.workflowStep.update({
      where: { id: step.id },
      data: { status: "DONE", completedAt: new Date(), startedAt: step.startedAt ?? new Date(), actorId },
    });
    await logActivity({ entityType: "WorkflowStep", entityId: step.id, action: "UPDATE", before: step, after: updated, actorId });
    await recomputeFilingStatus(filingId, actorId);
    revalidatePath(`/clients/${filing.clientId}/filings/${filingId}`);
    revalidatePath("/filings");
  } else if (!isComplete && step.status !== "WAITING_EXTERNAL") {
    const updated = await prisma.workflowStep.update({
      where: { id: step.id },
      data: { status: "WAITING_EXTERNAL", waitingSince: step.waitingSince ?? new Date(), actorId },
    });
    await logActivity({ entityType: "WorkflowStep", entityId: step.id, action: "UPDATE", before: step, after: updated, actorId });
    await recomputeFilingStatus(filingId, actorId);
    revalidatePath(`/clients/${filing.clientId}/filings/${filingId}`);
    revalidatePath("/filings");
  }
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
