import { describe, it, expect } from "vitest";
import { stepDueDate } from "@/lib/workflow/dueDate";

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

// A Q3 filing: adjusted due Nov 16, working calendar certificatesExpectedBy
// Nov 5 / internalFilingTarget Nov 15 (Phase 2b P7 pattern).
const FILING = {
  certificatesExpectedBy: D("2026-11-05"),
  internalFilingTarget: D("2026-11-15"),
  adjustedDueDate: D("2026-11-16"),
};

describe("stepDueDate", () => {
  it("RECEIVE_2307 shows certificatesExpectedBy + expectedResponseDays, not the filing's adjustedDueDate", () => {
    const due = stepDueDate({
      stepCode: "RECEIVE_2307",
      status: "WAITING_EXTERNAL",
      waitingSince: FILING.certificatesExpectedBy,
      expectedResponseDays: 5,
      certificatesExpectedBy: FILING.certificatesExpectedBy,
      internalFilingTarget: FILING.internalFilingTarget,
      adjustedDueDate: FILING.adjustedDueDate,
    });
    expect(due).toEqual(D("2026-11-10"));
    expect(due).not.toEqual(FILING.adjustedDueDate);
  });

  it("RECEIVE_2307's due date is the exact day deriveStepAging's badge turns amber", async () => {
    const { deriveStepAging } = await import("@/lib/workflow/aging");
    const expectedResponseDays = 5;
    const due = stepDueDate({
      stepCode: "RECEIVE_2307",
      status: "WAITING_EXTERNAL",
      waitingSince: FILING.certificatesExpectedBy,
      expectedResponseDays,
      certificatesExpectedBy: FILING.certificatesExpectedBy,
      internalFilingTarget: FILING.internalFilingTarget,
      adjustedDueDate: FILING.adjustedDueDate,
    });
    expect(due).toEqual(D("2026-11-10"));

    const agingBeforeDue = deriveStepAging({
      stepCode: "RECEIVE_2307",
      status: "WAITING_EXTERNAL",
      waitingSince: FILING.certificatesExpectedBy,
      expectedResponseDays,
      certificatesExpectedBy: FILING.certificatesExpectedBy,
      now: D("2026-11-09"),
    });
    const agingOnDue = deriveStepAging({
      stepCode: "RECEIVE_2307",
      status: "WAITING_EXTERNAL",
      waitingSince: FILING.certificatesExpectedBy,
      expectedResponseDays,
      certificatesExpectedBy: FILING.certificatesExpectedBy,
      now: due,
    });
    expect(agingBeforeDue?.tone).toBe("green");
    expect(agingOnDue?.tone).toBe("amber");
  });

  it("RECEIVE_2307 stays anchored on certificatesExpectedBy even if waitingSince has drifted (e.g. after a re-flip to WAITING_EXTERNAL stamps waitingSince to \"now\")", () => {
    // deriveStepAging unconditionally overrides RECEIVE_2307's clock to
    // certificatesExpectedBy regardless of waitingSince (aging.ts) — the
    // due date must do the same, or a re-flipped step would show a due
    // date computed from the stale waitingSince while the badge still
    // measures from certificatesExpectedBy.
    const due = stepDueDate({
      stepCode: "RECEIVE_2307",
      status: "WAITING_EXTERNAL",
      waitingSince: D("2026-12-25"), // drifted: re-stamped to "now" by a re-flip
      expectedResponseDays: 5,
      certificatesExpectedBy: FILING.certificatesExpectedBy,
      internalFilingTarget: FILING.internalFilingTarget,
      adjustedDueDate: FILING.adjustedDueDate,
    });
    expect(due).toEqual(D("2026-11-10"));
    expect(due).not.toEqual(D("2026-12-30"));
  });

  it("a waiting step (not RECEIVE_2307) shows waitingSince + expectedResponseDays, not the filing's adjustedDueDate", () => {
    // RECEIVE_TRRC, waiting since Aug 17 with a 3-day expected response —
    // due Aug 20, nowhere near the filing's own adjustedDueDate.
    const due = stepDueDate({
      stepCode: "RECEIVE_TRRC",
      status: "WAITING_EXTERNAL",
      waitingSince: D("2026-08-17"),
      expectedResponseDays: 3,
      certificatesExpectedBy: null,
      internalFilingTarget: null,
      adjustedDueDate: D("2026-08-17"),
    });
    expect(due).toEqual(D("2026-08-20"));
    expect(due).not.toEqual(D("2026-08-17"));
  });

  it("this is the same clock deriveStepAging's badge measures against", async () => {
    const { deriveStepAging } = await import("@/lib/workflow/aging");
    const waitingSince = D("2026-08-17");
    const expectedResponseDays = 3;
    const now = D("2026-08-29"); // 12 days after waitingSince

    const due = stepDueDate({
      stepCode: "RECEIVE_TRRC",
      status: "WAITING_EXTERNAL",
      waitingSince,
      expectedResponseDays,
      certificatesExpectedBy: null,
      internalFilingTarget: null,
      adjustedDueDate: D("2026-08-17"),
    });
    const aging = deriveStepAging({
      stepCode: "RECEIVE_TRRC",
      status: "WAITING_EXTERNAL",
      waitingSince,
      expectedResponseDays,
      certificatesExpectedBy: null,
      now,
    });
    // due date is 3 days after waitingSince; "now" is 12 days after
    // waitingSince, so the step is 9 days past its displayed due date —
    // consistent with the badge already reading red (>= 2x expected).
    expect(due).toEqual(D("2026-08-20"));
    expect(aging?.tone).toBe("red");
  });

  it("FILE_RETURN shows the filing's adjustedDueDate — it genuinely is the statutory deadline", () => {
    const due = stepDueDate({
      stepCode: "FILE_RETURN",
      status: "PENDING",
      waitingSince: null,
      expectedResponseDays: null,
      certificatesExpectedBy: FILING.certificatesExpectedBy,
      internalFilingTarget: FILING.internalFilingTarget,
      adjustedDueDate: FILING.adjustedDueDate,
    });
    expect(due).toEqual(FILING.adjustedDueDate);
  });

  it("a prep step not yet waiting shows internalFilingTarget, not the filing's adjustedDueDate", () => {
    const due = stepDueDate({
      stepCode: "RECORD_CRJ",
      status: "PENDING",
      waitingSince: null,
      expectedResponseDays: null,
      certificatesExpectedBy: FILING.certificatesExpectedBy,
      internalFilingTarget: FILING.internalFilingTarget,
      adjustedDueDate: FILING.adjustedDueDate,
    });
    expect(due).toEqual(D("2026-11-15"));
    expect(due).not.toEqual(FILING.adjustedDueDate);
  });

  it("a waiting step's due date lands on the correct Manila calendar day even when waitingSince carries an early-Manila-morning time-of-day", () => {
    // A real (non-seed) waitingSince is `new Date()` at the moment a
    // bookkeeper clicks "waiting," not a clean midnight. Manila 2026-08-20
    // 03:00 is UTC 2026-08-19 19:00 -- a naive getUTCDate()-based addDays
    // would add `days` starting from Aug 19 (the UTC day), landing the
    // result a day early. It must land on Aug 23 (3 days after the
    // Manila-side Aug 20), not Aug 22.
    const waitingSince = new Date("2026-08-19T19:00:00.000Z"); // Manila Aug 20, 03:00
    const due = stepDueDate({
      stepCode: "RECEIVE_TRRC",
      status: "WAITING_EXTERNAL",
      waitingSince,
      expectedResponseDays: 3,
      certificatesExpectedBy: null,
      internalFilingTarget: null,
      adjustedDueDate: waitingSince,
    });
    // due, converted to Manila, must fall on Aug 23 -- not Aug 22.
    const manilaDate = new Date(due.getTime() + 8 * 60 * 60 * 1000);
    expect(manilaDate.getUTCDate()).toBe(23);
    expect(manilaDate.getUTCMonth()).toBe(7); // August (0-indexed)
  });

  it("falls back to adjustedDueDate only when no internalFilingTarget was ever set", () => {
    const due = stepDueDate({
      stepCode: "RECORD_CRJ",
      status: "PENDING",
      waitingSince: null,
      expectedResponseDays: null,
      certificatesExpectedBy: null,
      internalFilingTarget: null,
      adjustedDueDate: FILING.adjustedDueDate,
    });
    expect(due).toEqual(FILING.adjustedDueDate);
  });
});
