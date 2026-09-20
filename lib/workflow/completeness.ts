import { emptySlots, type AttachedDocument } from "./docSlots";
import type { DocSlotDef } from "./types";

/**
 * The "documents not yet attached" informational note (rework brief #2
 * §7, reconciled onto D27's real blocking rule). Originally this scanned
 * every non-NA/non-SKIPPED step for missing REQUIRED slots, back when
 * nothing blocked and any step could reach DONE with nothing attached.
 * Now that the seven listed steps (D27) genuinely can't reach DONE
 * without their document, that old scope would show almost nothing.
 *
 * Reworked to: only DONE or IN_PROGRESS steps (empty on a fresh filing,
 * filling in as she works — a step she's moved past without saving), and
 * ALL empty slots on them, not just required ones — a required slot on a
 * DONE step should never actually be empty (D27 already stopped that),
 * but an IN_PROGRESS step's required slot can be, and an optional slot on
 * either can be, and both are worth surfacing here since they're the
 * cases nothing else catches.
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
    if (step.status !== "DONE" && step.status !== "IN_PROGRESS") continue;
    const documents = documentsByStepCode.get(step.stepCode) ?? [];
    for (const slot of emptySlots(step.requiredDocSlots, documents)) {
      gaps.push({ stepCode: step.stepCode, stepTitle: step.title, slotCode: slot.slotCode, slotLabel: slot.label });
    }
  }

  return gaps;
}
