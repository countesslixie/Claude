import { isResolved } from "./status";
import { missingRequiredSlots, type AttachedDocument, type DocSlotLike } from "./docSlots";
import type { WorkflowStepStatus } from "./types";
import { centsToPesos } from "@/lib/money";

/**
 * Brief #4a — the sixteen steps wrapped in groups. This changes nothing
 * about what any step does or requires; it only changes where "mark done"
 * and the board's columns sit. Group membership is a fixed lookup table,
 * not the `category` field: reusing `category` outright would have put
 * step 4 (ADVISE_CLIENT, category CLIENT_COMM) in Close alongside step 16
 * (also CLIENT_COMM) when it actually belongs in Prepare, and vice versa
 * for step 15 (ATTACHMENT) vs step 16.
 *
 * D70 (brief #5m §1, her decision) — SIX groups, supersedes D32's table of
 * five. Steps 10 (RECEIVE_TRRC) and 14 (SAWT_VALIDATION) — the two things
 * she only ever WAITS to receive from BIR, with nothing downstream
 * depending on either — move out of File and SAWT respectively into their
 * own new group, BIR Confirmations, which sits after every group that is
 * her own work (Prepare, File, Pay, eAFS) and before Client package (which
 * needs both BIR documents). "eAFS" (her chosen name for group 4) keeps
 * its name even though it also holds the SAWT steps (11, 12, 13) —
 * renaming it to include "SAWT" was declined.
 *
 * Step numbers are NOT renumbered to make groups contiguous (DECISIONS.md
 * D32, unaffected by D70): step numbers record sequence: File — steps 5,
 * 6, 7 — still sits ahead of Pay (8, 9) numerically even though BIR
 * Confirmations (10, 14) is now a later GROUP than either. Groups record
 * meaning, not sequence.
 */
export type GroupCode = "PREPARE" | "FILE" | "PAY" | "EAFS" | "BIR_CONFIRMATIONS" | "CLIENT_PACKAGE";

export interface WorkflowGroupDef {
  code: GroupCode;
  name: string;
  /** stepCodes in this group's own display order (numeric step order). */
  stepCodes: string[];
}

export const WORKFLOW_GROUPS: WorkflowGroupDef[] = [
  { code: "PREPARE", name: "Prepare", stepCodes: ["RECORD_SALES", "RECEIVE_2307", "PREPARE_RETURN", "ADVISE_CLIENT"] },
  { code: "FILE", name: "File", stepCodes: ["FILE_RETURN", "SAVE_SUBMISSION_SS", "SAVE_FORM_COPY"] },
  { code: "PAY", name: "Pay", stepCodes: ["MAKE_PAYMENT", "SAVE_PROOF_PAYMENT"] },
  { code: "EAFS", name: "eAFS", stepCodes: ["ALPHALIST_ENTRY", "EMAIL_DAT", "SAWT_ACK", "EAFS_SUBMIT"] },
  { code: "BIR_CONFIRMATIONS", name: "BIR Confirmations", stepCodes: ["RECEIVE_TRRC", "SAWT_VALIDATION"] },
  { code: "CLIENT_PACKAGE", name: "Client package", stepCodes: ["SEND_CLIENT_PACKAGE"] },
];

export function groupForStepCode(stepCode: string): WorkflowGroupDef | undefined {
  return WORKFLOW_GROUPS.find((g) => g.stepCodes.includes(stepCode));
}

/**
 * D65 (brief #5k §2) — steps 5, 6, 7 and 10 have no Start and no Skip.
 * File is a document-and-filing sequence she works through in a fixed
 * order (file it, save the screenshot, save the form copy) — there's no
 * decision point in it worth a written skip reason, unlike MAKE_PAYMENT or
 * the SAWT steps. Step 10 stays in this list even after D70 moved it out
 * of the File group — the no-Start/no-Skip rule is about the step itself,
 * not its group. Enforced server-side in skipStep and markStepInProgress
 * (lib/actions/workflowSteps.ts), not just by the UI removing the
 * controls.
 */
export const FILE_GROUP_NO_START_NO_SKIP: readonly string[] = [
  "FILE_RETURN",
  "SAVE_SUBMISSION_SS",
  "SAVE_FORM_COPY",
  "RECEIVE_TRRC",
];

