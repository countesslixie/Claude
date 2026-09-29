import type { DocSlotDef } from "./types";

/**
 * Required-document-slot validation (SPEC.md 7.1, 7.2). Pure functions —
 * the caller supplies which slots are already filled as a plain list; no
 * Prisma import here.
 */

export interface AttachedDocument {
  docSlotCode: string | null;
  /** Omit entirely for a list already filtered to non-deleted documents (e.g. client-side StepCardDoc). */
  deletedAt?: Date | null;
}

/** The fields these checks actually read — narrower than DocSlotDef so a client-side slot shape (no acceptedTypes) satisfies it too. */
export interface DocSlotLike {
  slotCode: string;
  label: string;
  required: boolean;
}

/** Required slots on `slots` with no non-deleted document attached. */
export function missingRequiredSlots<T extends DocSlotLike>(slots: T[], documents: AttachedDocument[]): T[] {
  const filledSlotCodes = new Set(
    documents.filter((d) => !d.deletedAt && d.docSlotCode).map((d) => d.docSlotCode as string),
  );
  return slots.filter((s) => s.required && !filledSlotCodes.has(s.slotCode));
}

/**
 * A step with an empty required doc slot cannot be set DONE (SPEC.md 7.2,
 * §16 item 13).
 */
export function canCompleteStep(slots: DocSlotLike[], documents: AttachedDocument[]): boolean {
  return missingRequiredSlots(slots, documents).length === 0;
}

/**
 * Every slot (required or optional) with no non-deleted document attached
 * — used by the filing page's "documents not yet attached" banner (D27's
 * carry-over, rework brief #2 §7), which lists what a DONE/IN_PROGRESS
 * step has moved past without saving regardless of whether that slot
 * blocks completion.
 */
export function emptySlots<T extends DocSlotLike>(slots: T[], documents: AttachedDocument[]): T[] {
  const filledSlotCodes = new Set(
    documents.filter((d) => !d.deletedAt && d.docSlotCode).map((d) => d.docSlotCode as string),
  );
  return slots.filter((s) => !filledSlotCodes.has(s.slotCode));
}

/**
 * The single reason (if any) a step's DONE control is disabled. Surfaced
 * as a `title` tooltip on the disabled control itself (D41, brief #4e) —
 * not standing text on the page — rather than only as a post-click error.
 * Missing documents take priority over a dependency reason when both
 * apply, since attaching the document is the more immediately actionable
 * of the two.
 */
export function stepBlockReason(
  slots: DocSlotLike[],
  documents: AttachedDocument[],
  dependencyBlockedReason?: string | null,
): string | null {
  const missing = missingRequiredSlots(slots, documents);
  if (missing.length > 0) {
    return `Missing required document${missing.length > 1 ? "s" : ""}: ${missing.map((s) => s.label).join(", ")}.`;
  }
  return dependencyBlockedReason ?? null;
}

/**
 * SEND_CLIENT_PACKAGE's contents are assembled from documents already
 * saved against steps 7 (SAVE_FORM_COPY), 9 (SAVE_PROOF_PAYMENT), 10
 * (RECEIVE_TRRC), and 14 (SAWT_VALIDATION) — SPEC.md 7.1, §16 item 14. A
 * dependency step with status NA (e.g. step 14 when the filing has no
 * SAWT requirement) is skipped, not treated as missing — it doesn't
 * apply to this filing.
 */
export const SEND_CLIENT_PACKAGE_DEPENDENCIES = [
  "SAVE_FORM_COPY",
  "SAVE_PROOF_PAYMENT",
  "RECEIVE_TRRC",
  "SAWT_VALIDATION",
] as const;

export interface StepForPackageCheck {
  stepCode: string;
  status: string;
  requiredDocSlots: DocSlotDef[];
}

export interface MissingPackageDocument {
  stepCode: string;
  stepLabel: string;
  slotCode: string;
  slotLabel: string;
}

export interface PackageReadiness {
  ok: boolean;
  missing: MissingPackageDocument[];
}

const DEPENDENCY_LABELS: Record<string, string> = {
  SAVE_FORM_COPY: "Download and save filed form (step 7)",
  SAVE_PROOF_PAYMENT: "Save proof of payment (step 9)",
  RECEIVE_TRRC: "Save TRRC email (step 10)",
  SAWT_VALIDATION: "Save eAFS validation email (step 14)",
};

/**
 * Names exactly which document(s) are absent, by step and slot, rather
 * than a generic "package incomplete" message — this is the check that
 * closes the loop on "what have I not saved yet" (SPEC.md 7.1).
 */
export function checkSendClientPackageReadiness(
  dependencySteps: StepForPackageCheck[],
  documentsByStepCode: Map<string, AttachedDocument[]>,
): PackageReadiness {
  const missing: MissingPackageDocument[] = [];

  for (const stepCode of SEND_CLIENT_PACKAGE_DEPENDENCIES) {
    const step = dependencySteps.find((s) => s.stepCode === stepCode);
    if (!step || step.status === "NA") continue; // doesn't apply to this filing

    const documents = documentsByStepCode.get(stepCode) ?? [];
    for (const slot of missingRequiredSlots(step.requiredDocSlots, documents)) {
      missing.push({
        stepCode,
        stepLabel: DEPENDENCY_LABELS[stepCode] ?? stepCode,
        slotCode: slot.slotCode,
        slotLabel: slot.label,
      });
    }
  }

  return { ok: missing.length === 0, missing };
}
