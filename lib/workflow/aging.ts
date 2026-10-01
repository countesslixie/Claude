import type { WorkflowStepStatus } from "./types";
import { formatDays } from "@/lib/formatDays";

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

/**
 * D72 — the one place the "Waiting on BIR" colour rule lives: amber while
 * waiting, red once past twice expectedResponseDays, never green. The step
 * pill (both step cards) and the board's BIR-wait tag (D79) both call this.
 */
export function birWaitTone(agingTone: AgingTone | null | undefined): "waiting" | "overdue" {
  return agingTone === "red" ? "overdue" : "waiting";
}

/**
 * The short plain name of each BIR wait, used by the board tag (D79), the
 * BIR Confirmations/eAFS header text (D73), and the Next banner/bar (D84).
 * D96 (brief #5q) — step 14 is "SAWT validation" again (D92's "eAFS
 * validation" is superseded).
 */
export const BIR_WAIT_SHORT_NAME: Record<string, string> = {
  RECEIVE_TRRC: "TRRC",
  SAWT_ACK: "SAWT acknowledgement",
  SAWT_VALIDATION: "SAWT validation",
};

/** D79 — the two waits that can carry a board tag, in display order, with their tag wording. */
const BIR_WAIT_TAG_LABELS: ReadonlyArray<{ stepCode: string; label: string }> = [
  { stepCode: "RECEIVE_TRRC", label: BIR_WAIT_SHORT_NAME.RECEIVE_TRRC },
  { stepCode: "SAWT_VALIDATION", label: BIR_WAIT_SHORT_NAME.SAWT_VALIDATION },
];

export interface BirWaitTag {
  stepCode: string;
  text: string;
  tone: "waiting" | "overdue";
}

/**
 * D79 — tags for a board card sitting outside BIR Confirmations: one per
 * step 10 / step 14 that is WAITING_EXTERNAL right now, "TRRC · 2 days" /
 * "SAWT validation · 8 days". Days and colour come from deriveStepAging, the
 * same function the step pill uses.
 */
export function birWaitTags(
  steps: Array<{
    stepCode: string;
    status: WorkflowStepStatus;
    waitingSince: Date | null;
    expectedResponseDays: number | null;
  }>,
  certificatesExpectedBy: Date | null,
  now: Date,
): BirWaitTag[] {
  const tags: BirWaitTag[] = [];
  for (const { stepCode, label } of BIR_WAIT_TAG_LABELS) {
    const step = steps.find((s) => s.stepCode === stepCode);
    if (!step) continue;
    const aging = deriveStepAging({ ...step, certificatesExpectedBy, now });
    if (!aging) continue;
    tags.push({ stepCode, text: `${label} · ${formatDays(aging.daysWaiting)}`, tone: birWaitTone(aging.tone) });
  }
  return tags;
}
