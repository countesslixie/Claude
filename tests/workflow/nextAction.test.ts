import { describe, it, expect } from "vitest";
import { nextActionForFiling, stepLockReason, eafsGroupBlockReason, WORKFLOW_GROUPS } from "@/lib/workflow/groups";
import type { WorkflowStepStatus } from "@/lib/workflow/types";

/**
 * D84/D85 (brief #5o) — "Next" is the first open step in GROUP order that is
 * her work: locked steps and BIR waits (10, 13, 14 WAITING_EXTERNAL) are
 * skipped; only when nothing of hers is left does it report the BIR wait.
 * The step-status maps below mirror the sample scenarios A-H.
 */
const ALL = WORKFLOW_GROUPS.flatMap((g) => g.stepCodes);
function steps(over: Partial<Record<string, WorkflowStepStatus>>, base: WorkflowStepStatus = "PENDING") {
  return ALL.map((stepCode) => ({ stepCode, status: (over[stepCode] ?? base) as WorkflowStepStatus }));
}
const D: Partial<Record<string, WorkflowStepStatus>> = {
  RECORD_SALES: "DONE", RECEIVE_2307: "DONE", PREPARE_RETURN: "DONE", ADVISE_CLIENT: "DONE",
  FILE_RETURN: "DONE", SAVE_SUBMISSION_SS: "DONE", SAVE_FORM_COPY: "DONE", MAKE_PAYMENT: "DONE", SAVE_PROOF_PAYMENT: "DONE",
  RECEIVE_TRRC: "WAITING_EXTERNAL",
};

describe("nextActionForFiling", () => {
  it("A/B: a fresh Q3 -> step 1 (waiting on the client is still her work to chase)", () => {
    expect(nextActionForFiling(steps({ RECORD_SALES: "WAITING_EXTERNAL", RECEIVE_2307: "WAITING_EXTERNAL" }))).toEqual({ kind: "work", stepCode: "RECORD_SALES" });
  });
  it("D: filed and paid, TRRC waiting -> step 11, not the TRRC", () => {
    expect(nextActionForFiling(steps(D))).toEqual({ kind: "work", stepCode: "ALPHALIST_ENTRY" });
  });
  it("D after step 11 and 12: step 13 is waiting on BIR, so step 15 is next", () => {
    expect(nextActionForFiling(steps({ ...D, ALPHALIST_ENTRY: "DONE", EMAIL_DAT: "DONE", SAWT_ACK: "WAITING_EXTERNAL" }))).toEqual({ kind: "work", stepCode: "EAFS_SUBMIT" });
  });
  it("E: no certificates (eAFS all NA), TRRC waiting, step 16 not ready -> only the BIR wait is left", () => {
    const e = steps({ ...D, MAKE_PAYMENT: "NA", SAVE_PROOF_PAYMENT: "NA", ALPHALIST_ENTRY: "NA", EMAIL_DAT: "NA", SAWT_ACK: "NA", SAWT_VALIDATION: "NA", EAFS_SUBMIT: "NA" });
    expect(nextActionForFiling(e)).toEqual({ kind: "birWait", stepCodes: ["RECEIVE_TRRC"] });
  });
  it("F: step 5 done, steps 6/7 open, TRRC waiting -> step 6", () => {
    expect(nextActionForFiling(steps({ ...D, SAVE_SUBMISSION_SS: "PENDING", SAVE_FORM_COPY: "PENDING", MAKE_PAYMENT: "PENDING", SAVE_PROOF_PAYMENT: "PENDING" }))).toEqual({ kind: "work", stepCode: "SAVE_SUBMISSION_SS" });
  });
  it("G: everything of hers done, TRRC and eAFS validation waiting, step 16 not ready -> BIR wait, both named", () => {
    const g = steps({ ...D, ALPHALIST_ENTRY: "DONE", EMAIL_DAT: "DONE", SAWT_ACK: "DONE", EAFS_SUBMIT: "DONE", SAWT_VALIDATION: "WAITING_EXTERNAL" });
    expect(nextActionForFiling(g)).toEqual({ kind: "birWait", stepCodes: ["RECEIVE_TRRC", "SAWT_VALIDATION"] });
  });
  it("step 16 becomes next once the BIR documents are in", () => {
    expect(nextActionForFiling(steps({ ...D, RECEIVE_TRRC: "DONE", ALPHALIST_ENTRY: "NA", EMAIL_DAT: "NA", SAWT_ACK: "NA", SAWT_VALIDATION: "NA", EAFS_SUBMIT: "NA" }))).toEqual({ kind: "work", stepCode: "SEND_CLIENT_PACKAGE" });
  });
  it("complete when everything is resolved", () => {
    expect(nextActionForFiling(steps({}, "DONE"))).toEqual({ kind: "complete" });
  });
});

describe("eAFS locked until File and Pay are Done (D85)", () => {
  it("locked with Pay open, or File open", () => {
    expect(eafsGroupBlockReason(steps({ ...D, SAVE_PROOF_PAYMENT: "PENDING" }))).toBe("Available once Pay is done.");
    expect(eafsGroupBlockReason(steps({ ...D, SAVE_FORM_COPY: "PENDING" }))).toBe("Available once Pay is done.");
    for (const code of ["ALPHALIST_ENTRY", "EMAIL_DAT", "SAWT_ACK", "EAFS_SUBMIT"]) {
      expect(stepLockReason(code, steps({ ...D, SAVE_PROOF_PAYMENT: "PENDING" }))).toBe("Available once Pay is done.");
    }
  });
  it("open once File and Pay are Done — and Pay counts as done when it's 'nothing to pay' (8/9 NA)", () => {
    expect(eafsGroupBlockReason(steps(D))).toBeNull();
    expect(eafsGroupBlockReason(steps({ ...D, MAKE_PAYMENT: "NA", SAVE_PROOF_PAYMENT: "NA" }))).toBeNull();
  });
  it("12 needs 11, 13 needs 12", () => {
    expect(stepLockReason("EMAIL_DAT", steps(D))).toBe("Available once step 11 is done.");
    expect(stepLockReason("SAWT_ACK", steps({ ...D, ALPHALIST_ENTRY: "DONE" }))).toBe("Available once step 12 is done.");
    expect(stepLockReason("SAWT_ACK", steps({ ...D, ALPHALIST_ENTRY: "DONE", EMAIL_DAT: "DONE" }))).toBeNull();
  });
});
