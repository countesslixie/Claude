/**
 * Plain types for the workflow engine. No Prisma imports here — like
 * lib/tax/, this stays pure: plain object in, plain object out
 * (SPEC.md section 4, 6). The I/O boundary (lib/workflow/filingGeneration.ts,
 * lib/actions/workflowSteps.ts) assembles these from the database.
 */

export type WorkflowStepStatus = "PENDING" | "IN_PROGRESS" | "WAITING_EXTERNAL" | "DONE" | "SKIPPED" | "NA";
export type FilingStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "WAITING_CLIENT"
  | "WAITING_BIR"
  | "BLOCKED"
  | "COMPLETE"
  | "NA";

export interface DocSlotDef {
  slotCode: string;
  label: string;
  required: boolean;
  acceptedTypes: string[];
}

/**
 * requiredDocSlots is stored as a JSON.stringify'd string in the DB (same
 * convention as Filing.computationSnapshot — see
 * app/(app)/clients/[id]/filings/[filingId]/page.tsx's JSON.parse of
 * that field). Callers reading a WorkflowStep row must parse this
 * themselves; this helper centralizes that so the shape assertion lives
 * in one place.
 */
export function parseDocSlots(raw: unknown): DocSlotDef[] {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? (raw as DocSlotDef[]) : [];
}
