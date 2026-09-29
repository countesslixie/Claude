"use client";

import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { OPEN_STEP_EVENT } from "@/components/go-to-step";

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
 * D76 (brief #5m §3.4) — `outstandingLabel` can be non-null even while
 * `isComplete` is true: Pay's "Nothing to pay — overpayment ₱X" line
 * shows alongside the green Done pill once steps 8/9 both resolve to NA.
 * Every other group's `outstandingLabel` is always null once complete (by
 * construction in lib/workflow/groups.ts), so this is a safe
 * generalisation, not a special case wired in here.
 */
export function WorkflowGroupCard({
  name,
  doneCount,
  totalCount,
  skippedCount,
  isComplete,
  unresolvedSummary,
  outstandingLabel,
  defaultOpen,
  stepCodes,
  children,
}: {
  name: string;
  doneCount: number;
  totalCount: number;
  skippedCount: number;
  isComplete: boolean;
  /** Brief #5i §3 — the Pending label's tooltip, e.g. "Step 3 and step 4 not done." */
  unresolvedSummary: string | null;
  outstandingLabel: string | null;
  defaultOpen: boolean;
  /** D77/D80 — every step code in this group, so "Go to step" knows which group to expand. */
  stepCodes: readonly string[];
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  useEffect(() => {
    function onOpenStep(e: Event) {
      const code = (e as CustomEvent<{ stepCode: string }>).detail?.stepCode;
      if (code && stepCodes.includes(code)) setIsOpen(true);
    }
    window.addEventListener(OPEN_STEP_EVENT, onOpenStep);
    return () => window.removeEventListener(OPEN_STEP_EVENT, onOpenStep);
  }, [stepCodes]);

  return (
    <div className="rounded-lg border border-line">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <button
          type="button"
          onClick={() => setIsOpen((o) => !o)}
          className="flex flex-1 flex-wrap items-center gap-2 text-left"
        >
          <span className="text-sm font-medium text-ink">{name}</span>
          <span className="text-xs text-faint">
            {doneCount} of {totalCount}
            {skippedCount > 0 && ` · ${skippedCount} skipped`}
          </span>
          {isComplete && <StatusBadge tone="done">Done</StatusBadge>}
          {outstandingLabel && <span className="text-xs text-amber">{outstandingLabel}</span>}
          <span className="ml-auto text-xs text-faint underline">{isOpen ? "Collapse" : "Expand"}</span>
        </button>
        {!isComplete && (
          <span title={unresolvedSummary ?? undefined}>
            <StatusBadge tone="pending">Pending</StatusBadge>
          </span>
        )}
      </div>

      {isOpen && <div className="flex flex-col gap-2 border-t border-line p-3">{children}</div>}
    </div>
  );
}
