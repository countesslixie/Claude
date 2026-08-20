import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { resolveCertificateCutoffDate, sumCwtThroughPeriod } from "@/lib/tax/cwt";

const MANILA_ZONE = "Asia/Manila";
const manila = (iso: string) => DateTime.fromISO(iso, { zone: MANILA_ZONE }).toJSDate();

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

/**
 * SPEC.md 16 item 11: date comparisons must be timezone-correct at 23:59
 * Asia/Manila on a due date — this is exactly where a UTC/local mixup
 * would show up. A certificate received any time on the cutoff's own
 * Manila calendar day counts; one received starting the next Manila day
 * does not, even by two minutes.
 */
describe("sumCwtThroughPeriod — Asia/Manila calendar-day cutoff (SPEC.md 16 item 11)", () => {
  // The cutoff itself, as constructed by every caller in this codebase
  // (manilaDateInputToJsDate / nowManila().startOf("day")): start-of-day
  // Manila on the cutoff date.
  const cutoff = manila("2026-08-15T00:00:00");

  it("includes a certificate received at 23:59 Manila on the cutoff date", () => {
    const total = sumCwtThroughPeriod(
      [
        {
          id: "late-in-day",
          taxWithheldCents: 5_000_00,
          dateReceived: manila("2026-08-15T23:59:00"),
          status: "RECORDED",
        },
      ],
      cutoff,
    );
    expect(total).toBe(5_000_00);
  });

  it("excludes a certificate received at 00:01 Manila the day after the cutoff", () => {
    const total = sumCwtThroughPeriod(
      [
        {
          id: "next-day",
          taxWithheldCents: 5_000_00,
          dateReceived: manila("2026-08-16T00:01:00"),
          status: "RECORDED",
        },
      ],
      cutoff,
    );
    expect(total).toBe(0);
  });

  it("counts exactly one of the pair when both are present, not zero or two", () => {
    const total = sumCwtThroughPeriod(
      [
        {
          id: "late-in-day",
          taxWithheldCents: 5_000_00,
          dateReceived: manila("2026-08-15T23:59:00"),
          status: "RECORDED",
        },
        {
          id: "next-day",
          taxWithheldCents: 3_000_00,
          dateReceived: manila("2026-08-16T00:01:00"),
          status: "RECORDED",
        },
      ],
      cutoff,
    );
    expect(total).toBe(5_000_00);
  });
});
