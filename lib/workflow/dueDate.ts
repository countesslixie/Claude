import type { WorkflowStepStatus } from "./types";

/**
 * The date to DISPLAY for a step — never the filing's adjustedDueDate by
 * default. Each step has its own clock (SPEC.md 3.6):
 *   - RECEIVE_2307: certificatesExpectedBy — the working-calendar date
 *     certificates are expected in, not the statutory filing deadline.
 *   - Any other step currently WAITING_EXTERNAL: its own expected-response
 *     date (waitingSince + expectedResponseDays) — the same clock
 *     deriveStepAging's green/amber/red badge already measures against,
 *     so the displayed date and the badge agree.
 *   - FILE_RETURN itself: adjustedDueDate — this is the one step that
 *     genuinely IS the statutory deadline.
 *   - Everything else (prep/attachment/payment steps not yet waiting):
 *     internalFilingTarget — the bookkeeper's own practice target for
 *     when they aim to have this filing done, falling back to
 *     adjustedDueDate only if no working-calendar target was ever set.
 */
export function stepDueDate(input: {
  stepCode: string;
  status: WorkflowStepStatus;
  waitingSince: Date | null;
  expectedResponseDays: number | null;
  certificatesExpectedBy: Date | null;
  internalFilingTarget: Date | null;
  adjustedDueDate: Date;
}): Date {
  if (input.stepCode === "RECEIVE_2307" && input.certificatesExpectedBy) {
    return input.certificatesExpectedBy;
  }

  if (input.status === "WAITING_EXTERNAL" && input.waitingSince && input.expectedResponseDays) {
    return addDays(input.waitingSince, input.expectedResponseDays);
  }

  if (input.stepCode === "FILE_RETURN") {
    return input.adjustedDueDate;
  }

  return input.internalFilingTarget ?? input.adjustedDueDate;
}

function addDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}
