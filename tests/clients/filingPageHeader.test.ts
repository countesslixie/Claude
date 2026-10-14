import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FilingSubtitle } from "@/components/filing-tin";
import { FilingStickyBarContent } from "@/components/filing-sticky-bar";
import { FilingNextBox } from "@/components/filing-next-box";

const render = (c: unknown, p: Record<string, unknown>) => renderToStaticMarkup(createElement(c as never, p as never, null));
const TEXT = "1701Q - due November 16, 2026";

describe("D202 — the filing page's subtitle carries the dashed TIN", () => {
  it("a 12-digit TIN: muted 'TIN', then the dashed number in monospace primary text, then ' · ' and the existing text", () => {
    const h = render(FilingSubtitle, { tin: "123456789000", text: TEXT });
    expect(h).toContain("TIN <span class=\"font-mono text-ink\">123-456-789-000</span>");
    expect(h).toContain(` · ${TEXT}`);
    expect(h).toContain("text-ink-secondary"); // the subtitle's own muted colour carries the word "TIN"
    expect(h).not.toMatch(/Copy|<button/);
  });
  it("a 9-digit TIN is dashed as 123-456-789", () => {
    expect(render(FilingSubtitle, { tin: "123456789", text: TEXT })).toContain(">123-456-789<");
  });
  it("no TIN stored: no TIN part at all, the subtitle reads as before", () => {
    for (const tin of [null, "", undefined]) {
      const h = render(FilingSubtitle, { tin, text: TEXT });
      expect(h).not.toContain("TIN");
      expect(h).not.toContain("·");
      expect(h).toContain(TEXT);
    }
  });
});

describe("D203 — the slim bar", () => {
  const bar = (over: Record<string, unknown> = {}) =>
    render(FilingStickyBarContent, { title: "Sample Person — TY2026 Q3", goToStepCode: "ALPHALIST_ENTRY", isComplete: false, tin: "123456789000", ...over });
  it("shows client and period, the TIN, and Go to step; no 'Next:' text", () => {
    const h = bar();
    expect(h).toContain("Sample Person — TY2026 Q3");
    expect(h).toContain("123-456-789-000");
    expect(h).toContain("Go to step");
    expect(h).toContain('href="#step-ALPHALIST_ENTRY"');
    expect(h).not.toContain("Next");
    expect(h).not.toMatch(/Copy|<button/);
  });
  it("no TIN stored: no TIN part", () => {
    expect(bar({ tin: null })).not.toContain("TIN");
  });
  it("nothing to go to: no link; Complete when everything is resolved", () => {
    expect(bar({ goToStepCode: null })).not.toContain("Go to step");
    expect(bar({ goToStepCode: null, isComplete: true })).toContain("Complete");
  });
});

describe("D204 — the Next box has text and Go to checklist, never a step button", () => {
  const box = (over: Record<string, unknown>) => render(FilingNextBox, { next: null, stepCount: 16, birWaitText: null, ...over });
  it("her-work step (even a Mark-done-only one): its text and Go to checklist only", () => {
    for (const stepCode of ["EAFS_SUBMIT", "PREPARE_RETURN", "RECORD_SALES", "FILE_RETURN"]) {
      const h = box({ next: { sequence: 15, title: "Complete and submit eAFS", stepCode } });
      expect(h).toContain("Next: Step 15 of 16 — Complete and submit eAFS");
      expect(h).toContain("Go to checklist");
      expect(h).not.toContain("<button");
      expect(h).not.toMatch(/Mark done|Start/);
    }
  });
  it("only a BIR wait left: its text, no button", () => {
    const h = box({ birWaitText: "waiting on BIR — TRRC, 3 days" });
    expect(h).toContain("Next: waiting on BIR — TRRC, 3 days");
    expect(h).not.toContain("<button");
  });
  it("a complete filing: its text, no button", () => {
    const h = box({});
    expect(h).toContain("nothing left to do");
    expect(h).not.toContain("<button");
  });
  it("step 5 locked behind an earlier return keeps its note and Open link", () => {
    const h = box({
      next: { sequence: 5, title: "File return", stepCode: "FILE_RETURN" },
      filingOrderReason: "File Q1 2026 first.",
      earlierUnfiled: { href: "/clients/c/filings/f", label: "Q1" },
    });
    expect(h).toContain("File Q1 2026 first.");
    expect(h).toContain("Open Q1");
    expect(h).not.toContain("<button");
  });
});
