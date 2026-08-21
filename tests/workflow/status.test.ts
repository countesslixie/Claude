import { describe, it, expect } from "vitest";
import { deriveFilingStatus, computeProgressPercent, currentStepCode } from "@/lib/workflow/status";
import type { StepForStatus } from "@/lib/workflow/status";

const DUE = new Date("2026-08-17T00:00:00.000Z");
const BEFORE_DUE = new Date("2026-08-01T00:00:00.000Z");
const AFTER_DUE = new Date("2026-09-01T00:00:00.000Z");

function step(status: StepForStatus["status"], waitingOnLabel: string | null = null): StepForStatus {
  return { status, waitingOnLabel };
}

describe("deriveFilingStatus", () => {
  it("no steps -> NOT_STARTED", () => {
    expect(deriveFilingStatus({ steps: [], adjustedDueDate: DUE, now: BEFORE_DUE })).toBe("NOT_STARTED");
  });

  it("all PENDING -> NOT_STARTED", () => {
    const steps = [step("PENDING"), step("PENDING")];
    expect(deriveFilingStatus({ steps, adjustedDueDate: DUE, now: BEFORE_DUE })).toBe("NOT_STARTED");
  });

  it("some DONE, rest PENDING -> IN_PROGRESS", () => {
    const steps = [step("DONE"), step("PENDING")];
    expect(deriveFilingStatus({ steps, adjustedDueDate: DUE, now: BEFORE_DUE })).toBe("IN_PROGRESS");
  });

  it("all DONE/NA -> COMPLETE, even past the due date", () => {
    const steps = [step("DONE"), step("NA"), step("DONE")];
    expect(deriveFilingStatus({ steps, adjustedDueDate: DUE, now: AFTER_DUE })).toBe("COMPLETE");
  });

  it("past adjustedDueDate and not complete -> BLOCKED, even if a step is waiting on BIR", () => {
    // BLOCKED takes priority: being overdue is the more urgent signal
    // regardless of what's specifically being waited on.
    const steps = [step("DONE"), step("WAITING_EXTERNAL", "BIR")];
    expect(deriveFilingStatus({ steps, adjustedDueDate: DUE, now: AFTER_DUE })).toBe("BLOCKED");
  });

  it("still on the due date's own Manila calendar day (even hours after DUE's UTC-midnight/Manila-08:00 marker) -> NOT yet BLOCKED", () => {
    // UTC/Manila sweep regression: DUE is UTC midnight Aug 17 (Manila
    // 08:00). A raw instant comparison would flip to BLOCKED the moment
    // `now` passes that instant, treating Aug 17 10am Manila -- still
    // the due date itself -- as already overdue.
    const stillDueDayManila = new Date("2026-08-17T02:00:00.000Z"); // Manila Aug 17, 10am
    const steps = [step("DONE"), step("WAITING_EXTERNAL", "BIR")];
    expect(deriveFilingStatus({ steps, adjustedDueDate: DUE, now: stillDueDayManila })).toBe("WAITING_BIR");
  });

  it("the day after the due date's Manila calendar day -> BLOCKED", () => {
    const nextDayManila = new Date("2026-08-17T20:00:00.000Z"); // Manila Aug 18, 4am
    const steps = [step("DONE"), step("WAITING_EXTERNAL", "BIR")];
    expect(deriveFilingStatus({ steps, adjustedDueDate: DUE, now: nextDayManila })).toBe("BLOCKED");
  });

  it("waiting on a BIR step, not yet due -> WAITING_BIR", () => {
    const steps = [step("DONE"), step("WAITING_EXTERNAL", "BIR")];
    expect(deriveFilingStatus({ steps, adjustedDueDate: DUE, now: BEFORE_DUE })).toBe("WAITING_BIR");
  });

  it("waiting on a client step, not yet due -> WAITING_CLIENT", () => {
    const steps = [step("DONE"), step("WAITING_EXTERNAL", "Client")];
    expect(deriveFilingStatus({ steps, adjustedDueDate: DUE, now: BEFORE_DUE })).toBe("WAITING_CLIENT");
  });

  it("BIR waiting takes priority over client waiting when both are present", () => {
    const steps = [step("WAITING_EXTERNAL", "BIR"), step("WAITING_EXTERNAL", "Client")];
    expect(deriveFilingStatus({ steps, adjustedDueDate: DUE, now: BEFORE_DUE })).toBe("WAITING_BIR");
  });
});

/** SPEC.md §16 item 12: steps marked NA are excluded from progress %. */
describe("computeProgressPercent", () => {
  it("excludes NA steps from the denominator", () => {
    // 2 DONE out of 4 applicable (2 NA excluded) = 50%, not 2/6 = 33%.
    const steps = [
      { status: "DONE" as const },
      { status: "DONE" as const },
      { status: "PENDING" as const },
      { status: "PENDING" as const },
      { status: "NA" as const },
      { status: "NA" as const },
    ];
    expect(computeProgressPercent(steps)).toBe(50);
  });

  it("a filing with zero 2307s (steps 11-14 all NA) computes progress from the remaining 12 steps", () => {
    const steps = [
      ...Array(10).fill({ status: "DONE" as const }),
      { status: "NA" as const },
      { status: "NA" as const },
      { status: "NA" as const },
      { status: "NA" as const },
      { status: "PENDING" as const },
      { status: "PENDING" as const },
    ];
    // 10 done out of 12 applicable (16 total - 4 NA)
    expect(computeProgressPercent(steps)).toBe(Math.round((10 / 12) * 100));
  });
});

describe("currentStepCode", () => {
  it("returns the earliest not-yet-resolved step by sequence, regardless of array order", () => {
    const steps = [
      { sequence: 3, status: "PENDING" as const, stepCode: "PREPARE_RETURN" },
      { sequence: 1, status: "DONE" as const, stepCode: "RECEIVE_2307" },
      { sequence: 2, status: "DONE" as const, stepCode: "RECORD_CRJ" },
    ];
    expect(currentStepCode(steps)).toBe("PREPARE_RETURN");
  });

  it("skips over SKIPPED and NA steps, not just DONE ones", () => {
    const steps = [
      { sequence: 1, status: "DONE" as const, stepCode: "RECEIVE_2307" },
      { sequence: 2, status: "SKIPPED" as const, stepCode: "RECORD_CRJ" },
      { sequence: 3, status: "NA" as const, stepCode: "ALPHALIST_ENTRY" },
      { sequence: 4, status: "WAITING_EXTERNAL" as const, stepCode: "RECEIVE_TRRC" },
    ];
    expect(currentStepCode(steps)).toBe("RECEIVE_TRRC");
  });

  it("returns null when every step is resolved — the filing belongs in the Complete lane", () => {
    const steps = [
      { sequence: 1, status: "DONE" as const, stepCode: "RECEIVE_2307" },
      { sequence: 2, status: "NA" as const, stepCode: "ALPHALIST_ENTRY" },
    ];
    expect(currentStepCode(steps)).toBeNull();
  });
});
