import type { DocSlotDef } from "./types";

/**
 * Required-document-slot validation (SPEC.md 7.1, 7.2). Pure functions —
 * the caller supplies which slots are already filled as a plain list; no
 * Prisma import here.
 */

export interface AttachedDocument {
  docSlotCode: string | null;
  deletedAt: Date | null;
}

/** Required slots on `slots` with no non-deleted document attached. */
export function missingRequiredSlots(slots: DocSlotDef[], documents: AttachedDocument[]): DocSlotDef[] {
  const filledSlotCodes = new Set(
    documents.filter((d) => !d.deletedAt && d.docSlotCode).map((d) => d.docSlotCode as string),
  );
  return slots.filter((s) => s.required && !filledSlotCodes.has(s.slotCode));
}

/**
 * A step with an empty required doc slot cannot be set DONE (SPEC.md 7.2,
 * §16 item 13).
 */
export function canCompleteStep(slots: DocSlotDef[], documents: AttachedDocument[]): boolean {
  return missingRequiredSlots(slots, documents).length === 0;
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
  RECEIVE_TRRC: "Receive & save BIR confirmation, TRRC (step 10)",
  SAWT_VALIDATION: "Receive & save SAWT validation email (step 14)",
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
