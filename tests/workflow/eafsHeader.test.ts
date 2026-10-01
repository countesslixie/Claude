import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { eafsHeaderDisplay } from "@/lib/workflow/eafsHeader";
import { WorkflowGroupCard } from "@/components/workflow-group-card";
import { ComputationSheetPanel } from "@/components/computation-sheet-panel";
import { renderComputationSheetHtml } from "@/lib/documents/computationSheetHtml";
import type { FilingComputationResult } from "@/lib/tax/types";

describe("eAFS header (D134)", () => {
  const none = { certificateCount: 0, applicableStepCount: 0 };
  it("is Pending while step 2 is open and there is no certificate", () => {
    for (const step2Status of ["WAITING_EXTERNAL", "PENDING", "IN_PROGRESS"]) {
      expect(eafsHeaderDisplay({ ...none, step2Status })).toEqual({
        pillLabel: "Pending",
        text: "Depends on Form 2307s (step 2)",
      });
    }
  });
  it("is Not applicable once step 2 is Done or Skipped, and Pending again after undoing the skip", () => {
    expect(eafsHeaderDisplay({ ...none, step2Status: "SKIPPED" })).toEqual({ pillLabel: "Not applicable", text: "No Form 2307" });
    expect(eafsHeaderDisplay({ ...none, step2Status: "DONE" })?.pillLabel).toBe("Not applicable");
    expect(eafsHeaderDisplay({ ...none, step2Status: "WAITING_EXTERNAL" })?.pillLabel).toBe("Pending");
  });
  it("is unchanged (null) when a certificate exists or the group has applicable steps", () => {
    expect(eafsHeaderDisplay({ step2Status: "DONE", certificateCount: 1, applicableStepCount: 0 })).toBeNull();
    expect(eafsHeaderDisplay({ step2Status: "DONE", certificateCount: 0, applicableStepCount: 3 })).toBeNull();
  });
  it("the header renders the grey pill, the text, and both aligned cells, with no counter or Expand", () => {
    const html = renderToStaticMarkup(
      createElement(
        WorkflowGroupCard,
        {
          name: "eAFS", doneCount: 0, totalCount: 0, isComplete: true, unresolvedSummary: null, outstandingLabel: null,
          defaultOpen: false, stepCodes: [], noteLabel: "No Form 2307", pillOverride: "Not applicable", notApplicable: true,
        } as never,
        null,
      ),
    );
    expect(html).toContain("Not applicable");
    expect(html).toContain("No Form 2307");
    expect(html).not.toContain("Done");
    expect(html).not.toContain("Expand");
    expect(html).toContain('data-cell="status"');
    expect(html).toContain('data-cell="action"');
  });
});

describe("computation sheet has no explanations (D133)", () => {
  const sheet = {
    formType: "F1701Q",
    breakdown: [
      { label: "54. Tax Due", amountCents: 600_000, sourceNote: "53 × 8.00%, rounded to the whole peso" },
      { label: "Tax payable", amountCents: 600_000, sourceNote: "54 - 62. This is a preparation aid." },
    ],
    isOverpayment: false,
    overpaymentCents: 0,
    taxPayableCents: 600_000,
  } as unknown as FilingComputationResult;

  it("a newly saved sheet file carries the lines and figures only", () => {
    const html = renderComputationSheetHtml({
      clientName: "Sample Client", clientTin: "000", taxableYear: 2026, period: "Q3", sheet,
      isFrozen: true, generatedAt: new Date("2026-10-01T00:00:00Z"), hasSalesRecorded: true,
    });
    expect(html).toContain("54. Tax Due");
    expect(html).toContain("₱6,000.00");
    expect(html).not.toContain("rounded to the whole peso");
    expect(html).not.toContain("preparation aid");
  });

  it("the on-screen panel has no Show explanations control", () => {
    const html = renderToStaticMarkup(
      createElement(ComputationSheetPanel, {
        breakdown: sheet.breakdown, isOverpayment: false, overpaymentCents: 0, taxPayableCents: 600_000,
        isFrozen: true, hasSalesRecorded: true, period: "Q3", taxableYear: 2026, incomeHref: "/x",
      }),
    );
    expect(html).not.toContain("Show explanations");
  });
});