/**
 * D75 (brief #5m §3) — steps 8 and 9 (MAKE_PAYMENT, SAVE_PROOF_PAYMENT)
 * have no Start and no Skip either, her decision, the same reasoning as
 * FILE_GROUP_NO_START_NO_SKIP above (a fixed sequence, not a decision
 * point). Named separately since Pay is its own group, not File.
 */
export const PAY_GROUP_NO_START_NO_SKIP: readonly string[] = ["MAKE_PAYMENT", "SAVE_PROOF_PAYMENT"];

/**
 * D67 (brief #5k §4) — steps 6 and 7 (SAVE_SUBMISSION_SS, SAVE_FORM_COPY):
 * each carries exactly one required doc slot, unlocks only once step 5
 * (FILE_RETURN) is Done, and completes itself the moment that slot's
 * document is attached — the file IS the step (D27), the same reasoning
 * RECEIVE_2307 already applies (D46). Step 10 (RECEIVE_TRRC) and step 14
 * (SAWT_VALIDATION) share this same self-completing shape but are listed
 * separately below (BIR_CONFIRMATIONS_SELF_COMPLETING_STEP_CODES) since
 * D70 moved them into their own group with their own automatic-waiting
 * behavior (D68/D71); step 9 (SAVE_PROOF_PAYMENT) shares the shape too but
 * is listed under PAY_SELF_COMPLETING_STEP_CODES (D75), since it unlocks
 * on step 8, not step 5. All four lists are consulted together wherever
 * the upload action needs to know "is this one of the self-completing doc
 * steps" (lib/actions/documents.ts).
 */
export const FILE_GROUP_SELF_COMPLETING_STEP_CODES: readonly string[] = ["SAVE_SUBMISSION_SS", "SAVE_FORM_COPY"];

/**
 * D71 (brief #5m §2, her decision) — step 14 (SAWT_VALIDATION) behaves
 * exactly like step 10 (RECEIVE_TRRC) always has: locked until its
 * predecessor step is Done, then waits on BIR automatically, and completes
 * itself the moment its document is attached. Both live here together —
 * lib/actions/workflowSteps.ts's recomputeFileGroupDocStepStatus (still
 * named for the File-group pattern it originated from, even though these
 * two are no longer IN the File group after D70) is the shared
 * self-completing/auto-waiting machinery both steps use.
 */
export const BIR_CONFIRMATIONS_SELF_COMPLETING_STEP_CODES: readonly string[] = ["RECEIVE_TRRC", "SAWT_VALIDATION"];

/** The step that must be Done before each of BIR_CONFIRMATIONS_SELF_COMPLETING_STEP_CODES unlocks and starts waiting automatically. */
export const BIR_CONFIRMATIONS_UNLOCK_STEP_CODE: Record<string, string> = {
  RECEIVE_TRRC: "FILE_RETURN",
  SAWT_VALIDATION: "SAWT_ACK",
};

/**
 * D75 (brief #5m §3.3) — step 9 (SAVE_PROOF_PAYMENT) unlocks once step 8
 * (MAKE_PAYMENT) is Done, shows its upload box directly, and completes
 * itself on upload — the same shape D67 gave steps 6/7, just gated on step
 * 8 instead of step 5. Unlike step 10/14, it never enters
 * WAITING_EXTERNAL on its own (§3.3: "Do not make step 9 enter
 * WAITING_EXTERNAL") — Pay's own header line is what tells her it's
 * outstanding, not a waiting badge on the step itself.
 */
export const PAY_SELF_COMPLETING_STEP_CODES: readonly string[] = ["SAVE_PROOF_PAYMENT"];

/** The step that must be Done before each of PAY_SELF_COMPLETING_STEP_CODES unlocks. */
export const PAY_UNLOCK_STEP_CODE: Record<string, string> = {
  SAVE_PROOF_PAYMENT: "MAKE_PAYMENT",
};

/**
 * Every self-completing document step across the whole workflow — steps
 * 6, 7 (File), 9 (Pay), 10, 14 (BIR Confirmations) — for callers
 * (lib/actions/documents.ts) that just need "is this one of the steps
 * where the file IS the step" without caring which group it's in.
 */
