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
import {
  prepareGroupBlockReason,
  adviseClientBlockReason,
  FILE_GROUP_NO_START_NO_SKIP,
} from "@/lib/workflow/groups";
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
  const now = new Date();
  const updated = await prisma.workflowStep.update({
    where: { id: stepId },
    data: { status: "DONE", completedAt: now, startedAt: step.startedAt ?? now, actorId },
  });

  await logActivity({ entityType: "WorkflowStep", entityId: stepId, action: "UPDATE", before, after: updated, actorId });
  await recomputeFilingStatus(step.filingId, actorId);
  if (step.stepCode === "PREPARE_RETURN") await ensureComputationSheetSaved(step.filingId);

  // D68 (brief #5l §1, her decision) — a TRRC is always owed once the
  // return is filed. Waiting for her to click a manual "Mark waiting"
  // meant the BIR aging clock never started until she remembered to do
  // that herself, so a late TRRC could sit silently instead of reaching
  // the dashboard's red list. Step 10 (RECEIVE_TRRC) can only be PENDING
  // at this point — D67 already locks it until step 5 is Done, so it
  // can't have been touched yet — making this a one-way transition that's
  // never re-triggered by a later no-op call to this same function.
  if (step.stepCode === "FILE_RETURN") {
    const trrcStep = step.filing.workflowSteps.find((s) => s.stepCode === "RECEIVE_TRRC");
    if (trrcStep && trrcStep.status === "PENDING") {
      const trrcUpdated = await prisma.workflowStep.update({
        where: { id: trrcStep.id },
        data: { status: "WAITING_EXTERNAL", waitingSince: now, actorId },
      });
      await logActivity({
        entityType: "WorkflowStep",
        entityId: trrcStep.id,
        action: "UPDATE",
        before: trrcStep,
        after: trrcUpdated,
        actorId,
        note: "Step 10 started waiting on BIR automatically — the return was filed.",
      });
      await recomputeFilingStatus(step.filingId, actorId);
    }
  }

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
 * Brief #5i §3 — there is no group-level "Mark done" any more. A group is
 * finished only when its own steps are, and it's never marked finished
 * from the group header (her decision, reversing D32's one-click-per-
 * group and D53's clickable middle state). This function is removed
 * outright, not just its button, so nothing can bypass the per-step rules
 * through it: `prepareGroupBlockReason` still gates step 3 inside
 * `markStepDone` above, but nothing calls it as a group-level gate any
 * more. Every step in every group still has its own way to finish — the
 * per-step "Mark done" (or self-completion, for steps 1/2) below — so a
 * group resolves the moment its last step does, with no click of its own.
 */

/**
 * Brief #5i §1/§2 — restores a Skipped step 2 (RECEIVE_2307) to whatever
 * its own derived rule says it should be, never forcing a fixed status.
 * Shared by the manual "Undo skip" action (unskipStep below) and the
 * automatic reopening a sales edit triggers (lib/actions/quarterlySales.ts)
 * — a different income figure may mean a certificate she didn't expect,
 * her decision. No-ops if the step isn't currently Skipped. The caller is
 * responsible for the step-5-filed lock where that applies: unskipStep
 * checks it explicitly; the automatic path doesn't need to, since a filed
 * filing never reaches this function's callers in the first place (D50's
 * own guards on the figures-changing saves already stop there).
 */
export async function reopenSkippedReceive2307(filingId: string, actorId: string, note: string): Promise<void> {
  const step = await prisma.workflowStep.findFirst({ where: { filingId, stepCode: "RECEIVE_2307" } });
  if (!step || step.status !== "SKIPPED") return;

  const updated = await prisma.workflowStep.update({
    where: { id: step.id },
    data: { status: "WAITING_EXTERNAL", waitingSince: new Date(), skippedReason: null, actorId },
  });
  await logActivity({ entityType: "WorkflowStep", entityId: step.id, action: "UPDATE", before: step, after: updated, actorId, note });
  // Settles the step into WAITING_EXTERNAL or DONE based on the real
  // certificate state — never assumed here, always derived.
  await recomputeReceive2307Status(filingId);
}

/**
 * Brief #5i §1 — "Undo skip" on a skipped step. First checked: no unskip
 * action existed anywhere in the codebase before this brief (confirmed by
 * grep). Refused once the filing's own step 5 (FILE_RETURN) is Done — the
 * same lock step 2's certificate list already has (D34/D11) — so a
 * decision made before filing can't be silently reopened after. The skip
 * reason is never silently discarded: it's captured in the ActivityLog
 * "before" snapshot this writes, even though the live row's own
 * `skippedReason` is cleared once the step is no longer Skipped.
 */
export async function unskipStep(stepId: string): Promise<StepActionResult> {
  const step = await prisma.workflowStep.findUnique({
    where: { id: stepId },
    include: { filing: { include: { workflowSteps: true } } },
  });
  if (!step) return { ok: false, error: "Step not found." };
  if (step.status !== "SKIPPED") return { ok: false, error: "This step isn't skipped." };

  const fileReturnStep = step.filing.workflowSteps.find((s) => s.stepCode === "FILE_RETURN");
  if (fileReturnStep?.status === "DONE") {
    return { ok: false, error: "This filing has already been filed — a skipped step can no longer be undone." };
  }

  const actorId = await getActorId();

  if (step.stepCode === "RECEIVE_2307") {
    await reopenSkippedReceive2307(step.filingId, actorId, "Step 2 un-skipped by the bookkeeper.");
    // D50 — undoing step 2's skip is a figures change, exactly like
    // adding or removing a certificate: it reopens steps 3/4 while the
    // filing is unfiled (a no-op here otherwise, since FILE_RETURN isn't
    // Done — already checked above).
    await reopenPreparedFiling(step.filingId);
  } else {
    // Every other skippable step (5-16, excluding step 3 which can't be
    // skipped at all) has no derived rule of its own — PENDING is its
    // ordinary starting point, the same state it was in before it was
    // ever skipped.
    const updated = await prisma.workflowStep.update({
      where: { id: stepId },
      data: { status: "PENDING", skippedReason: null, actorId },
    });
    await logActivity({ entityType: "WorkflowStep", entityId: stepId, action: "UPDATE", before: step, after: updated, actorId });
  }

  await recomputeFilingStatus(step.filingId, actorId);
  revalidatePath(`/clients/${step.filing.clientId}/filings/${step.filingId}`);
  revalidatePath("/filings");

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

/**
 * D67 (brief #5k §4) — steps 6, 7 and 10 (SAVE_SUBMISSION_SS,
 * SAVE_FORM_COPY, RECEIVE_TRRC) are self-completing the same way step 2
 * is (D46): each carries exactly one required doc slot, and attaching
 * its document marks the step DONE directly, with no separate "Mark
 * done" left to click. Called after every upload/removal against one of
 * these three steps (lib/actions/documents.ts's saveDocumentForStep /
 * deleteDocument). Reverts to PENDING if the document is removed (or
 * replaced away without a replacement) and none remains — a step whose
 * only file just vanished isn't done, the same PENDING state it started
 * in (§4.4). **Brief #5l §1 (D68) exception: RECEIVE_TRRC (step 10)
 * reverts to WAITING_EXTERNAL instead, never PENDING** — a TRRC is still
 * owed once the return is filed, so losing the file just means it hasn't
 * arrived (again); waitingSince is reset to step 5's (FILE_RETURN) own
 * `completedAt` on this same filing — a reliable existing record of when
 * the return was actually filed, not "now," so the aging clock measures
 * from filing, not from whenever the file happened to be removed. The
 * election hard-blocker (D27) still applies to the completing branch,
 * mirroring recomputeReceive2307Status's own check: an unconfirmed Q1
 * election leaves the step un-done regardless of what's attached, since
 * these three steps bypass markStepDone's own check entirely by
 * completing themselves here instead.
 */
export async function recomputeFileGroupDocStepStatus(stepId: string): Promise<void> {
  const step = await prisma.workflowStep.findUnique({
    where: { id: stepId },
    include: { filing: true, documents: { where: { deletedAt: null } } },
  });
  if (!step) return;

  const hasDoc = step.documents.length > 0;
  const actorId = await getActorId();

  if (hasDoc && step.status !== "DONE") {
    const clientTaxYear = await prisma.clientTaxYear.findUnique({
      where: { clientId_taxableYear: { clientId: step.filing.clientId, taxableYear: step.filing.taxableYear } },
    });
    if (isElectionBlocked(step.filing.period, clientTaxYear?.electionStatus)) return;

    const updated = await prisma.workflowStep.update({
      where: { id: step.id },
      data: {
        status: "DONE",
        completedAt: new Date(),
        startedAt: step.startedAt ?? new Date(),
        // D68 (brief #5l §1) — an upload completing step 10 clears its
        // waitingSince along with the status; harmless no-op for 6/7,
        // which never have one set in the first place.
        waitingSince: null,
        actorId,
      },
    });
    await logActivity({ entityType: "WorkflowStep", entityId: step.id, action: "UPDATE", before: step, after: updated, actorId });
    await recomputeFilingStatus(step.filingId, actorId);
    revalidatePath(`/clients/${step.filing.clientId}/filings/${step.filingId}`);
    revalidatePath("/filings");
  } else if (!hasDoc && step.status === "DONE") {
    let updated;
    if (step.stepCode === "RECEIVE_TRRC") {
      const fileReturnStep = await prisma.workflowStep.findFirst({
        where: { filingId: step.filingId, stepCode: "FILE_RETURN" },
      });
      updated = await prisma.workflowStep.update({
        where: { id: step.id },
        data: {
          status: "WAITING_EXTERNAL",
          completedAt: null,
          waitingSince: fileReturnStep?.completedAt ?? new Date(),
          actorId,
        },
      });
    } else {
      updated = await prisma.workflowStep.update({
        where: { id: step.id },
        data: { status: "PENDING", completedAt: null, actorId },
      });
    }
    await logActivity({ entityType: "WorkflowStep", entityId: step.id, action: "UPDATE", before: step, after: updated, actorId });
    await recomputeFilingStatus(step.filingId, actorId);
    revalidatePath(`/clients/${step.filing.clientId}/filings/${step.filingId}`);
    revalidatePath("/filings");
  }
}

export async function markStepInProgress(stepId: string): Promise<StepActionResult> {
  const step = await prisma.workflowStep.findUnique({ where: { id: stepId }, include: { filing: true } });
  if (!step) return { ok: false, error: "Step not found." };

  // D65 (brief #5k §2) — steps 5-7/10 have no Start, enforced here so it
  // can't be bypassed by calling this action directly (the same
  // reasoning as step 3's own PREPARE_RETURN checks elsewhere in this
  // file).
  if (FILE_GROUP_NO_START_NO_SKIP.includes(step.stepCode)) {
    return { ok: false, error: "This step has no separate 'in progress' state — it's marked done directly." };
  }

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

  // D68 (brief #5l §1) — step 10 (RECEIVE_TRRC) no longer has a manual
  // Mark waiting: it enters WAITING_EXTERNAL by itself the moment step 5
  // is marked Done (markStepDone's own FILE_RETURN branch above), so
  // there's nothing left for a manual click to do. Refused here, not
  // just by removing the button, so it can't be bypassed by calling this
  // action directly.
  if (step.stepCode === "RECEIVE_TRRC") {
    return {
      ok: false,
      error: "Step 10 starts waiting on BIR automatically once step 5 (file the return) is done — there's no manual Mark waiting any more.",
    };
  }

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

  // Brief #5f §1 — step 3 (PREPARE_RETURN) can no longer be skipped at
  // all; it's the heart of the app. Enforced here, not just by the UI
  // removing the Skip control, so it can't be bypassed by calling this
  // action directly.
  if (step.stepCode === "PREPARE_RETURN") {
    return { ok: false, error: "Step 3 (prepare the return) can't be skipped — only marked done." };
  }

  // D65 (brief #5k §2) — steps 5, 6, 7 and 10 (File group) can't be
  // skipped either, the bookkeeper's decision: File is a fixed sequence
  // of documents she always needs, not one with a step that might not
  // apply. Enforced here, not just by the UI removing the Skip control.
  if (FILE_GROUP_NO_START_NO_SKIP.includes(step.stepCode)) {
    return { ok: false, error: "This step can't be skipped — only marked done." };
  }

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
