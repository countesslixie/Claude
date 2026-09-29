import { describe, it, expect } from "vitest";
import { deriveStepAging } from "@/lib/workflow/aging";

const NOW = new Date("2026-08-20T00:00:00.000Z");

describe("deriveStepAging", () => {
  it("returns null when the step isn't WAITING_EXTERNAL", () => {
    expect(
      deriveStepAging({
        stepCode: "RECEIVE_TRRC",
        status: "PENDING",
        waitingSince: null,
        expectedResponseDays: 3,
        certificatesExpectedBy: null,
        now: NOW,
      }),
    ).toBeNull();
  });

  it("green when under the expected response days", () => {
    const result = deriveStepAging({
      stepCode: "RECEIVE_TRRC",
      status: "WAITING_EXTERNAL",
      waitingSince: new Date("2026-08-19T00:00:00.000Z"), // 1 day ago
      expectedResponseDays: 3,
      certificatesExpectedBy: null,
      now: NOW,
    });
    expect(result).toEqual({ daysWaiting: 1, tone: "green" });
  });

  it("amber at exactly 1x expected response days", () => {
    const result = deriveStepAging({
      stepCode: "RECEIVE_TRRC",
      status: "WAITING_EXTERNAL",
      waitingSince: new Date("2026-08-17T00:00:00.000Z"), // 3 days ago
      expectedResponseDays: 3,
      certificatesExpectedBy: null,
      now: NOW,
    });
    expect(result).toEqual({ daysWaiting: 3, tone: "amber" });
  });

  it("red at exactly 2x expected response days — SPEC.md §16 item 15", () => {
    const result = deriveStepAging({
      stepCode: "RECEIVE_TRRC",
      status: "WAITING_EXTERNAL",
      waitingSince: new Date("2026-08-14T00:00:00.000Z"), // 6 days ago
      expectedResponseDays: 3,
      certificatesExpectedBy: null,
      now: NOW,
    });
    expect(result).toEqual({ daysWaiting: 6, tone: "red" });
  });

  it("RECEIVE_2307 anchors on certificatesExpectedBy, not waitingSince (SPEC.md 3.6)", () => {
    // waitingSince says "just started waiting" (0 days), but
    // certificatesExpectedBy was 7 days ago with a 3-day expected
    // response — should read as red (6+ days), not green.
    const result = deriveStepAging({
      stepCode: "RECEIVE_2307",
      status: "WAITING_EXTERNAL",
      waitingSince: NOW,
      expectedResponseDays: 3,
      certificatesExpectedBy: new Date("2026-08-13T00:00:00.000Z"), // 7 days ago
      now: NOW,
    });
    expect(result).toEqual({ daysWaiting: 7, tone: "red" });
  });

  it("RECEIVE_2307 with certificatesExpectedBy still in the future reads as 0 days, not negative", () => {
    const result = deriveStepAging({
      stepCode: "RECEIVE_2307",
      status: "WAITING_EXTERNAL",
      waitingSince: NOW,
      expectedResponseDays: 5,
      certificatesExpectedBy: new Date("2026-09-01T00:00:00.000Z"), // in the future
      now: NOW,
    });
    expect(result).toEqual({ daysWaiting: 0, tone: "green" });
  });

  it("a non-RECEIVE_2307 step ignores certificatesExpectedBy entirely", () => {
    const result = deriveStepAging({
      stepCode: "RECEIVE_TRRC",
      status: "WAITING_EXTERNAL",
      waitingSince: new Date("2026-08-19T00:00:00.000Z"), // 1 day ago
      expectedResponseDays: 3,
      certificatesExpectedBy: new Date("2026-01-01T00:00:00.000Z"), // would be huge if used
      now: NOW,
    });
    expect(result).toEqual({ daysWaiting: 1, tone: "green" });
  });
});

// D79 (brief #5n §2) — the board's BIR-wait tag reads the same thresholds as the step pill.
import { birWaitTags, birWaitTone } from "@/lib/workflow/aging";

describe("birWaitTags (D79)", () => {
  const step = (stepCode: string, daysAgo: number | null, status: "WAITING_EXTERNAL" | "PENDING" | "DONE" = "WAITING_EXTERNAL") => ({
    stepCode,
    status,
    waitingSince: daysAgo == null ? null : new Date(NOW.getTime() - daysAgo * 86_400_000),
    expectedResponseDays: 3, // TRRC/SAWT-validation template value irrelevant; tag must follow deriveStepAging
  });

  it("names step 10 and step 14 with days waiting", () => {
    const tags = birWaitTags([step("RECEIVE_TRRC", 2), step("SAWT_VALIDATION", 8)], null, NOW);
    expect(tags.map((t) => t.text)).toEqual(["TRRC · 2d", "SAWT validation · 8d"]);
  });

  it("amber while waiting, red at twice expectedResponseDays — the pill's own thresholds", () => {
    for (const days of [0, 2, 3, 5, 6, 9]) {
      const tag = birWaitTags([step("RECEIVE_TRRC", days)], null, NOW)[0];
      const aging = deriveStepAging({ ...step("RECEIVE_TRRC", days), certificatesExpectedBy: null, now: NOW })!;
      expect(tag.tone).toBe(birWaitTone(aging.tone));
      expect(tag.tone).toBe(days >= 6 ? "overdue" : "waiting");
    }
  });

  it("never green (day zero is amber)", () => {
    expect(birWaitTags([step("RECEIVE_TRRC", 0)], null, NOW)[0].tone).toBe("waiting");
  });

  it("no tag for a step that isn't waiting, or for other waiting steps", () => {
    expect(birWaitTags([step("RECEIVE_TRRC", 2, "DONE"), step("SAWT_VALIDATION", null, "PENDING")], null, NOW)).toEqual([]);
    expect(birWaitTags([step("SAWT_ACK", 2), step("RECORD_SALES", 2)], null, NOW)).toEqual([]);
  });
});