export const SELF_COMPLETING_DOC_STEP_CODES: readonly string[] = [
  ...FILE_GROUP_SELF_COMPLETING_STEP_CODES,
  ...BIR_CONFIRMATIONS_SELF_COMPLETING_STEP_CODES,
  ...PAY_SELF_COMPLETING_STEP_CODES,
];

/**
 * The step that must be Done before each self-completing doc step
 * unlocks — the union of FILE_RETURN (for 6/7), BIR_CONFIRMATIONS_UNLOCK_
 * STEP_CODE (for 10/14) and PAY_UNLOCK_STEP_CODE (for 9). Consulted by
 * lib/actions/documents.ts's saveDocumentForStep to refuse an upload
 * before its gating step is Done, and by lib/actions/workflowSteps.ts's
 * recomputeFileGroupDocStepStatus to know whether "the only file was
 * removed" means revert to PENDING (no entry here — steps 6/7/9) or to
 * WAITING_EXTERNAL, anchored on the gating step's own completedAt (an
 * entry here — steps 10/14).
 */
export const SELF_COMPLETING_UNLOCK_STEP_CODE: Record<string, string> = {
  SAVE_SUBMISSION_SS: "FILE_RETURN",
  SAVE_FORM_COPY: "FILE_RETURN",
  ...BIR_CONFIRMATIONS_UNLOCK_STEP_CODE,
  ...PAY_UNLOCK_STEP_CODE,
};

/**
 * D75 (brief #5m §3) — every step with no Start and no Skip control at
 * all, across File (D65), Pay (D75) and BIR Confirmations (SAWT_VALIDATION,
 * D71 — the same reasoning D68 already gave RECEIVE_TRRC). Consulted by
 * skipStep and markStepInProgress (lib/actions/workflowSteps.ts).
 */
export const NO_START_NO_SKIP_STEP_CODES: readonly string[] = [
  ...FILE_GROUP_NO_START_NO_SKIP,
  ...PAY_GROUP_NO_START_NO_SKIP,
  "SAWT_VALIDATION",
];

/**
 * D77 (brief #5m §4, her decision) — components/next-action-control.tsx
 * must never offer a control the step's own card doesn't have. Three
 * shapes, covering all sixteen steps:
 *   - "goToStep": the step completes from its own content (self-completing
 *     — 1, 2, 6, 7, 9, 10, 14) or needs fields filled in first (8, Make
 *     payment) — none of these have a bare "Mark done" a banner click
 *     could meaningfully trigger, so the banner offers a single "Go to
 *     step" link instead, which expands the right group and scrolls to
 *     the card.
 *   - "markDoneOnly": the step's only control, full stop, is Mark done
 *     (3, 4, 5 — controlsMode="markDoneOnly" on their WorkflowStepCard).
 *     The banner may keep a Mark done button, gated by the same
 *     server-side checks the card's own button uses.
 *   - "full" (the default, every other step: 11-13, 15, 16): the step's
 *     own card genuinely offers both Start and Mark done (plus Skip/doc
 *     upload, which the banner never offered anyway) — the banner's
 *     existing Start+Mark done pair is a real subset of the card's own
 *     controls, so no change is needed there.
 */
export type NextActionMode = "goToStep" | "markDoneOnly" | "full";

const NEXT_ACTION_GO_TO_STEP: readonly string[] = [
  "RECORD_SALES",
  "RECEIVE_2307",
  "SAVE_SUBMISSION_SS",
  "SAVE_FORM_COPY",
  "MAKE_PAYMENT",
  "SAVE_PROOF_PAYMENT",
  "RECEIVE_TRRC",
  "SAWT_VALIDATION",
];

const NEXT_ACTION_MARK_DONE_ONLY: readonly string[] = ["PREPARE_RETURN", "ADVISE_CLIENT", "FILE_RETURN"];

export function nextActionModeForStepCode(stepCode: string): NextActionMode {
  if (NEXT_ACTION_GO_TO_STEP.includes(stepCode)) return "goToStep";
  if (NEXT_ACTION_MARK_DONE_ONLY.includes(stepCode)) return "markDoneOnly";
  return "full";
}

