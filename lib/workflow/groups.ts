import { isResolved } from "./status";
import { missingRequiredSlots, type AttachedDocument, type DocSlotLike } from "./docSlots";
import type { WorkflowStepStatus } from "./types";

/**
 * Brief #4a — the sixteen steps wrapped in five groups. This changes
 * nothing about what any step does or requires; it only changes where
 * "mark done" and the board's columns sit. Group membership is a fixed
 * lookup table, not the `category` field: reusing `category` outright
 * would have put step 4 (ADVISE_CLIENT, category CLIENT_COMM) in Close
 * alongside step 16 (also CLIENT_COMM) when it actually belongs in
 * Prepare, and vice versa for step 15 (ATTACHMENT) vs step 16.
 *
 * Step numbers are NOT renumbered to make groups contiguous (DECISIONS.md
 * D32): group 2 (File) holds steps 5, 6, 7, 10 while group 3 (Pay) — 8, 9
 * — sits between them numerically, because the TRRC (step 10) arrives
 * after payment in practice but is still part of the eBIRForms filing
 * process, not the payment. The step numbers record sequence; the groups
 * record meaning.
 */
export type GroupCode = "PREPARE" | "FILE" | "PAY" | "SAWT" | "CLOSE";

export interface WorkflowGroupDef {
  code: GroupCode;
  name: string;
  /** stepCodes in this group's own display order (§2 — File renders 5, 6, 7, 10 in that numeric order, TRRC last). */
  stepCodes: string[];
}

export const WORKFLOW_GROUPS: WorkflowGroupDef[] = [
  { code: "PREPARE", name: "Prepare", stepCodes: ["RECORD_SALES", "RECEIVE_2307", "PREPARE_RETURN", "ADVISE_CLIENT"] },
  { code: "FILE", name: "File", stepCodes: ["FILE_RETURN", "SAVE_SUBMISSION_SS", "SAVE_FORM_COPY", "RECEIVE_TRRC"] },
  { code: "PAY", name: "Pay", stepCodes: ["MAKE_PAYMENT", "SAVE_PROOF_PAYMENT"] },
  { code: "SAWT", name: "SAWT", stepCodes: ["ALPHALIST_ENTRY", "EMAIL_DAT", "SAWT_ACK", "SAWT_VALIDATION"] },
  { code: "CLOSE", name: "Close", stepCodes: ["EAFS_SUBMIT", "SEND_CLIENT_PACKAGE"] },
];

export function groupForStepCode(stepCode: string): WorkflowGroupDef | undefined {
  return WORKFLOW_GROUPS.find((g) => g.stepCodes.includes(stepCode));
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
 * The group a filing currently "sits at" for board/collapsed-summary
 * purposes: the earliest group (by group order, 1-5 — NOT by raw step
 * sequence, since group 2 isn't contiguous) with anything unresolved in
 * it. null means every group is resolved.
 *
 * §2 — this is why a filing awaiting only the TRRC (step 10) still shows
 * under "File": File is earlier than Pay in group order even though the
 * TRRC's own step number (10) is higher than payment's (8, 9). Pay
 * finishing first is normal and raises nothing here.
 */
export function currentGroupCode(steps: { stepCode: string; status: WorkflowStepStatus }[]): GroupCode | null {
  for (const group of WORKFLOW_GROUPS) {
    const groupSteps = steps.filter((s) => group.stepCodes.includes(s.stepCode));
    if (groupSteps.some((s) => !isResolved(s.status))) return group.code;
  }
  return null;
}

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
  /** No longer surfaced by the group card (brief #5i §3 removed the group-level "Mark done" it justified) but still computed and still tested — the same rule prepareGroupBlockReason enforces server-side inside markStepDone for step 3. Reflects the required-doc-slot rule (D27) for every group except Prepare. Never the election check, the step 13->14 dependency, or SEND_CLIENT_PACKAGE's package-readiness check, all of which are unaffected and still surface as they did before this pass. */
  blockReason: string | null;
  /** §3 — what a collapsed group shows as outstanding, e.g. "waiting on proof of payment" or "waiting on BIR, 12d". null once the group is complete or nothing is outstanding yet. */
  outstandingLabel: string | null;
  /** Brief #5i §3 — the Pending label's tooltip, e.g. "Step 3 and step 4 not done." Null once the group is complete. */
  unresolvedSummary: string | null;
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
  const blockReason = group.code === "PREPARE" ? prepareGroupBlockReason(groupSteps) : docSlotBlockReason;

  let outstandingLabel: string | null = null;
  if (!isComplete) {
    // Brief #4e — Prepare's own two self-completing steps (RECORD_SALES,
    // RECEIVE_2307) both read WAITING_EXTERNAL with the same generic
    // waitingOnLabel ("Client") until resolved, which used to make this
    // summary read "waiting on Client, 0d" regardless of which of the
    // two was actually still open — no more informative than the
    // now-removed standing block-reason text it sat next to. Name the
    // specific thing outstanding instead, same short style as every
    // other group. Falls through to the generic case below once both
    // are resolved (e.g. step 4/ADVISE_CLIENT genuinely marked waiting).
    if (group.code === "PREPARE") {
      const step1 = groupSteps.find((s) => s.stepCode === "RECORD_SALES");
      const step2 = groupSteps.find((s) => s.stepCode === "RECEIVE_2307");
      const step1Done = step1?.status === "DONE";
      const step2Resolved = step2 ? isResolved(step2.status) : false;
      const outstanding: string[] = [];
      if (!step1Done) outstanding.push("quarterly sales");
      if (!step2Resolved) outstanding.push("Form 2307");
      if (outstanding.length > 0) outstandingLabel = `waiting on ${outstanding.join(" and ")}`;
    }

    if (outstandingLabel == null) {
      const waitingStep = groupSteps.find((s) => s.status === "WAITING_EXTERNAL");
      if (waitingStep?.waitingOnLabel) {
        outstandingLabel =
          waitingStep.agingDaysWaiting != null
            ? `waiting on ${waitingStep.waitingOnLabel}, ${waitingStep.agingDaysWaiting}d`
            : `waiting on ${waitingStep.waitingOnLabel}`;
      } else if (missingLabels.length > 0) {
        outstandingLabel = `waiting on ${missingLabels.join(", ").toLowerCase()}`;
      }
    }
  }

  return { code: group.code, name: group.name, doneCount, totalCount, skippedCount, isComplete, blockReason, outstandingLabel, unresolvedSummary };
}
