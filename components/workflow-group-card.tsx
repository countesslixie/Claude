"use client";

import { useState, useTransition } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { markGroupDone } from "@/lib/actions/workflowSteps";

/**
 * Brief #4a — a collapsed group shows its name, progress, and what's
 * outstanding; expanding it exposes every per-step control that already
 * existed (attach, skip with reason, mark waiting) unchanged, inside
 * `children`. The one new control here is "Mark done", which marks every
 * unresolved step in the group at once (lib/actions/workflowSteps.ts's
 * markGroupDone) — this is the point of the change: a clean quarter is
 * five clicks, not sixteen.
 *
 * Brief #4e — `blockReason` no longer renders as standing text under the
 * header (the bookkeeper found the same sentence appearing here, under
 * a per-step button, and as a "Missing required documents" line all at
 * once, too noisy). It still explains why via a tooltip (D41).
 * `outstandingLabel` is unaffected — the short amber summary beside the
 * group name stays.
 *
 * Brief #5e §5 — a disabled "Mark done" read like a button she could
 * press. The control now has three states: a non-clickable grey
 * "Pending" label (with the block reason as its hover tooltip) while
 * blocked, the ordinary clickable "Mark done" button once it can be
 * finished, and the green "Done" pill once every step is resolved.
 */
export function WorkflowGroupCard({
  filingId,
  groupCode,
  name,
  doneCount,
  totalCount,
  isComplete,
  blockReason,
  outstandingLabel,
  defaultOpen,
  children,
}: {
  filingId: string;
  groupCode: string;
  name: string;
  doneCount: number;
  totalCount: number;
  isComplete: boolean;
  blockReason: string | null;
  outstandingLabel: string | null;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleMarkDone() {
    setMessage(null);
    startTransition(async () => {
      const result = await markGroupDone(filingId, groupCode);
      if (!result.ok) setMessage(result.error ?? "Could not complete this group.");
    });
  }

  return (
    <div className="rounded-lg border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <button
          type="button"
          onClick={() => setIsOpen((o) => !o)}
          className="flex flex-1 flex-wrap items-center gap-2 text-left"
        >
          <span className="text-sm font-medium text-slate-900">{name}</span>
          <span className="text-xs text-slate-400">
            {doneCount} of {totalCount}
          </span>
          {isComplete ? (
            <StatusBadge tone="done">Done</StatusBadge>
          ) : (
            outstandingLabel && <span className="text-xs text-amber-700">{outstandingLabel}</span>
          )}
          <span className="ml-auto text-xs text-slate-500 underline">{isOpen ? "Collapse" : "Expand"}</span>
        </button>
        {!isComplete &&
          (blockReason ? (
            <span title={blockReason}>
              <StatusBadge tone="pending">Pending</StatusBadge>
            </span>
          ) : (
            <Button size="sm" disabled={isPending} onClick={handleMarkDone}>
              Mark done
            </Button>
          ))}
      </div>

      {message && <p className="px-3 pb-2 text-xs text-amber-700">{message}</p>}

      {isOpen && <div className="flex flex-col gap-2 border-t border-slate-100 p-3">{children}</div>}
    </div>
  );
}
