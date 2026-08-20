import type { WorkflowStepStatus } from "./types";

/**
 * Waiting-step aging (SPEC.md 7.2): green < expectedResponseDays, amber
 * at 1x, red at 2x. Red items surface at the top of the dashboard.
 *
 * RECEIVE_2307's clock starts from the filing's certificatesExpectedBy,
 * not whenever the step happened to be flipped to WAITING_EXTERNAL
 * (SPEC.md 3.6) — certificates are often not even due from the payor
 * until weeks after the period closes, so anchoring on waitingSince the
 * way every other step does would flag the bookkeeper as "waiting" long
 * before a certificate could reasonably have arrived.
 */

export type AgingTone = "green" | "amber" | "red";

export interface StepAging {
  daysWaiting: number;
  tone: AgingTone;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function deriveStepAging(input: {
  stepCode: string;
  status: WorkflowStepStatus;
  waitingSince: Date | null;
  expectedResponseDays: number | null;
  /** Filing.certificatesExpectedBy — only consulted for RECEIVE_2307. */
  certificatesExpectedBy: Date | null;
  now: Date;
}): StepAging | null {
  if (input.status !== "WAITING_EXTERNAL") return null;

  const clockStart =
    input.stepCode === "RECEIVE_2307" && input.certificatesExpectedBy
      ? input.certificatesExpectedBy
      : input.waitingSince;

  if (!clockStart) return { daysWaiting: 0, tone: "green" };

  // Clamped at 0: a certificatesExpectedBy date still in the future means
  // the clock hasn't started yet, not that it's "negative days waiting."
  const daysWaiting = Math.max(0, Math.floor((input.now.getTime() - clockStart.getTime()) / MS_PER_DAY));

  if (!input.expectedResponseDays) return { daysWaiting, tone: "green" };

  let tone: AgingTone = "green";
  if (daysWaiting >= input.expectedResponseDays * 2) tone = "red";
  else if (daysWaiting >= input.expectedResponseDays) tone = "amber";

  return { daysWaiting, tone };
}
