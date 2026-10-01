import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkflowGroupCard } from "@/components/workflow-group-card";
import { FilingSummaryStrip } from "@/components/filing-summary-strip";
import { formatManilaDateLong } from "@/lib/dates";

function group(over: Record<string, unknown>) {
  return renderToStaticMarkup(
    createElement(
      WorkflowGroupCard,
      {
        name: "Pay",
        doneCount: 0,
        totalCount: 2,
        skippedCount: 0,
        isComplete: false,
        unresolvedSummary: null,
        outstandingLabel: null,
        defaultOpen: false,
        stepCodes: [],
        ...over,
      } as never,
      null,
    ),
  );
}

const cells = (html: string) => ({
  status: (html.match(/data-cell="status"/g) ?? []).length,
  action: (html.match(/data-cell="action"/g) ?? []).length,
});

describe("status / action columns (D116)", () => {
  it("every group header renders both cells, whatever it shows", () => {
    const variants = [
      {},
      { isComplete: true, doneCount: 2 },
      { isComplete: true, noteLabel: "Nothing to pay — overpayment ₱8,200.00", notApplicable: true, totalCount: 0 },
      { name: "eAFS", totalCount: 0, noteLabel: "Not applicable — no Form 2307", notApplicable: true },
      { outstandingLabel: "waiting on TRRC, 2 days" },
    ];
    for (const v of variants) {
      expect(cells(group(v))).toEqual({ status: 1, action: 1 });
    }
  });

  it("the tax payable line renders both cells, with the pill and no dot before it", () => {
    const html = renderToStaticMarkup(
      createElement(FilingSummaryStrip, {
        netLabel: "Tax payable ₱6,000.00",
        daysLabel: "46 days to adjusted due date",
        statusTone: "progress",
        statusLabel: "In progress",
      }),
    );
    expect(cells(html)).toEqual({ status: 1, action: 1 });
    expect(html).toContain("46 days to adjusted due date");
    expect(html.match(/·/g)?.length).toBe(1);
  });
});

describe("filing page subtitle date (D123)", () => {
  it("writes the month out in full", () => {
    expect(formatManilaDateLong(new Date("2026-11-15T16:00:00Z"))).toBe("November 16, 2026");
    expect(formatManilaDateLong(new Date("2026-05-14T16:00:00Z"))).toBe("May 15, 2026");
  });
});
