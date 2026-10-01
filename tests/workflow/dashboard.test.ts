import { describe, it, expect } from "vitest";
import { DASHBOARD_SECTIONS, sortByDueThenClient } from "@/lib/workflow/dashboardRows";
import { agingPillTone } from "@/lib/workflow/aging";
import { clientWaitDueDate, periodHasEnded } from "@/lib/workflow/clientWait";
import { displaySourceNote } from "@/lib/sheetText";
import { periodLabel } from "@/lib/periodLabel";
import { filingStatusLabel } from "@/lib/workflow/status";

describe("dashboard sections (D126)", () => {
  it("come in the agreed order, with no Upcoming deadlines", () => {
    expect([...DASHBOARD_SECTIONS]).toEqual([
      "Needs my action now",
      "Waiting on client",
      "Waiting on BIR",
      "Missing documents",
      "Threshold & election alerts",
    ]);
    expect(DASHBOARD_SECTIONS.join(" ")).not.toMatch(/Upcoming/);
  });
});

describe("dashboard sort (D129)", () => {
  it("earliest due date first, then client name", () => {
    const d = (s: string) => new Date(s);
    const rows = [
      { dueDate: d("2026-11-16"), clientName: "Zed" },
      { dueDate: d("2026-10-20"), clientName: "Beta" },
      { dueDate: d("2026-10-20"), clientName: "Alpha" },
      { dueDate: d("2026-09-01"), clientName: "Omega" },
    ];
    expect(sortByDueThenClient(rows).map((r) => r.clientName)).toEqual(["Omega", "Alpha", "Beta", "Zed"]);
  });
});

describe("aging pill colour (D129, D72)", () => {
  it("a BIR wait is never green", () => {
    for (const code of ["RECEIVE_TRRC", "SAWT_ACK", "SAWT_VALIDATION"]) {
      for (const tone of ["green", "amber", "red"] as const) {
        expect(agingPillTone(code, tone)).not.toBe("done");
      }
      expect(agingPillTone(code, "red")).toBe("overdue");
    }
  });
  it("a client wait keeps green / amber / red", () => {
    expect(agingPillTone("RECORD_SALES", "green")).toBe("done");
    expect(agingPillTone("RECORD_SALES", "amber")).toBe("waiting");
    expect(agingPillTone("RECORD_SALES", "red")).toBe("overdue");
  });
});

describe("client waits (D130)", () => {
  it("an Annual is not listed before January 1, and is from then on", () => {
    expect(periodHasEnded(2026, "ANNUAL", new Date("2026-12-31T10:00:00Z"))).toBe(false);
    expect(periodHasEnded(2026, "ANNUAL", new Date("2026-12-31T16:30:00Z"))).toBe(true); // already Jan 1 in Manila
    expect(periodHasEnded(2026, "Q3", new Date("2026-10-01T00:00:00Z"))).toBe(true);
    expect(periodHasEnded(2026, "Q3", new Date("2026-09-29T00:00:00Z"))).toBe(false);
  });
  it("Due is the documents-due date (January 20 for the Annual)", () => {
    const jan20 = new Date("2027-01-20T00:00:00Z");
    expect(clientWaitDueDate(jan20, new Date("2026-10-11T00:00:00Z"))).toBe(jan20);
    expect(clientWaitDueDate(null, new Date("2026-10-11T00:00:00Z")).toISOString()).toBe("2026-10-11T00:00:00.000Z");
  });
});

describe("display wording", () => {
  it("drops the preparation-aid sentence but keeps the rest of a note (D121)", () => {
    expect(displaySourceNote("This is a preparation aid. The filed return and BIR's own assessment govern.")).toBe("");
    expect(displaySourceNote("54 - 62. This is a preparation aid — the filed return and BIR's own assessment govern.")).toBe("54 - 62.");
    expect(displaySourceNote("53 × 8.00%")).toBe("53 × 8.00%");
  });
  it("Annual in title case; Complete without a skipped count (D129, D124)", () => {
    expect(periodLabel("ANNUAL")).toBe("Annual");
    expect(periodLabel("Q3")).toBe("Q3");
    expect(filingStatusLabel("COMPLETE")).toBe("Complete");
  });
});
