"use client";

import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { OPEN_STEP_EVENT } from "@/components/go-to-step";
import { groupCounterLabel } from "@/lib/workflow/groups";
import { STATUS_GRID } from "@/components/status-columns";

/**
 * Brief #4a — a collapsed group shows its name, progress, and what's
 * outstanding; expanding it exposes every per-step control that already
 * existed (attach, skip with reason, mark waiting, mark done) unchanged,
 * inside `children`.
 *
 * Brief #5i §3 — there is no group-level "Mark done" any more, and never
 * will be again: a group is finished only when its own steps are, and it
 * is never marked finished from the header (her decision, reversing D32's
 * one click per group and brief #5e's clickable middle state). The header
 * now shows status only — a non-clickable grey "Pending" label (its
 * tooltip names what's left, e.g. "Step 3 and step 4 not done.") while
 * anything in the group is unresolved, or a green "Done" pill once every
 * step is Done or Skipped. `lib/actions/workflowSteps.ts`'s markGroupDone
 * is gone entirely, not just this button.
 *
 * Brief #5i §4 — the count beside the name is Done + Skipped together
 * (a skip is a decision she made, not a step still outstanding), with a
 * "N skipped" suffix whenever any step in the group is skipped, so a skip
 * never reads as if it silently vanished from the count.
 *
 * D76/D81 (briefs #5m/#5n) — Pay's "Nothing to pay — overpayment ₱X" line
 * shows alongside the green Done pill once steps 8/9 both resolve to NA. It
 * comes in as `noteLabel`, muted grey (D81: amber means waiting, and nothing
 * is waiting), and the "0 of 0" counter is hidden for any group whose steps
 * are all NA.
 */
export function WorkflowGroupCard({
  name,
  doneCount,
  totalCount,
  isComplete,
  unresolvedSummary,
  outstandingLabel,
  noteLabel = null,
  defaultOpen,
  stepCodes,
  notApplicable = false,
  pillOverride = null,
  children,
}: {
  name: string;
  doneCount: number;
  totalCount: number;
  isComplete: boolean;
  /** Brief #5i §3 — the Pending label's tooltip, e.g. "Step 3 and step 4 not done." */
  unresolvedSummary: string | null;
  outstandingLabel: string | null;
  /** D81 — a plain muted-grey note (Pay's "Nothing to pay — overpayment ₱X"). Amber is for waiting only, and nothing is waiting here. */
  noteLabel?: string | null;
  defaultOpen: boolean;
  /** D77/D80 — every step code in this group, so "Go to step" knows which group to expand. */
  stepCodes: readonly string[];
  /**
   * D91 (brief #5o §5) — every step in this group is NA and none is being shown
   * (the "Show N not applicable" toggle is off): there is nothing to expand, so
   * the header is plain text with no Expand link and no empty box under it.
   */
  notApplicable?: boolean;
  /** D134 — replaces the Done/Pending pill with a grey one (eAFS: "Pending" / "Not applicable"). */
  pillOverride?: string | null;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const counter = groupCounterLabel(doneCount, totalCount);

  useEffect(() => {
    function onOpenStep(e: Event) {
      const code = (e as CustomEvent<{ stepCode: string }>).detail?.stepCode;
      if (code && stepCodes.includes(code)) setIsOpen(true);
    }
    window.addEventListener(OPEN_STEP_EVENT, onOpenStep);
    return () => window.removeEventListener(OPEN_STEP_EVENT, onOpenStep);
  }, [stepCodes]);

  // D116 — summary text on the left (it wraps, never widening the columns), then
  // the status pill column, then the Expand/Collapse column.
  const pill = pillOverride ? (
    <StatusBadge tone="pending">{pillOverride}</StatusBadge>
  ) : isComplete ? (
    <StatusBadge tone="done">Done</StatusBadge>
  ) : notApplicable ? null : (
    <span title={unresolvedSummary ?? undefined}>
      <StatusBadge tone="pending">Pending</StatusBadge>
    </span>
  );
  const summaryText = (
    <>
      <span className="text-sm font-medium text-ink">{name}</span>
      {!notApplicable && counter && <span className="text-xs text-faint">{counter}</span>}
      {noteLabel && <span className="text-xs text-faint">{noteLabel}</span>}
      {!notApplicable && outstandingLabel && <span className="text-xs text-amber">{outstandingLabel}</span>}
    </>
  );

  if (notApplicable) {
    return (
      <div className="rounded-lg border border-line">
        <div className={`${STATUS_GRID} p-3`}>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">{summaryText}</div>
          <div data-cell="status" className="whitespace-nowrap">{pill}</div>
          <div data-cell="action" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line">
      <div className={`${STATUS_GRID} p-3`}>
        <button
          type="button"
          onClick={() => setIsOpen((o) => !o)}
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-left"
        >
          {summaryText}
        </button>
        <div data-cell="status" className="whitespace-nowrap">{pill}</div>
        <div data-cell="action" className="text-right">
          <button
            type="button"
            onClick={() => setIsOpen((o) => !o)}
            className="text-xs text-faint underline"
          >
            {isOpen ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      {isOpen && <div className="flex flex-col gap-2 border-t border-line p-3">{children}</div>}
    </div>
  );
}
