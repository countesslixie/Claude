"use client";

import { useState, useTransition } from "react";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  markStepDone,
  markStepInProgress,
  markStepWaitingExternal,
  skipStep,
  unskipStep,
} from "@/lib/actions/workflowSteps";
import { uploadDocument } from "@/lib/actions/documents";
import { stepBlockReason } from "@/lib/workflow/docSlots";
import { birWaitTone } from "@/lib/workflow/aging";
import { stepStatusLabel } from "@/lib/workflow/status";
import { fileTooLargeMessage } from "@/lib/upload";
import type { WorkflowStepStatus } from "@/lib/workflow/types";
import { formatDays } from "@/lib/formatDays";

const STEP_STATUS_TONE: Record<string, StatusTone> = {
  PENDING: "pending",
  IN_PROGRESS: "progress",
  WAITING_EXTERNAL: "waiting",
  DONE: "done",
  SKIPPED: "pending",
  NA: "pending",
};

const AGING_TONE: Record<string, StatusTone> = { green: "done", amber: "waiting", red: "overdue" };

export interface StepCardDoc {
  id: string;
  docSlotCode: string | null;
  originalFilename: string;
}

export interface StepCardSlot {
  slotCode: string;
  label: string;
  required: boolean;
}

export interface StepCardData {
  id: string;
  stepCode: string;
  sequence: number;
  title: string;
  description: string | null;
  category: string;
  status: string;
  isWaitingState: boolean;
  waitingOnLabel: string | null;
  skippedReason: string | null;
  requiredDocSlots: StepCardSlot[];
  documents: StepCardDoc[];
  agingDaysWaiting: number | null;
  agingTone: "green" | "amber" | "red" | null;
}

