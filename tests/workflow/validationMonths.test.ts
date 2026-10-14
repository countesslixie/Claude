import { describe, it, expect } from "vitest";
import {
  validationMonthsForFiling,
  validationSlotDefs,
  validationSlotCode,
  isLegacyDoneStep11,
  monthLabel,
} from "@/lib/workflow/validationMonths";

/** D200 — which months step 11 asks a validation file for. Fictitious periods only. */
const months = (period: string, certs: [string, string][], year = 2026) =>
  validationMonthsForFiling({ period, taxableYear: year, certificates: certs.map(([a, b]) => ({ periodFromDay: a, periodToDay: b })) });
const labels = (r: { months: { year: number; month: number }[] }) => r.months.map(monthLabel);

describe("validationMonthsForFiling (D200)", () => {
  it("a single-month certificate asks for that month only", () => {
    expect(labels(months("Q3", [["2026-07-01", "2026-07-31"]]))).toEqual(["July 2026"]);
  });
  it("a whole-quarter certificate asks for all three months, in calendar order", () => {
    const r = months("Q3", [["2026-07-01", "2026-09-30"]]);
    expect(labels(r)).toEqual(["July 2026", "August 2026", "September 2026"]);
    expect(r.fellBack).toBe(false);
  });
  it("two certificates in July and September give no August, whatever the order they were entered", () => {
    expect(labels(months("Q3", [["2026-09-01", "2026-09-30"], ["2026-07-01", "2026-07-31"]]))).toEqual(["July 2026", "September 2026"]);
  });
  it("a period running outside the filing's months is clipped to them", () => {
    expect(labels(months("Q3", [["2026-06-01", "2026-07-31"]]))).toEqual(["July 2026"]);
    expect(labels(months("Q1", [["2025-12-01", "2026-01-31"]]))).toEqual(["January 2026"]);
  });
  it("each quarter covers its own three months", () => {
    expect(labels(months("Q1", [["2026-01-01", "2026-12-31"]]))).toEqual(["January 2026", "February 2026", "March 2026"]);
    expect(labels(months("Q2", [["2026-01-01", "2026-12-31"]]))).toEqual(["April 2026", "May 2026", "June 2026"]);
  });
  it("the Annual is October to December only — a January–December certificate gives three months", () => {
    expect(labels(months("ANNUAL", [["2026-01-01", "2026-12-31"]]))).toEqual(["October 2026", "November 2026", "December 2026"]);
    expect(labels(months("ANNUAL", [["2026-03-01", "2026-11-15"]]))).toEqual(["October 2026", "November 2026"]);
  });
  it("certificates that touch none of the filing's months fall back to every month, flagged", () => {
    const r = months("Q3", [["2026-01-01", "2026-03-31"]]);
    expect(labels(r)).toEqual(["July 2026", "August 2026", "September 2026"]);
    expect(r.fellBack).toBe(true);
  });
  it("no certificate means no months (the step is Not applicable then)", () => {
    expect(months("Q3", [])).toEqual({ months: [], fellBack: false });
  });
  it("slot codes and labels carry the month", () => {
    const defs = validationSlotDefs(months("Q3", [["2026-07-01", "2026-08-31"]]).months);
    expect(defs.map((d) => [d.slotCode, d.label, d.required])).toEqual([
      ["validation_2026-07", "July 2026", true],
      ["validation_2026-08", "August 2026", true],
    ]);
    expect(validationSlotCode({ year: 2026, month: 12 })).toBe("validation_2026-12");
  });
});

describe("isLegacyDoneStep11 (D200)", () => {
  it("a Done step 11 holding only the old report/DAT files is the legacy case", () => {
    expect(isLegacyDoneStep11("DONE", [{ docSlotCode: "generated_report" }, { docSlotCode: "dat_file" }])).toBe(true);
  });
  it("not when open, when empty, or once a monthly file exists", () => {
    expect(isLegacyDoneStep11("PENDING", [{ docSlotCode: "generated_report" }])).toBe(false);
    expect(isLegacyDoneStep11("DONE", [])).toBe(false);
    expect(isLegacyDoneStep11("DONE", [{ docSlotCode: "validation_2026-07" }, { docSlotCode: "dat_file" }])).toBe(false);
  });
});
