"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import { deriveFilingStatus } from "@/lib/workflow/status";
import { ensureComputationSheetSaved } from "@/lib/documents/computationSheet";
import { missingRequiredSlots, checkSendClientPackageReadiness } from "@/lib/workflow/docSlots";
import { parseDocSlots } from "@/lib/workflow/types";
import {
  prepareGroupBlockReason,
  prepareFinishedBlockReason,
  adviseClientBlockReason,
  payGroupBlockReason,
  NO_START_NO_SKIP_STEP_CODES,
  BIR_CONFIRMATIONS_UNLOCK_STEP_CODE,
  BIR_WAIT_STEP_CODES,
  EAFS_SELF_COMPLETING_STEP_CODES,
  groupForStepCode,
  stepLockReason,
} from "@/lib/workflow/groups";
import { loadFilingOrderBlockReason } from "@/lib/workflow/filingOrderData";
import { RECEIVE_2307_SKIPPED_TEXT } from "@/lib/workflow/receive2307";
import { FILING_LOCKED_MESSAGE, filingLockedReason, isFilingComplete } from "@/lib/workflow/filingLock";
import { buildESubmissionEmail } from "@/lib/workflow/eSubmissionEmail";
import { buildClientPackageEmailForFiling } from "@/lib/workflow/clientPackageEmailData";
import { buildLiveAdviceMessageForFiling } from "@/lib/workflow/adviceMessage";
import { Prisma } from "@prisma/client";
import { getFilingSheet, readFilingSheet } from "@/lib/filingComputation";
import type { FilingComputationResult, Period } from "@/lib/tax/types";

export type StepActionResult = { ok: boolean; error?: string };

/**
 * Filing.status is derived from its steps, never set by hand (SPEC.md
 * 7.2). Every step mutation below recomputes it as its last write.
 */