/**
 * Brief #5i §3 — the fixed step-code -> global step number (1-16) lookup,
 * for naming exactly which steps are still unresolved in a group's
 * Pending tooltip (e.g. "Step 3 and step 4 not done."), without needing
 * every caller to thread a WorkflowStep's own `sequence` field through
 * GroupStepInput. Mirrors SPEC.md §7.1's step table exactly — this never
 * varies at runtime, so a static map is simpler than a parameter every
 * test and caller would otherwise have to supply.
 */
const STEP_NUMBER: Record<string, number> = {
  RECORD_SALES: 1,
  RECEIVE_2307: 2,
  PREPARE_RETURN: 3,
  ADVISE_CLIENT: 4,
  FILE_RETURN: 5,
  SAVE_SUBMISSION_SS: 6,
  SAVE_FORM_COPY: 7,
  MAKE_PAYMENT: 8,
  SAVE_PROOF_PAYMENT: 9,
  RECEIVE_TRRC: 10,
  ALPHALIST_ENTRY: 11,
  EMAIL_DAT: 12,
  SAWT_ACK: 13,
  SAWT_VALIDATION: 14,
  EAFS_SUBMIT: 15,
  SEND_CLIENT_PACKAGE: 16,
};

function joinWithAnd(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * "Step 3 and step 4 not done." — the Pending label's tooltip (brief #5i
 * §3), replacing the group-level "Mark done" button entirely. Unlike
 * `blockReason` below (which explains WHY a group can't finish — a
 * missing document, or Prepare's steps-1/2 gate — and stays exactly as it
 * was, still consulted server-side), this just names WHICH steps aren't
 * resolved yet, the same plain way for every group. Null once the group
 * is complete.
 */
function unresolvedStepsSummary(groupSteps: { stepCode: string; status: WorkflowStepStatus }[]): string | null {
  const unresolved = groupSteps.filter((s) => !isResolved(s.status));
  if (unresolved.length === 0) return null;
  const numbers = [...new Set(unresolved.map((s) => STEP_NUMBER[s.stepCode]))].sort((a, b) => a - b);
  const joined = joinWithAnd(numbers.map((n) => `step ${n}`));
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)} not done.`;
}

/**
 * Brief #4b — steps 1 and 2 now complete themselves (RECORD_SALES on a
 * final Save of the quarter's sales; RECEIVE_2307 once "all certificates
 * received" is ticked and every certificate row has its scan). Prepare's
 * own "Mark done" therefore only ever has steps 3-4 left to resolve, and
 * is disabled with a plain-language reason until both self-completing
 * steps are resolved: a return can't be prepared without the sales
 * figure or the certificates.
 */
export function prepareGroupBlockReason(steps: { stepCode: string; status: WorkflowStepStatus }[]): string | null {
  const step1 = steps.find((s) => s.stepCode === "RECORD_SALES");
  const step2 = steps.find((s) => s.stepCode === "RECEIVE_2307");
  const step1Done = step1?.status === "DONE";
  const step2Resolved = step2 ? isResolved(step2.status) : false;
  if (step1Done && step2Resolved) return null;

  const missing: string[] = [];
  if (!step1Done) missing.push("quarterly sales are recorded (step 1)");
  if (!step2Resolved) missing.push("Form 2307 receipt is resolved — received or skipped (step 2)");
  return `Can't prepare a return until ${missing.join(" and ")}.`;
}

/**
 * Brief #5e §1 — step 4 (ADVISE_CLIENT) could be marked done while step 3
 * (PREPARE_RETURN) was still open, advising the client with no computation
 * behind it. Step 4 requires step 3 to be Done — not merely resolved,
 * since a skipped/NA return would mean there's nothing to advise on.
 */
export function adviseClientBlockReason(steps: { stepCode: string; status: WorkflowStepStatus }[]): string | null {
  const step3 = steps.find((s) => s.stepCode === "PREPARE_RETURN");
  if (step3?.status === "DONE") return null;
  return "Can't advise the client until the return is prepared (step 3).";
}

