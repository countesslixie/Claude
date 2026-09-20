import { missingRequiredSlots, type AttachedDocument } from "./docSlots";
import type { DocSlotDef } from "./types";

/**
 * Rework brief §5.3 — the informational completeness note that replaces
 * document gating everywhere (§5.1). Nothing here blocks; it exists so a
 * missing document is never silently missed, not to stop work. Unlike
 * SEND_CLIENT_PACKAGE's narrower dependency check (steps 7/9/10/14
 * only), this scans every non-NA, non-SKIPPED step on the filing — a
 * step already marked DONE can still be missing its document, since
 * nothing enforced attaching one before DONE was allowed.
 */
export interface CompletenessGap {
  stepCode: string;
  stepTitle: string;
  slotCode: string;
  slotLabel: string;
}

export interface StepForCompleteness {
  stepCode: string;
  title: string;
  status: string;
  requiredDocSlots: DocSlotDef[];
}

export function computeFilingCompleteness(
  steps: StepForCompleteness[],
  documentsByStepCode: Map<string, AttachedDocument[]>,
): CompletenessGap[] {
  const gaps: CompletenessGap[] = [];

  for (const step of steps) {
    if (step.status === "NA" || step.status === "SKIPPED") continue;
    const documents = documentsByStepCode.get(step.stepCode) ?? [];
    for (const slot of missingRequiredSlots(step.requiredDocSlots, documents)) {
      gaps.push({ stepCode: step.stepCode, stepTitle: step.title, slotCode: slot.slotCode, slotLabel: slot.label });
    }
  }

  return gaps;
}