async function recomputeFilingStatus(filingId: string, actorId: string): Promise<void> {
  const filing = await prisma.filing.findUniqueOrThrow({ where: { id: filingId } });
  const steps = await prisma.workflowStep.findMany({ where: { filingId } });
  const status = deriveFilingStatus({
    steps: steps.map((s) => ({ stepCode: s.stepCode, status: s.status, waitingOnLabel: s.waitingOnLabel })),
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
 * One thing is checked ahead of the document gate (D136 removed the 8%
 * election lock — every client is 8% elected):
 *   Step 13 -> 14 (D29): a validation email cannot arrive before the
 *      acknowledgement it follows, so SAWT_VALIDATION stays blocked while
 *      SAWT_ACK is unresolved. One explicit edge, not a general
 *      "waiting blocks the next step" rule.
 * SEND_CLIENT_PACKAGE's own dependency check (steps 7/9/10/13 must each
 * have their document, SPEC.md 7.1) runs before its own (now nonexistent)
 * slot would, so its specific "what's missing" message isn't masked.
 */
export async function markStepDone(stepId: string): Promise<StepActionResult> {
  const step = await prisma.workflowStep.findUnique({
    where: { id: stepId },
    include: { documents: true, filing: { include: { workflowSteps: { include: { documents: true } } } } },
  });
  if (!step) return { ok: false, error: "Step not found." };
  // D153 — a Complete filing is read-only for good.
  if (isFilingComplete(step.filing)) return { ok: false, error: FILING_LOCKED_MESSAGE };

  // D86/D88 (brief #5o §4) — steps 11 and 13 complete themselves when their
  // document(s) are saved; there is no Mark done to click, refused here so
  // it can't be bypassed by calling this action directly.
  if (EAFS_SELF_COMPLETING_STEP_CODES.includes(step.stepCode)) {
    return { ok: false, error: `Step ${step.sequence} completes by itself once its file${step.stepCode === "ALPHALIST_ENTRY" ? "s are" : " is"} saved — there's no Mark done.` };
  }

  // D85 (brief #5o §3) — the eAFS group (11, 12, 13, 15) opens only once File
  // and Pay are Done; step 12 also needs step 11. Enforced here for every
  // step in the group. A step that doesn't apply (no Form 2307, D93) can't be worked at all.
  if (groupForStepCode(step.stepCode)?.code === "EAFS") {
    if (step.status === "NA") return { ok: false, error: "This step doesn't apply — there's no Form 2307 on this filing." };
    const lock = stepLockReason(step.stepCode, step.filing.workflowSteps);
    if (lock) return { ok: false, error: lock };
  }

  // D95 (brief #5q, her decision) — quarters are filed in order. Step 5 is
  // refused while any earlier return of this client-year is unfiled; checked
  // before anything is written (including D83's snapshot transaction below),
  // so it holds when the action is called directly.
  if (step.stepCode === "FILE_RETURN") {
    // D100 (brief #5r) — step 5 waits for all of Prepare; shown ahead of the filing-order reason.
    const prepareReason = prepareFinishedBlockReason(step.filing.workflowSteps);
    if (prepareReason) return { ok: false, error: prepareReason };
    const reason = await loadFilingOrderBlockReason(step.filing);
    if (reason) return { ok: false, error: reason };
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
  if (step.stepCode === "ADVISE_CLIENT") {
    const reason = adviseClientBlockReason(step.filing.workflowSteps);
    if (reason) return { ok: false, error: reason };
  }

  // D75 (brief #5m §3.1) — step 8 (MAKE_PAYMENT) requires File (steps 5,
  // 6, 7) to be Done first, enforced here so it can't be bypassed by
  // calling this action directly.
  if (step.stepCode === "MAKE_PAYMENT") {
    const reason = payGroupBlockReason(step.filing.workflowSteps);
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
  // D83 (brief #5o) — step 5 is the moment a return is filed, so it is the
  // moment its figures freeze: the full computation result is written to
  // Filing.computationSnapshot in the SAME transaction that marks the step
  // Done. The write only ever lands on a filing whose snapshot is still null,
  // so nothing — not even marking step 5 Done twice — can overwrite it.
  let filingSheet: FilingComputationResult | null = null;
  if (step.stepCode === "FILE_RETURN") {
    filingSheet = await readFilingSheet(step.filing);
  }
  const doneData = { status: "DONE" as const, completedAt: now, startedAt: step.startedAt ?? now, actorId };
  const updated =
    step.stepCode === "FILE_RETURN" && filingSheet
      ? (
          await prisma.$transaction([
            prisma.workflowStep.update({ where: { id: stepId }, data: doneData }),
            prisma.filing.updateMany({
              where: { id: step.filingId, computationSnapshot: { equals: Prisma.DbNull } },
              data: { computationSnapshot: JSON.stringify(filingSheet), filedAt: now },
            }),
          ])
        )[0]
      : await prisma.workflowStep.update({ where: { id: stepId }, data: doneData });

  await logActivity({ entityType: "WorkflowStep", entityId: stepId, action: "UPDATE", before, after: updated, actorId });
  await recomputeFilingStatus(step.filingId, actorId);
  if (step.stepCode === "PREPARE_RETURN") await ensureComputationSheetSaved(step.filingId);

  // D68 (brief #5l §1, her decision, extended to step 14 by D71/brief
  // #5m §2) — a TRRC is always owed once the return is filed, and a
  // validation email is always owed once the acknowledgement is in.
  // Waiting for her to click a manual "Mark waiting" meant the BIR aging
  // clock never started until she remembered to do that herself, so a
  // late document could sit silently instead of reaching the dashboard's
  // red list. RECEIVE_TRRC/SAWT_VALIDATION can only be PENDING at this
  // point — D67/D71 already lock them until their own gating step is
  // Done, so neither can have been touched yet — making this a one-way
  // transition that's never re-triggered by a later no-op call to this
  // same function.
  await startGatedBirWaits(step.filingId, step.stepCode, actorId, now);

  // D76 (brief #5m §3.4, her decision) — "nothing to pay" makes steps 8
  // and 9 (MAKE_PAYMENT, SAVE_PROOF_PAYMENT) NA automatically, at the
  // instant step 5 (FILE_RETURN) is marked Done — no clicks needed. This
  // is meant to key off the frozen computationSnapshot (it's set "when
  // the snapshot freezes"), but the production markStepDone path has
  // never actually written that field (confirmed by grep — only
  // prisma/seed.ts does, a pre-existing gap this brief did not create and
  // was not asked to close); a live recomputation at this exact moment is
  // the equivalent read. An overpayment or exactly ₱0 payable means
  // nothing is ever owed for this return, so both steps skip straight to
  // Not applicable rather than sitting PENDING with nothing to do.
  if (step.stepCode === "FILE_RETURN") {
    // D83 — reads the frozen result (just written above, or already there), never a fresh computation.
    const sheet = filingSheet ?? (await getFilingSheet(step.filingId));
    if (sheet.isOverpayment || sheet.taxPayableCents === 0) {
      for (const payStepCode of ["MAKE_PAYMENT", "SAVE_PROOF_PAYMENT"]) {
        const payStep = step.filing.workflowSteps.find((s) => s.stepCode === payStepCode);
        if (!payStep || payStep.status !== "PENDING") continue;
        const payUpdated = await prisma.workflowStep.update({
          where: { id: payStep.id },
          data: { status: "NA", actorId },
        });
        await logActivity({
          entityType: "WorkflowStep",
          entityId: payStep.id,
          action: "UPDATE",
          before: payStep,
          after: payUpdated,
          actorId,
          note: "Nothing to pay on this return — marked not applicable automatically.",
        });
      }
      await recomputeFilingStatus(step.filingId, actorId);
    }
  }

  if (step.stepCode === "EMAIL_DAT") await saveDataEmailDraft(step.filingId);

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

  // D101 (brief #5r) — step 16's email is saved exactly as it stood when she
  // marked it Done (D51's pattern), so the collapsed card shows what was sent.
  if (step.stepCode === "SEND_CLIENT_PACKAGE") await saveClientPackageEmail(step.filingId);

  revalidatePath(`/clients/${step.filing.clientId}/filings/${step.filingId}`);
  revalidatePath("/filings");

  return { ok: true };
}

async function saveClientPackageEmail(filingId: string): Promise<void> {
  const email = await buildClientPackageEmailForFiling(filingId);
  if (!email) return;
  await prisma.filing.update({
    where: { id: filingId },
    data: {
      clientPackageEmailTo: email.to,
      clientPackageEmailSubject: email.subject,
      clientPackageEmailBody: email.body,
      clientPackageEmailSavedAt: new Date(),
    },
  });
}

/**
 * D68/D71/D88 — the moment a step that gates a BIR wait is Done, the gated
 * step (if still PENDING) starts waiting on BIR by itself, `waitingSince`
 * stamped to that instant: step 5 -> 10, step 12 -> 13, step 13 -> 14. Used
 * by markStepDone AND by recomputeFileGroupDocStepStatus, since step 13 now
 * completes through an upload (not a Mark done) and must still start step
 * 14's wait. A one-way transition — it only ever touches a PENDING step.
 */
async function startGatedBirWaits(filingId: string, doneStepCode: string, actorId: string, now: Date): Promise<void> {
  for (const [gatedStepCode, gatingStepCode] of Object.entries(BIR_CONFIRMATIONS_UNLOCK_STEP_CODE)) {
    if (doneStepCode !== gatingStepCode) continue;
    const gatedStep = await prisma.workflowStep.findFirst({ where: { filingId, stepCode: gatedStepCode } });
    if (!gatedStep || gatedStep.status !== "PENDING") continue;
    const gatedUpdated = await prisma.workflowStep.update({
      where: { id: gatedStep.id },
      data: { status: "WAITING_EXTERNAL", waitingSince: now, actorId },
    });
    await logActivity({
      entityType: "WorkflowStep",
      entityId: gatedStep.id,
      action: "UPDATE",
      before: gatedStep,
      after: gatedUpdated,
      actorId,
      note: `Step ${gatedUpdated.sequence} started waiting on BIR automatically.`,
    });
    await recomputeFilingStatus(filingId, actorId);
  }
}

/**
 * D87 (brief #5o §4) — when step 12 is marked Done, the exact eSubmission
 * email draft (to, subject, body) is saved on the filing, the same pattern
 * as step 4's advice message (D51): the card then shows what was actually
 * sent, never a rebuild from since-changed client details.
 */
async function saveDataEmailDraft(filingId: string): Promise<void> {
  const filing = await prisma.filing.findUnique({ where: { id: filingId }, include: { client: true } });
  if (!filing) return;
  const ruleSet = await prisma.taxRuleSet.findUnique({ where: { taxableYear: filing.taxableYear } });
  const email = buildESubmissionEmail({
    toAddress: ruleSet?.eSubmissionEmail ?? "",
    period: filing.period as Period,
    taxableYear: filing.taxableYear,
    formType: filing.formType,
    registeredName: filing.client.registeredName,
    tin: filing.client.tin,
    branchCode: filing.client.branchCode,
    rdoCode: filing.client.rdoCode,
  });
  await prisma.filing.update({
    where: { id: filingId },
    data: { dataEmailTo: email.to, dataEmailSubject: email.subject, dataEmailBody: email.body, dataEmailSavedAt: new Date() },
  });
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
  if (isFilingComplete(filing)) return; // D153 — a Complete filing is never reopened (it is filed too, so this was already a no-op)

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
  if (await filingLockedReason(filingId)) return; // D153 — a Complete filing's skipped step 2 stays skipped
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
  // D153 — a Complete filing is read-only for good.
  if (isFilingComplete(step.filing)) return { ok: false, error: FILING_LOCKED_MESSAGE };
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
  if (isFilingComplete(filing)) return; // D153 — nothing re-derives a Complete filing's steps

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
 * D67/D71/D75 — every self-completing doc step (SAVE_SUBMISSION_SS,
 * SAVE_FORM_COPY, SAVE_PROOF_PAYMENT, RECEIVE_TRRC, SAWT_VALIDATION) is
 * self-completing the same way step 2 is (D46): each carries exactly one
 * required doc slot, and attaching its document marks the step DONE
 * directly, with no separate "Mark done" left to click. Called after
 * every upload/removal against one of these steps
 * (lib/actions/documents.ts's saveDocumentForStep / deleteDocument).
 * Reverts to PENDING if the document is removed (or replaced away without
 * a replacement) and none remains — a step whose only file just vanished
 * isn't done, the same PENDING state it started in (§4.4). **D68/D71
 * exception: RECEIVE_TRRC and SAWT_VALIDATION revert to WAITING_EXTERNAL
 * instead, never PENDING** (BIR_CONFIRMATIONS_UNLOCK_STEP_CODE names which
 * steps this applies to) — a TRRC or a validation email is still owed
 * once its own gating step is Done, so losing the file just means it
 * hasn't arrived (again); waitingSince is reset to the gating step's own
 * `completedAt` on this same filing — a reliable existing record of when
 * that happened, not "now," so the aging clock measures from the actual
 * event, not from whenever the file happened to be removed.
 */
export async function recomputeFileGroupDocStepStatus(stepId: string): Promise<void> {
  const step = await prisma.workflowStep.findUnique({
    where: { id: stepId },
    include: { filing: true, documents: { where: { deletedAt: null } } },
  });
  if (!step) return;
  if (isFilingComplete(step.filing)) return; // D153 — nothing re-derives a Complete filing's steps

  // D86 — a step with more than one required slot (step 11: generated report
  // AND DAT file) is complete only when EVERY required slot has a file.
  // Single-slot steps behave exactly as before.
  const hasDoc =
    step.documents.length > 0 && missingRequiredSlots(parseDocSlots(step.requiredDocSlots), step.documents).length === 0;
  const actorId = await getActorId();

  if (hasDoc && step.status !== "DONE") {
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
    // D71/D88 — a step completed by an upload can be the gate for the next BIR wait (13 -> 14).
    await startGatedBirWaits(step.filingId, step.stepCode, actorId, new Date());
    revalidatePath(`/clients/${step.filing.clientId}/filings/${step.filingId}`);
    revalidatePath("/filings");
  } else if (!hasDoc && step.status === "DONE") {
    let updated;
    const unlockStepCode = BIR_CONFIRMATIONS_UNLOCK_STEP_CODE[step.stepCode];
    if (unlockStepCode) {
      const unlockStep = await prisma.workflowStep.findFirst({
        where: { filingId: step.filingId, stepCode: unlockStepCode },
      });
      updated = await prisma.workflowStep.update({
        where: { id: step.id },
        data: {
          status: "WAITING_EXTERNAL",
          completedAt: null,
          waitingSince: unlockStep?.completedAt ?? new Date(),
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
  // D153 — a Complete filing is read-only for good.
  if (isFilingComplete(step.filing)) return { ok: false, error: FILING_LOCKED_MESSAGE };

  // D65/D75 (briefs #5k §2, #5m §3) — steps 5-7/10 (File/BIR
  // Confirmations) and 8-9 (Pay) have no Start, enforced here so it can't
  // be bypassed by calling this action directly (the same reasoning as
  // step 3's own PREPARE_RETURN checks elsewhere in this file).
  if (NO_START_NO_SKIP_STEP_CODES.includes(step.stepCode)) {
    return { ok: false, error: "This step has no separate 'in progress' state — it's marked done directly." };
  }

  // D98 (brief #5q) — steps 1 and 4 have no Start on their cards (D33, D51);
  // refused here so it can't be bypassed by calling this action directly.
  // (Step 1's income save drives it through markStepDone, not through here.)
  if (step.stepCode === "RECORD_SALES" || step.stepCode === "ADVISE_CLIENT") {
    return { ok: false, error: `Step ${step.sequence} can't be started separately — it's marked done directly.` };
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
  // D153 — a Complete filing is read-only for good.
  if (isFilingComplete(step.filing)) return { ok: false, error: FILING_LOCKED_MESSAGE };

  // D68/D71 (briefs #5l §1, #5m §2) — steps 10 (RECEIVE_TRRC) and 14
  // (SAWT_VALIDATION) no longer have a manual Mark waiting: each enters
  // WAITING_EXTERNAL by itself the moment its own gating step is Done
  // (markStepDone's own loop over BIR_CONFIRMATIONS_UNLOCK_STEP_CODE
  // above), so there's nothing left for a manual click to do. Refused
  // here, not just by removing the button, so it can't be bypassed by
  // calling this action directly.
  if (step.stepCode === "RECEIVE_TRRC" || step.stepCode === "SAWT_VALIDATION" || step.stepCode === "SAWT_ACK") {
    return {
      ok: false,
      error: `Step ${step.sequence} starts waiting on BIR automatically once its own earlier step is done — there's no manual Mark waiting any more.`,
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
  const step = await prisma.workflowStep.findUnique({ where: { id: stepId }, include: { filing: true } });
  if (!step) return { ok: false, error: "Step not found." };
  // D157 — step 2's skip needs no typed reason: it always stores the one fixed wording.
  if (step.stepCode === "RECEIVE_2307") reason = RECEIVE_2307_SKIPPED_TEXT;
  if (!reason.trim()) return { ok: false, error: "A reason is required to skip a step." };
  // D153 — a Complete filing is read-only for good.
  if (isFilingComplete(step.filing)) return { ok: false, error: FILING_LOCKED_MESSAGE };

  // Brief #5f §1 — step 3 (PREPARE_RETURN) can no longer be skipped at
  // all; it's the heart of the app. Enforced here, not just by the UI
  // removing the Skip control, so it can't be bypassed by calling this
  // action directly.
  if (step.stepCode === "PREPARE_RETURN") {
    return { ok: false, error: "Step 3 (prepare the return) can't be skipped — only marked done." };
  }

  // D98 (brief #5q) — steps 1 and 4 can't be skipped either: neither card has
  // a Skip button, and now the action refuses too, the way D54 does for step 3.
  if (step.stepCode === "RECORD_SALES") {
    return { ok: false, error: "Step 1 (quarterly sales) can't be skipped — it's completed by saving the quarter's sales." };
  }
  if (step.stepCode === "ADVISE_CLIENT") {
    return { ok: false, error: "Step 4 (advise the client) can't be skipped — only marked done." };
  }

  // D65/D75 (briefs #5k §2, #5m §3) — steps 5, 6, 7, 10 (File/BIR
  // Confirmations) and 8, 9 (Pay) can't be skipped either, the
  // bookkeeper's decision: each is a fixed sequence of documents/actions
  // she always needs, not one with a step that might not apply. Enforced
  // here, not just by the UI removing the Skip control.
  if (NO_START_NO_SKIP_STEP_CODES.includes(step.stepCode)) {
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
  // D153 — a Complete filing is read-only for good.
  if (isFilingComplete(step.filing)) return { ok: false, error: FILING_LOCKED_MESSAGE };

  // D72 (brief #5m §2, her decision) — no Log follow-up on any BIR wait
  // (steps 10, 13, 14): she can't follow up with BIR on any of these. The
  // button is gone from every card that shows one of these steps; refused
  // here too so it can't be bypassed by calling this action directly.
  if (BIR_WAIT_STEP_CODES.includes(step.stepCode)) {
    return { ok: false, error: "There's no follow-up to log with BIR — this step just waits." };
  }

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
