import { describe, it, expect } from "vitest";
import { resolveCertificateCutoffDate } from "@/lib/tax/cwt";

/**
 * P5 (Phase 2b): resolveCertificateCutoffDate priority order. Manual
 * override always wins when set (it's the bookkeeper's explicit
 * correction and stays editable even on a filed return); otherwise
 * filedAt pins the cutoff once filed; otherwise "today" drives a live
 * preview of an unfiled filing.
 */
describe("resolveCertificateCutoffDate", () => {
  const TODAY = new Date("2026-08-20");
  const FILED_AT = new Date("2026-08-15");
  const OVERRIDE = new Date("2026-08-10");

  it("uses today when unfiled and no override", () => {
    const result = resolveCertificateCutoffDate({ filedAt: null, manualOverride: null, today: TODAY });
    expect(result).toEqual({ date: TODAY, source: "TODAY" });
  });

  it("uses filedAt once filed, when no override", () => {
    const result = resolveCertificateCutoffDate({ filedAt: FILED_AT, manualOverride: null, today: TODAY });
    expect(result).toEqual({ date: FILED_AT, source: "FILED_AT" });
  });

  it("manual override wins over today when unfiled", () => {
    const result = resolveCertificateCutoffDate({ filedAt: null, manualOverride: OVERRIDE, today: TODAY });
    expect(result).toEqual({ date: OVERRIDE, source: "MANUAL_OVERRIDE" });
  });

  it("manual override wins over filedAt when filed", () => {
    const result = resolveCertificateCutoffDate({
      filedAt: FILED_AT,
      manualOverride: OVERRIDE,
      today: TODAY,
    });
    expect(result).toEqual({ date: OVERRIDE, source: "MANUAL_OVERRIDE" });
  });
});