/**
 * D75 (brief #5m §3.1) — Pay (steps 8, 9) opens only once File (steps 5,
 * 6, 7) is Done. Enforced server-side inside step 8's save and step 9's
 * upload, not just by the UI hiding their controls.
 */
export function payGroupBlockReason(steps: { stepCode: string; status: WorkflowStepStatus }[]): string | null {
  const fileSteps = steps.filter((s) => WORKFLOW_GROUPS.find((g) => g.code === "FILE")!.stepCodes.includes(s.stepCode));
  const fileDone = fileSteps.length > 0 && fileSteps.every((s) => s.status === "DONE");
  return fileDone ? null : "Available once File is done.";
}

/**
 * The group a filing currently "sits at" for board/collapsed-summary
 * purposes: the earliest group (by group order, 1-6 — NOT by raw step
 * sequence, since numeric step order and group order diverge after D70)
 * with anything unresolved in it. null means every group is resolved.
 *
 * D70 — this is why a filing awaiting only the TRRC (step 10) or SAWT
 * validation (step 14) now sits under "BIR Confirmations": that group is
 * later than File/Pay/eAFS in GROUP order even though step 10's own
 * number (10) is lower than, say, step 13's (13). Every group ahead of it
 * finishing first is normal and raises nothing here.
 */
export function currentGroupCode(steps: { stepCode: string; status: WorkflowStepStatus }[]): GroupCode | null {
  for (const group of WORKFLOW_GROUPS) {
    const groupSteps = steps.filter((s) => group.stepCodes.includes(s.stepCode));
    if (groupSteps.some((s) => !isResolved(s.status))) return group.code;
  }
  return null;
}

/**
 * D74 (brief #5m §2, dashboard fix) — the step a filing "sits at" for the
 * dashboard's "Needs my action" / "Waiting on client" rows: the earliest
 * unresolved step WITHIN the earliest incomplete GROUP (in that group's
 * own step order), not the earliest unresolved step by raw sequence
 * across all sixteen. The two diverge once a later GROUP can hold an
 * earlier-numbered step (BIR Confirmations, group 5, holds step 10 —
 * numerically earlier than eAFS's own steps 11-13/15, group 4): the old
 * `currentStepCode` (lib/workflow/status.ts) would pick step 10 as "next"
 * even while an earlier GROUP still had work outstanding, which is
 * exactly the bug this fixes (found pre-existing by brief #5l, D69's own
 * note — this brief closes it for the dashboard specifically). Returns
 * null once every group is resolved.
 */
export function currentStepCodeByGroupOrder(steps: { stepCode: string; status: WorkflowStepStatus }[]): string | null {
  const groupCode = currentGroupCode(steps);
  if (!groupCode) return null;
  const group = WORKFLOW_GROUPS.find((g) => g.code === groupCode)!;
  for (const stepCode of group.stepCodes) {
    const step = steps.find((s) => s.stepCode === stepCode);
    if (step && !isResolved(step.status)) return stepCode;
  }
  return null;
}

/**
 * D74 — the three steps that ever wait on BIR (RECEIVE_TRRC, SAWT_ACK,
 * SAWT_VALIDATION — every step whose seeded waitingOnLabel is "BIR").
 * Used by the dashboard to list every currently-waiting one across every
 * active filing, independent of whatever else that filing still has open
 * — see app/(app)/page.tsx.
 */
export const BIR_WAIT_STEP_CODES: readonly string[] = ["RECEIVE_TRRC", "SAWT_ACK", "SAWT_VALIDATION"];

export interface GroupStepInput {
  stepCode: string;
  status: WorkflowStepStatus;
  waitingOnLabel?: string | null;
  /** Precomputed via lib/workflow/aging.ts's deriveStepAging by the caller — this module stays pure/DB-free. */
  agingDaysWaiting?: number | null;
  requiredDocSlots?: DocSlotLike[];
  documents?: AttachedDocument[];
}

