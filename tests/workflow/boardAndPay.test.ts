import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { boardShowsFiling } from "@/lib/workflow/clientWait";
import { payHeaderDisplay } from "@/lib/workflow/naGroupHeader";
import { WorkflowGroupCard } from "@/components/workflow-group-card";
import { BoardColumn, BIR_TAG_CLASS, type BoardCardData } from "@/components/board-column";

/** Asia/Manila midnight, written as the UTC instant. */
const manila = (ymd: string) => new Date(`${ymd}T00:00:00+08:00`);
const manilaLate = (ymd: string) => new Date(`${ymd}T23:59:00+08:00`);

describe("Pay header when nothing is payable (D135)", () => {
  it("gives the grey Not applicable pill and keeps the existing text, for an overpayment and for ₱0", () => {
    expect(payHeaderDisplay("Nothing to pay — overpayment ₱8,200.00")).toEqual({
      pillLabel: "Not applicable",
      text: "Nothing to pay — overpayment ₱8,200.00",
    });
    expect(payHeaderDisplay("Nothing to pay")?.pillLabel).toBe("Not applicable");
  });
  it("is null for a payable return, so the header is unchanged", () => {
    expect(payHeaderDisplay(null)).toBeNull();
  });
  it("renders grey, never green Done", () => {
    const html = renderToStaticMarkup(
      createElement(
        WorkflowGroupCard,
        {
          name: "Pay",
          doneCount: 0,
          totalCount: 0,
          isComplete: true,
          unresolvedSummary: null,
          outstandingLabel: null,
          noteLabel: "Nothing to pay",
          pillOverride: "Not applicable",
          notApplicable: true,
          defaultOpen: false,
          stepCodes: [],
        } as never,
        null,
      ),
    );
    expect(html).toContain("Not applicable");
    expect(html).not.toContain(">Done<");
    expect(html).not.toContain("status-done");
  });
});

describe("board visibility (D139)", () => {
  it("a Q3 filing is hidden on Sep 30 and shown on Oct 1", () => {
    expect(boardShowsFiling(2026, "Q3", manilaLate("2026-09-30"))).toBe(false);
    expect(boardShowsFiling(2026, "Q3", manila("2026-10-01"))).toBe(true);
  });
  it("an Annual is hidden on Dec 31 and shown on Jan 1", () => {
    expect(boardShowsFiling(2026, "ANNUAL", manilaLate("2026-12-31"))).toBe(false);
    expect(boardShowsFiling(2026, "ANNUAL", manila("2027-01-01"))).toBe(true);
  });
  it("Q1 from April 1 and Q2 from July 1", () => {
    expect(boardShowsFiling(2026, "Q1", manilaLate("2026-03-31"))).toBe(false);
    expect(boardShowsFiling(2026, "Q1", manila("2026-04-01"))).toBe(true);
    expect(boardShowsFiling(2026, "Q2", manilaLate("2026-06-30"))).toBe(false);
    expect(boardShowsFiling(2026, "Q2", manila("2026-07-01"))).toBe(true);
  });
});

describe("board column (D138)", () => {
  const card: BoardCardData = {
    id: "f1",
    clientId: "c1",
    taxableYear: 2026,
    period: "Q3",
    status: "WAITING_BIR",
    adjustedDueDate: manila("2026-11-16"),
    client: { registeredName: "Sample Client" },
    outstandingLabel: "waiting on quarterly sales and Form 2307",
    outstandingTone: "amber",
    birTags: [{ stepCode: "RECEIVE_TRRC", text: "TRRC · 2 days", tone: "overdue" }],
  };
  const render = (filings: BoardCardData[]) => renderToStaticMarkup(createElement(BoardColumn, { title: "File", filings }));

  it("renders a BIR wait tag as plain grey text: no pill, no red", () => {
    const html = render([card]);
    const tag = html.match(/<p class="([^"]*)">TRRC · 2 days<\/p>/);
    expect(tag).not.toBeNull();
    expect(tag![1]).toContain(BIR_TAG_CLASS);
    expect(tag![1]).not.toMatch(/rounded|bg-|text-red|text-amber/);
    expect(html).not.toMatch(/rounded-full[^>]*>TRRC/);
  });
  it("an empty column says Nothing here., and the count chip shows", () => {
    const html = render([]);
    expect(html).toContain("Nothing here.");
    expect(html).toContain(">0<");
  });
  it("every card has the same fixed height class, and the message is cut at two lines", () => {
    const a = render([card]);
    const b = render([{ ...card, id: "f2", outstandingLabel: null, birTags: [] }]);
    const h = (s: string) => s.match(/h-\[[\d.]+rem\]/)?.[0];
    expect(h(a)).toBeDefined();
    expect(h(a)).toBe(h(b));
    expect(a).toContain("line-clamp-2");
  });
});