export function WorkflowStepCard({
  step,
  dependencyBlockedReason = null,
  suppressTooltip = false,
  extra,
  controlsMode = "full",
  lockedMessage = null,
  readOnly = false,
}: {
  step: StepCardData;
  /** A blocking reason from another step's state, e.g. step 13 -> 14 (D29). */
  dependencyBlockedReason?: string | null;
  /**
   * Brief #5f §5 — step 4 (ADVISE_CLIENT) shows its disabled "Mark done"
   * with no hover text while step 3 isn't Done yet (she's fine without
   * it). The button stays disabled either way; this only drops the
   * `title` tooltip that would otherwise explain why.
   */
  suppressTooltip?: boolean;
  /** Step-specific content rendered inside the card, above the doc slots (sales entry link, certificate cutoff, computation sheet, client package). */
  extra?: React.ReactNode;
  /**
   * Brief #5d §7 / #5f §1 — "markDoneOnly": no Start, Mark waiting, or
   * Skip; only Mark done remains. Used by step 3 (PREPARE_RETURN — brief
   * #5f §1 removes Skip from it entirely) and step 4 (ADVISE_CLIENT).
   */
  controlsMode?: "full" | "markDoneOnly";
  /** D85 — when set (eAFS step 15 before Pay is Done), the card shows this one muted line and no controls at all. */
  lockedMessage?: string | null;
  /** D153 — the filing is Complete: no control that changes anything is shown (Undo skip included). */
  readOnly?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [skipReason, setSkipReason] = useState("");
  const [openSlots, setOpenSlots] = useState<Set<string>>(new Set());

  function toggleSlot(slotCode: string) {
    setOpenSlots((prev) => {
      const next = new Set(prev);
      if (next.has(slotCode)) next.delete(slotCode);
      else next.add(slotCode);
      return next;
    });
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setMessage(result.error ?? "Could not update this step.");
    });
  }

  function handleUpload(slotCode: string, formData: FormData) {
    // D64 (brief #5k §1) — check the file's size before it ever leaves
    // the browser: a too-large file must show this plain line, never
    // Next's own Server Action error overlay.
    const file = formData.get("file");
    if (file instanceof File) {
      const tooLarge = fileTooLargeMessage(file);
      if (tooLarge) {
        setMessage(tooLarge);
        return;
      }
    }
    formData.set("workflowStepId", step.id);
    formData.set("docSlotCode", slotCode);
    setMessage(null);
    startTransition(async () => {
      const result = await uploadDocument(formData);
      if (!result.ok) setMessage(result.error ?? "Upload failed.");
      else if (result.duplicateWarning) setMessage(result.duplicateWarning);
    });
  }

  const isResolved = step.status === "DONE" || step.status === "NA" || step.status === "SKIPPED";
  const isResolvedEarly = isResolved;

  // D27 — the app blocks on documents it receives, never on proof the
  // bookkeeper did something: only `required` slots gate DONE. Optional
  // slots stay behind a disclosure so they never read as a demand.
  const requiredSlots = step.requiredDocSlots.filter((s) => s.required);
  const optionalSlots = step.requiredDocSlots.filter((s) => !s.required);
  const attachedFor = (slotCode: string) => step.documents.filter((d) => d.docSlotCode === slotCode);

  // Brief #4e — blockReason no longer renders as standing text on the
  // card; it still disables "Mark done" and explains why via that
  // button's `title` tooltip (see below).
  const blockReason = stepBlockReason(step.requiredDocSlots, step.documents, dependencyBlockedReason);

  // D72 (brief #5m §2) — a step waiting on BIR (currently only step 13,
  // SAWT_ACK, on this generic card — steps 10/14 use the bespoke
  // FileGroupDocStepCard) shows ONE pill, "Waiting on BIR · N days", never
  // the grey "waiting on" text plus a separate aging pill plus a separate
  // status pill all at once. No green: amber while waiting, red once
  // past twice expectedResponseDays.
  const isWaitingOnBir = step.status === "WAITING_EXTERNAL" && step.waitingOnLabel === "BIR";

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-ink">
            {step.sequence}. {step.title}
            {step.status === "WAITING_EXTERNAL" && step.waitingOnLabel && !isWaitingOnBir && (
              <span className="ml-1 text-xs font-normal text-faint">waiting on {step.waitingOnLabel}</span>
            )}
          </p>
          {step.description && <p className="text-xs text-faint">{step.description}</p>}
        </div>
        <div className="flex items-center gap-1.5">
          {isWaitingOnBir ? (
            <StatusBadge tone={birWaitTone(step.agingTone)}>
              Waiting on BIR{step.agingDaysWaiting != null ? ` · ${formatDays(step.agingDaysWaiting)}` : ""}
            </StatusBadge>
          ) : (
            <>
              {step.agingTone && (
                <StatusBadge tone={AGING_TONE[step.agingTone]}>{formatDays(step.agingDaysWaiting ?? 0)}</StatusBadge>
              )}
              <StatusBadge tone={STEP_STATUS_TONE[step.status] ?? "pending"}>
                {stepStatusLabel(step.status as WorkflowStepStatus)}
              </StatusBadge>
            </>
          )}
        </div>
      </div>

      {step.status === "SKIPPED" && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {step.skippedReason && <p className="text-xs text-faint">Skipped: {step.skippedReason}</p>}
          {!readOnly && (
            <Button size="sm" variant="secondary" disabled={isPending} onClick={() => run(() => unskipStep(step.id))}>
              Undo skip
            </Button>
          )}
        </div>
      )}

      {lockedMessage && !isResolvedEarly && <p className="mt-1 text-xs text-faint">{lockedMessage}</p>}

      {extra && <div className="mt-2">{extra}</div>}

      {!readOnly && requiredSlots.length > 0 && !isResolved && (
        <div className="mt-2 flex flex-col gap-2">
          {requiredSlots.map((slot) => {
            const attached = attachedFor(slot.slotCode);
            const isOpen = openSlots.has(slot.slotCode);
            return (
              <div key={slot.slotCode} className="rounded border border-line bg-background p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-ink-secondary">{slot.label}</p>
                  {!isOpen && (
                    <button
                      type="button"
                      onClick={() => toggleSlot(slot.slotCode)}
                      className="text-xs text-faint underline hover:text-ink"
                    >
                      {attached.length > 0 ? "Attach another" : "Attach"}
                    </button>
                  )}
                </div>
                {attached.length > 0 ? (
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {attached.map((d) => (
                      <li key={d.id} className="text-xs">
                        <a
                          href={`/api/documents/${d.id}/download`}
                          className="text-ink-secondary underline hover:text-ink"
                        >
                          {d.originalFilename}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  !isOpen && <p className="mt-0.5 text-xs text-amber">Required to mark this step done.</p>
                )}
                {isOpen && (
                  <form
                    action={(fd) => handleUpload(slot.slotCode, fd)}
                    className="mt-1 flex items-center gap-1.5"
                  >
                    <Input type="file" name="file" required className="h-8 text-xs" />
                    <Button type="submit" size="sm" variant="secondary" disabled={isPending}>
                      Upload
                    </Button>
                    <button
                      type="button"
                      onClick={() => toggleSlot(slot.slotCode)}
                      className="text-xs text-faint underline hover:text-ink-secondary"
                    >
                      Cancel
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!readOnly && optionalSlots.length > 0 && !isResolved && (
        <div className="mt-2 flex flex-col gap-2">
          {optionalSlots.map((slot) => {
            const attached = attachedFor(slot.slotCode);
            const isOpen = openSlots.has(slot.slotCode);
            return (
              <div key={slot.slotCode} className="rounded border border-line p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-faint">{slot.label}</p>
                  {!isOpen && (
                    <button
                      type="button"
                      onClick={() => toggleSlot(slot.slotCode)}
                      className="text-xs text-faint underline hover:text-ink"
                    >
                      {attached.length > 0 ? "Attach another" : "Attach a file (optional)"}
                    </button>
                  )}
                </div>
                {attached.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {attached.map((d) => (
                      <li key={d.id} className="text-xs">
                        <a
                          href={`/api/documents/${d.id}/download`}
                          className="text-ink-secondary underline hover:text-ink"
                        >
                          {d.originalFilename}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {isOpen && (
                  <form
                    action={(fd) => handleUpload(slot.slotCode, fd)}
                    className="mt-1 flex items-center gap-1.5"
                  >
                    <Input type="file" name="file" required className="h-8 text-xs" />
                    <Button type="submit" size="sm" variant="secondary" disabled={isPending}>
                      Upload
                    </Button>
                    <button
                      type="button"
                      onClick={() => toggleSlot(slot.slotCode)}
                      className="text-xs text-faint underline hover:text-ink-secondary"
                    >
                      Cancel
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!readOnly && !isResolved && !lockedMessage && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {controlsMode === "full" && step.status === "PENDING" && (
            <Button size="sm" variant="secondary" disabled={isPending} onClick={() => run(() => markStepInProgress(step.id))}>
              Start
            </Button>
          )}
          {controlsMode === "full" && step.isWaitingState && step.status !== "WAITING_EXTERNAL" && (
            <Button size="sm" variant="secondary" disabled={isPending} onClick={() => run(() => markStepWaitingExternal(step.id))}>
              Mark waiting
            </Button>
          )}
          <Button
            size="sm"
            disabled={isPending || !!blockReason}
            title={suppressTooltip ? undefined : (blockReason ?? undefined)}
            onClick={() => run(() => markStepDone(step.id))}
          >
            Mark done
          </Button>
          {controlsMode === "full" && (
            <>
              <Input
                placeholder="Skip reason"
                value={skipReason}
                onChange={(e) => setSkipReason(e.target.value)}
                className="h-8 w-40 text-xs"
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={isPending || !skipReason.trim()}
                onClick={() => run(() => skipStep(step.id, skipReason))}
              >
                Skip
              </Button>
            </>
          )}
        </div>
      )}

      {message && <p className="mt-2 rounded bg-amber-tint px-2 py-1 text-xs text-amber">{message}</p>}
    </div>
  );
}