export interface GroupSummary {
  code: GroupCode;
  name: string;
  /** Brief #5i §4 — Done + Skipped together, over applicable (non-NA) steps: a skip is a decision she made, not a step still outstanding. */
  doneCount: number;
  totalCount: number;
  /** Brief #5i §4 — how many of doneCount are specifically Skipped, so the card can show "1 skipped" after the count. 0 when there are none. */
  skippedCount: number;
  isComplete: boolean;
  /** No longer surfaced by the group card (brief #5i §3 removed the group-level "Mark done" it justified) but still computed and still tested — the same rule prepareGroupBlockReason/payGroupBlockReason enforce server-side. Reflects the required-doc-slot rule (D27) for the groups without their own block reason. Never the election check, the step 13->14 dependency, or SEND_CLIENT_PACKAGE's package-readiness check, all of which are unaffected and still surface as they did before this pass. */
  blockReason: string | null;
  /** §3 — what a collapsed group shows as outstanding, e.g. "waiting on proof of payment" or "waiting on TRRC, 12d". null once the group is complete or nothing is outstanding yet. D75: for Pay specifically, this MAY be non-null even while isComplete (the "nothing to pay" case, set by the page layer, not this function — see summarizeGroup). */
  outstandingLabel: string | null;
  /** Brief #5i §3 — the Pending label's tooltip, e.g. "Step 3 and step 4 not done." Null once the group is complete. */
  unresolvedSummary: string | null;
}

/**
 * D69 (brief #5l §2) — fixed, short, plain names for steps 6 and 7's own
 * documents, used ONLY by fileGroupOutstandingLabel below. Never derived
 * from a doc slot's own `label` (which is written for a form field, not a
 * summary line, and was showing up lowercased and slot-shaped — "pdf",
 * "trrc" — when the generic fallback built this text out of
 * missingRequiredSlots instead).
 */
const FILE_GROUP_SHORT_NAMES: Record<string, string> = {
  SAVE_SUBMISSION_SS: "submission screenshot",
  SAVE_FORM_COPY: "filed form",
};

/**
 * D69 (brief #5l §2), narrowed by D70 (brief #5m §1) — the File group's
 * own collapsed-summary text. File no longer holds step 10 (moved to BIR
 * Confirmations), so this is now only ever about steps 6/7:
 *   - Step 5 (FILE_RETURN) not Done: steps 6/7 are locked, not waiting on
 *     anything (D67) — no text at all. The "N of 3" count and the Pending
 *     label already say enough.
 *   - Step 5 Done, steps 6 and/or 7 still without a file: "waiting on
 *     submission screenshot, filed form" — only the ones actually
 *     missing, always in step order (6 before 7).
 *   - Both done (or group otherwise complete): null (handled by the
 *     isComplete guard at the call site).
 */
function fileGroupOutstandingLabel(groupSteps: GroupStepInput[]): string | null {
  const fileReturnStep = groupSteps.find((s) => s.stepCode === "FILE_RETURN");
  if (fileReturnStep?.status !== "DONE") return null;

  const missingDocNames = (["SAVE_SUBMISSION_SS", "SAVE_FORM_COPY"] as const)
    .map((stepCode) => groupSteps.find((s) => s.stepCode === stepCode))
    .filter((s): s is GroupStepInput => s != null && s.status !== "DONE")
    .map((s) => FILE_GROUP_SHORT_NAMES[s.stepCode]);

  return missingDocNames.length > 0 ? `waiting on ${missingDocNames.join(", ")}` : null;
}

/**
 * D70 (brief #5m §1/§2) — BIR Confirmations' own collapsed-summary text,
 * the same fixed-name/step-order shape as fileGroupOutstandingLabel above,
 * covering its two steps (10, 14). Neither step shows anything until it
 * has actually started waiting (WAITING_EXTERNAL, set automatically the
 * instant its own predecessor step is Done — D68/D71) — a locked step
 * (PENDING) is not a waiting one, the same distinction File already
 * draws. "waiting on TRRC, Nd", "waiting on SAWT validation, Nd", or both
 * joined with " · " (one "waiting on," stated once).
 */
const BIR_CONFIRMATIONS_SHORT_NAMES: Record<string, string> = {
  RECEIVE_TRRC: "TRRC",
  SAWT_VALIDATION: "SAWT validation",
};

