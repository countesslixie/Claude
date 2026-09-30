import { describe, it, expect } from "vitest";
import { stepLockReason, nextActionForFiling, currentGroupCode } from "@/lib/workflow/groups";
import { deriveFilingStatus } from "@/lib/workflow/status";
import type { WorkflowStepStatus } from "@/lib/workflow/types";

/** D109 (brief #5s) — step 16 unlocks on steps 7, 9, 10 and 13 saved or NA; step 14 is no longer a prerequisite. */
const CODES = [
  "RECORD_SALES", "RECEIVE_2307", "PREPARE_RETURN", "ADVISE_CLIENT", "FILE_RETURN", "SAVE_SUBMISSION_SS", "SAVE_FORM_COPY",
  "MAKE_PAYMENT", "SAVE_PROOF_PAYMENT", "RECEIVE_TRRC", "ALPHALIST_ENTRY", "EMAIL_DAT", "SAWT_ACK", "SAWT_VALIDATION",
  "EAFS_SUBMIT", "SEND_CLIENT_PACKAGE",
];
function filing(overrides: Record<string, WorkflowStepStatus> = {}) {
  return CODES.map((stepCode) => ({
    stepCode,
    status: (overrides[stepCode] ?? (stepCode === "SEND_CLIENT_PACKAGE" ? "PENDING" : "DONE")) as WorkflowStepStatus,
    waitingOnLabel: (stepCode === "SAWT_VALIDATION" ? "BIR" : null) as string | null,
  }));
}
const lock = (steps: ReturnType<typeof filing>) => stepLockReason("SEND_CLIENT_PACKAGE", steps);

describe("step 16's unlock rule (D109)", () => {
  it("unlocks with step 13 saved and step 14 still waiting", () => {
    expect(lock(filing({ SAWT_VALIDATION: "WAITING_EXTERNAL" }))).toBeNull();
  });

  it("stays locked with step 13 missing", () => {
    expect(lock(filing({ SAWT_ACK: "WAITING_EXTERNAL" }))).toMatch(/Available once/);
    expect(lock(filing({ SAWT_ACK: "PENDING" }))).toMatch(/Available once/);
  });

  it("stays locked with step 7, 9 or 10 missing", () => {
    for (const code of ["SAVE_FORM_COPY", "SAVE_PROOF_PAYMENT", "RECEIVE_TRRC"]) {
      expect(lock(filing({ [code]: "WAITING_EXTERNAL" }))).toMatch(/Available once/);
    }
  });

  it("unlocks on a no-certificate filing (13 and 14 not applicable)", () => {
    expect(lock(filing({ SAWT_ACK: "NA", SAWT_VALIDATION: "NA" }))).toBeNull();
  });

  it("with step 16 open and step 14 waiting: Next is step 16, the filing sits in BIR Confirmations, and it reads In progress", () => {
    const steps = filing({ SAWT_VALIDATION: "WAITING_EXTERNAL" });
    expect(nextActionForFiling(steps)).toEqual({ kind: "work", stepCode: "SEND_CLIENT_PACKAGE" });
    expect(currentGroupCode(steps)).toBe("BIR_CONFIRMATIONS");
    expect(deriveFilingStatus({ steps, adjustedDueDate: new Date("2099-01-01T00:00:00.000Z"), now: new Date("2026-10-01T00:00:00.000Z") })).toBe("IN_PROGRESS");
  });

  it("reaches Complete only once step 14 is saved too", () => {
    const now = new Date("2026-10-01T00:00:00.000Z");
    const due = new Date("2099-01-01T00:00:00.000Z");
    const sent = filing({ SEND_CLIENT_PACKAGE: "DONE", SAWT_VALIDATION: "WAITING_EXTERNAL" });
    expect(deriveFilingStatus({ steps: sent, adjustedDueDate: due, now })).toBe("WAITING_BIR");
    expect(deriveFilingStatus({ steps: filing({ SEND_CLIENT_PACKAGE: "DONE" }), adjustedDueDate: due, now })).toBe("COMPLETE");
  });
});
