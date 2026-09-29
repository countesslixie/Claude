import { describe, it, expect } from "vitest";
import { filingOrderBlockReason, unfiledEarlierPeriods, type FilingOrderContext } from "@/lib/workflow/filingOrder";
import { stepLockReason, nextActionForFiling, WORKFLOW_GROUPS } from "@/lib/workflow/groups";
import type { WorkflowStepStatus } from "@/lib/workflow/types";

/** D95 (brief #5q) — quarters are filed in order. Pure checks; no database. */
const row = (period: string, o: { filed?: boolean; outside?: boolean } = {}) => ({
  period,
  filedOutsideApp: o.outside ?? false,
  fileReturnStatus: o.filed ? "DONE" : "PENDING",
});
const ctx = (period: string, siblings: ReturnType<typeof row>[], latestOutsideReturn: FilingOrderContext["latestOutsideReturn"] = "NONE"): FilingOrderContext => ({
  taxableYear: 2026,
  period,
  siblings,
  latestOutsideReturn,
});

describe("filingOrderBlockReason (D95)", () => {
  it("Q1 has no earlier return", () => {
    expect(filingOrderBlockReason(ctx("Q1", [row("Q1"), row("Q2"), row("Q3"), row("ANNUAL")]))).toBeNull();
  });
  it("Q2 is refused while Q1 is unfiled, with a plain message", () => {
    expect(filingOrderBlockReason(ctx("Q2", [row("Q1"), row("Q2")]))).toBe("File Q1 2026 first.");
  });
  it("Q2 is allowed once Q1 is filed", () => {
    expect(filingOrderBlockReason(ctx("Q2", [row("Q1", { filed: true }), row("Q2")]))).toBeNull();
  });
  it("Q2 is allowed when Q1 has no row because the starting figures name it as filed outside the app", () => {
    expect(filingOrderBlockReason(ctx("Q2", [row("Q2")], "Q1"))).toBeNull();
  });
  it("Q2 is allowed when Q1's row has filedOutsideApp", () => {
    expect(filingOrderBlockReason(ctx("Q2", [row("Q1", { outside: true }), row("Q2")]))).toBeNull();
  });
  it("Q3 names both quarters when neither is filed", () => {
    expect(filingOrderBlockReason(ctx("Q3", [row("Q1"), row("Q2"), row("Q3")]))).toBe("File Q1 and Q2 2026 first.");
  });
  it("Annual is refused while Q3 is unfiled, naming Q3 only", () => {
    const siblings = [row("Q1", { filed: true }), row("Q2", { filed: true }), row("Q3"), row("ANNUAL")];
    expect(filingOrderBlockReason(ctx("ANNUAL", siblings))).toBe("File Q3 2026 first.");
  });
  it("Annual is allowed once Q1, Q2 and Q3 are filed, however each was filed", () => {
    const siblings = [row("Q1", { filed: true }), row("Q2", { outside: true }), row("Q3", { filed: true }), row("ANNUAL")];
    expect(filingOrderBlockReason(ctx("ANNUAL", siblings))).toBeNull();
  });
  it("an earlier quarter with no row and no starting-figures cover is refused", () => {
    expect(unfiledEarlierPeriods(ctx("Q3", [row("Q2", { filed: true }), row("Q3")], "NONE"))).toEqual(["Q1"]);
    // starting figures naming only Q1 do not cover a missing Q2
    expect(unfiledEarlierPeriods(ctx("Q3", [row("Q3")], "Q1"))).toEqual(["Q2"]);
  });
});

describe("stepLockReason and Next with the guard (D95/D84)", () => {
  const ALL = WORKFLOW_GROUPS.flatMap((g) => g.stepCodes);
  const st = (over: Partial<Record<string, WorkflowStepStatus>>) =>
    ALL.map((stepCode) => ({ stepCode, status: (over[stepCode] ?? "PENDING") as WorkflowStepStatus }));
  const prepared = st({ RECORD_SALES: "DONE", RECEIVE_2307: "DONE", PREPARE_RETURN: "DONE", ADVISE_CLIENT: "DONE" });

  it("stepLockReason returns the message for step 5 only", () => {
    expect(stepLockReason("FILE_RETURN", prepared, "File Q1 2026 first.")).toBe("File Q1 2026 first.");
    expect(stepLockReason("FILE_RETURN", prepared, null)).toBeNull();
    expect(stepLockReason("FILE_RETURN", prepared)).toBeNull();
    expect(stepLockReason("PREPARE_RETURN", prepared, "File Q1 2026 first.")).toBeNull();
  });

  it("a filing held back only by the guard still has Next = step 5, never blank", () => {
    expect(nextActionForFiling(prepared, "File Q1 2026 first.")).toEqual({ kind: "work", stepCode: "FILE_RETURN" });
    expect(nextActionForFiling(prepared)).toEqual({ kind: "work", stepCode: "FILE_RETURN" });
  });
});
