import { manilaCalendarDay } from "@/lib/dates";
import type { FilingStatus, WorkflowStepStatus } from "./types";

/**
 * Filing status derivation (SPEC.md 7.2) — status is DERIVED from its
 * steps, never set by hand:
 *   - all DONE/NA -> COMPLETE
 *   - past adjustedDueDate and not complete -> BLOCKED (takes priority
 *     over "waiting on X" below: being overdue is the more urgent signal
 *     for a bookkeeper regardless of what it's specifically waiting on)
 *   - any WAITING_EXTERNAL on a BIR step -> WAITING_BIR
 *   - any WAITING_EXTERNAL on a client step -> WAITING_CLIENT
 *   - otherwise IN_PROGRESS if anything has started, else NOT_STARTED
 */

export interface StepForStatus {
  status: WorkflowStepStatus;
  waitingOnLabel: string | null;
}

export function deriveFilingStatus(input: {
  steps: StepForStatus[];
  adjustedDueDate: Date;
  now: Date;
}): FilingStatus {
  const { steps, adjustedDueDate, now } = input;
  if (steps.length === 0) return "NOT_STARTED";

  const allDoneOrNa = steps.every((s) => s.status === "DONE" || s.status === "NA");
  if (allDoneOrNa) return "COMPLETE";

  // Calendar-day comparison, not raw instant: adjustedDueDate is a clean
  // UTC-midnight marker (Manila 08:00), while `now` is a real timestamp.
  // An instant comparison would flip to BLOCKED as soon as Manila passes
  // 08:00 on the due date itself, wrongly treating most of the due
  // date's own daylight hours as already overdue.
  const isPastDue = manilaCalendarDay(now) > manilaCalendarDay(adjustedDueDate);
  if (isPastDue) return "BLOCKED";

  const waitingOnBir = steps.some((s) => s.status === "WAITING_EXTERNAL" && s.waitingOnLabel === "BIR");
  if (waitingOnBir) return "WAITING_BIR";

  const waitingOnClient = steps.some((s) => s.status === "WAITING_EXTERNAL" && s.waitingOnLabel === "Client");
  if (waitingOnClient) return "WAITING_CLIENT";

  const anyStarted = steps.some((s) => s.status !== "PENDING" && s.status !== "NA");
  return anyStarted ? "IN_PROGRESS" : "NOT_STARTED";
}

/**
 * Progress %, excluding NA steps from the denominator (SPEC.md §16 item
 * 12: a filing with zero 2307s auto-marks steps 11-14 NA and excludes
 * them from progress %).
 */
export function computeProgressPercent(steps: { status: WorkflowStepStatus }[]): number {
  const applicable = steps.filter((s) => s.status !== "NA");
  if (applicable.length === 0) return 0;
  const done = applicable.filter((s) => s.status === "DONE").length;
  return Math.round((done / applicable.length) * 100);
}

/**
 * The step a filing currently "sits at" for board purposes (SPEC.md 11.2:
 * kanban columns = the 16 steps, cards = client-period) — the earliest,
 * by sequence, not yet resolved (not DONE/NA/SKIPPED). null means every
 * step is resolved, i.e. the filing belongs in a "Complete" lane.
 */
export function currentStepCode(steps: { sequence: number; status: WorkflowStepStatus; stepCode: string }[]): string | null {
  const active = [...steps].sort((a, b) => a.sequence - b.sequence).find((s) => !isResolved(s.status));
  return active ? active.stepCode : null;
}

function isResolved(status: WorkflowStepStatus): boolean {
  return status === "DONE" || status === "NA" || status === "SKIPPED";
}
