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
  /** Excludes NA steps from both, matching computeProgressPercent's convention in lib/workflow/status.ts. */
  doneCount: number;
  totalCount: number;
  isComplete: boolean;
  /** §4 — the group's Done control is disabled while this is non-null; names what's missing in plain words. Only reflects the same required-doc-slot rule as always (D27) — never the election check, the step 13->14 dependency, or SEND_CLIENT_PACKAGE's package-readiness check, all of which are unaffected and still surface as they did before this pass. */
  blockReason: string | null;
  /** §3 — what a collapsed group shows as outstanding, e.g. "waiting on proof of payment" or "waiting on BIR, 12d". null once the group is complete or nothing is outstanding yet. */
  outstandingLabel: string | null;
}

/**
 * Rolls a group's steps up into one summary. Group status/blocking is
 * always DERIVED from its steps (§3) — there is no hand-set group-level
 * field anywhere.
 */
export function summarizeGroup(group: WorkflowGroupDef, steps: GroupStepInput[]): GroupSummary {
  const groupSteps = steps.filter((s) => group.stepCodes.includes(s.stepCode));
  const applicable = groupSteps.filter((s) => s.status !== "NA");
  const doneCount = applicable.filter((s) => s.status === "DONE").length;
  const totalCount = applicable.length;
  const isComplete = groupSteps.length > 0 && groupSteps.every((s) => isResolved(s.status));

  const missingLabels: string[] = [];
  for (const s of groupSteps) {
    if (isResolved(s.status)) continue;
    missingLabels.push(...missingRequiredSlots(s.requiredDocSlots ?? [], s.documents ?? []).map((slot) => slot.label));
  }
  const blockReason =
    missingLabels.length > 0
      ? `Missing required document${missingLabels.length > 1 ? "s" : ""}: ${missingLabels.join(", ")}.`
      : null;

  let outstandingLabel: string | null = null;
  if (!isComplete) {
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

  return { code: group.code, name: group.name, doneCount, totalCount, isComplete, blockReason, outstandingLabel };
}