function birConfirmationsOutstandingLabel(groupSteps: GroupStepInput[]): string | null {
  const parts: string[] = [];
  for (const stepCode of ["RECEIVE_TRRC", "SAWT_VALIDATION"] as const) {
    const step = groupSteps.find((s) => s.stepCode === stepCode);
    if (step?.status !== "WAITING_EXTERNAL") continue;
    const name = BIR_CONFIRMATIONS_SHORT_NAMES[stepCode];
    const withAging = step.agingDaysWaiting != null ? `${name}, ${step.agingDaysWaiting}d` : name;
    parts.push(parts.length > 0 ? withAging : `waiting on ${withAging}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * D75 (brief #5m §3.3) — Pay's own collapsed-summary text: "waiting on
 * proof of payment" while step 8 is Done and step 9 isn't (Done or NA).
 * Step 9 never enters WAITING_EXTERNAL on its own, so this line — not a
 * waiting badge on the step — is what tells her it's outstanding. No text
 * while Pay is locked (step 8 still PENDING) or once both steps resolve.
 * The "Nothing to pay" text (D76) is NOT built here — it needs the
 * filing's own computed amount, which this pure, DB-free module never
 * reads; the page layer supplies it (see the filing detail page).
 */
function payGroupOutstandingLabel(groupSteps: GroupStepInput[]): string | null {
  const step8 = groupSteps.find((s) => s.stepCode === "MAKE_PAYMENT");
  const step9 = groupSteps.find((s) => s.stepCode === "SAVE_PROOF_PAYMENT");
  if (step8?.status === "DONE" && step9 && step9.status !== "DONE" && step9.status !== "NA") {
    return "waiting on proof of payment";
  }
  return null;
}

/**
 * D73 (brief #5m §1, generalising D69) — eAFS's own collapsed-summary
 * text. Of its four steps (11, 12, 13, 15), only step 13 (SAWT_ACK) is
 * ever a waiting step (isWaitingState in the seed template) — so this is
 * the only case there is. A fixed plain name ("SAWT acknowledgement"),
 * never the generic "BIR" waitingOnLabel or a lowercased doc-slot label.
 * eAFS and Client package haven't been walked yet (her own note) — this
 * is deliberately narrow: nothing here reads missing-document state the
 * way the old generic fallback did.
 */
function eafsGroupOutstandingLabel(groupSteps: GroupStepInput[]): string | null {
  const ackStep = groupSteps.find((s) => s.stepCode === "SAWT_ACK");
  if (ackStep?.status !== "WAITING_EXTERNAL") return null;
  return ackStep.agingDaysWaiting != null
    ? `waiting on SAWT acknowledgement, ${ackStep.agingDaysWaiting}d`
    : "waiting on SAWT acknowledgement";
}

/**
 * Rolls a group's steps up into one summary. Group status/blocking is
 * always DERIVED from its steps (§3) — there is no hand-set group-level
 * field anywhere.
 */
export function summarizeGroup(group: WorkflowGroupDef, steps: GroupStepInput[]): GroupSummary {
  const groupSteps = steps.filter((s) => group.stepCodes.includes(s.stepCode));
  const applicable = groupSteps.filter((s) => s.status !== "NA");
  // Brief #5i §4 — a Skipped step is a decision she made, not a step
  // still outstanding, so it counts toward the numerator alongside Done.
  const doneCount = applicable.filter((s) => s.status === "DONE" || s.status === "SKIPPED").length;
  const skippedCount = applicable.filter((s) => s.status === "SKIPPED").length;
  const totalCount = applicable.length;
  const isComplete = groupSteps.length > 0 && groupSteps.every((s) => isResolved(s.status));
  const unresolvedSummary = isComplete ? null : unresolvedStepsSummary(groupSteps);

  const missingLabels: string[] = [];
  for (const s of groupSteps) {
    if (isResolved(s.status)) continue;
    missingLabels.push(...missingRequiredSlots(s.requiredDocSlots ?? [], s.documents ?? []).map((slot) => slot.label));
  }
  const docSlotBlockReason =
    missingLabels.length > 0
      ? `Missing required document${missingLabels.length > 1 ? "s" : ""}: ${missingLabels.join(", ")}.`
      : null;
  // Brief #4b — Prepare's block reason is the steps 1/2 gate above, not a
  // missing document (neither step carries a required doc slot anymore).
  // D75 — Pay's block reason is the File-done gate while locked (reading
  // File's own steps off the FULL `steps` list, not `groupSteps` — File
  // isn't part of Pay's own group), falling through to the ordinary
  // missing-document reason once File is Done and Pay's own steps are
  // reachable.
  const blockReason =
    group.code === "PREPARE"
      ? prepareGroupBlockReason(groupSteps)
      : group.code === "PAY"
        ? (payGroupBlockReason(steps) ?? docSlotBlockReason)
        : docSlotBlockReason;

  // D73 (brief #5m §1) — generalises D69: NO group shows "waiting on…"
  // text for a step she hasn't reached yet, whether locked (File/Pay
  // before their gating step is Done) or simply not yet possible (BIR
  // Confirmations before its own predecessor steps are Done). Every
  // branch below only ever reads a step's LIVE status, never "is a
  // required document still missing" — that was the old generic
  // fallback's bug (it read missingRequiredSlots regardless of whether
  // the step was even reachable yet).
  let outstandingLabel: string | null = null;
  if (!isComplete) {
    if (group.code === "FILE") {
      outstandingLabel = fileGroupOutstandingLabel(groupSteps);
    } else if (group.code === "BIR_CONFIRMATIONS") {
      outstandingLabel = birConfirmationsOutstandingLabel(groupSteps);
    } else if (group.code === "PAY") {
      outstandingLabel = payGroupOutstandingLabel(groupSteps);
    } else if (group.code === "EAFS") {
      outstandingLabel = eafsGroupOutstandingLabel(groupSteps);
    } else if (group.code === "PREPARE") {
      // Brief #4e — Prepare's own two self-completing steps (RECORD_SALES,
      // RECEIVE_2307) both read WAITING_EXTERNAL with the same generic
      // waitingOnLabel ("Client") until resolved, which used to make this
      // summary read "waiting on Client, 0d" regardless of which of the
      // two was actually still open — no more informative than the
      // now-removed standing block-reason text it sat next to. Name the
      // specific thing outstanding instead, same short style as every
      // other group. Once both are resolved, Prepare has nothing left to
      // name here — steps 3/4 have no waiting state of their own (D54/D51).
      const step1 = groupSteps.find((s) => s.stepCode === "RECORD_SALES");
      const step2 = groupSteps.find((s) => s.stepCode === "RECEIVE_2307");
      const step1Done = step1?.status === "DONE";
      const step2Resolved = step2 ? isResolved(step2.status) : false;
      const outstanding: string[] = [];
      if (!step1Done) outstanding.push("quarterly sales");
      if (!step2Resolved) outstanding.push("Form 2307");
      if (outstanding.length > 0) outstandingLabel = `waiting on ${outstanding.join(" and ")}`;
    }
    // CLIENT_PACKAGE (step 16 alone): step 16 has no waiting state of its
    // own (D27 — no slot at all), so it never has anything to name here.
  }

  return { code: group.code, name: group.name, doneCount, totalCount, skippedCount, isComplete, blockReason, outstandingLabel, unresolvedSummary };
}

/**
 * D81 (brief #5n §4) — the "4 of 4 · 1 skipped" counter beside a group's
 * name. Null when the group has no applicable step at all (every step NA):
 * "0 of 0" said nothing, and the Done pill plus the group's note are enough.
 * Applies to any group, not just Pay.
 */
export function groupCounterLabel(doneCount: number, totalCount: number, skippedCount: number): string | null {
  if (totalCount === 0) return null;
  return `${doneCount} of ${totalCount}${skippedCount > 0 ? ` · ${skippedCount} skipped` : ""}`;
}

/**
 * D76/D81 — Pay's note once steps 8 and 9 are both NA. Built from the
 * return's own figures (this module stays free of I/O; the page supplies
 * them): "Nothing to pay — overpayment ₱X" for an overpayment, plain
 * "Nothing to pay" for exactly ₱0.
 */
export function nothingToPayLabel(isOverpayment: boolean, overpaymentCents: number): string {
  return isOverpayment && overpaymentCents > 0
    ? `Nothing to pay — overpayment ${centsToPesos(overpaymentCents, { withSymbol: true })}`
    : "Nothing to pay";
}
