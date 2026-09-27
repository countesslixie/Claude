"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { markStepInProgress, markStepDone } from "@/lib/actions/workflowSteps";
import { stepBlockReason, type AttachedDocument, type DocSlotLike } from "@/lib/workflow/docSlots";

/**
 * §4.2 — the filing page's primary job: "what do I do next," in words,
 * with the action adjacent. This is the SAME mutation the checklist
 * below uses (lib/actions/workflowSteps.ts) — just surfaced at the top
 * of the page instead of requiring a scroll to find it.
 *
 * D27 reconciliation: this control can name the next step's blocking
 * step, but it has no upload widget of its own — attaching the document
 * still happens down in the checklist card. Disabling this button with
 * the same reason (rather than only showing the error after a click)
 * keeps this control honest about what a click here would actually do.
 *
 * Brief #4e — blockReason no longer renders as standing text here
 * either (this banner was a third place the same sentence showed up,
 * alongside the group header and the per-step card). It still disables
 * "Mark done" and explains why via that button's `title` tooltip.
 */
export function NextActionControl({
  stepId,
  status,
  requiredDocSlots,
  documents,
  dependencyBlockedReason = null,
  hideStart = false,
}: {
  stepId: string;
  status: string;
  requiredDocSlots: DocSlotLike[];
  documents: AttachedDocument[];
  dependencyBlockedReason?: string | null;
  /** Brief #5d §7 — step 4 (ADVISE_CLIENT) has no Start control; only Mark done remains. */
  hideStart?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setMessage(result.error ?? "Could not update this step.");
    });
  }

  const blockReason = stepBlockReason(requiredDocSlots, documents, dependencyBlockedReason);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {status === "PENDING" && !hideStart && (
          <Button size="sm" disabled={isPending} onClick={() => run(() => markStepInProgress(stepId))}>
            Start
          </Button>
        )}
        <Button
          size="sm"
          variant={status === "PENDING" ? "secondary" : "primary"}
          disabled={isPending || !!blockReason}
          title={blockReason ?? undefined}
          onClick={() => run(() => markStepDone(stepId))}
        >
          Mark done
        </Button>
        <a href="#checklist" className="text-xs text-slate-500 underline hover:text-slate-900">
          Go to checklist
        </a>
      </div>
      {message && <p className="text-xs text-amber-700">{message}</p>}
    </div>
  );
}
