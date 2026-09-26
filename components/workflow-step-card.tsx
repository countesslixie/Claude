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
  logFollowUp,
} from "@/lib/actions/workflowSteps";
import { uploadDocument } from "@/lib/actions/documents";
import { stepBlockReason } from "@/lib/workflow/docSlots";

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
  documentDate: string;
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
  followUpCount: number;
  skippedReason: string | null;
  requiredDocSlots: StepCardSlot[];
  documents: StepCardDoc[];
  agingDaysWaiting: number | null;
  agingTone: "green" | "amber" | "red" | null;
}

export function WorkflowStepCard({
  step,
  dependencyBlockedReason = null,
  extra,
}: {
  step: StepCardData;
  /** A blocking reason from another step's state, e.g. step 13 -> 14 (D29). */
  dependencyBlockedReason?: string | null;
  /** Step-specific content rendered inside the card, above the doc slots (sales entry link, certificate cutoff, computation sheet, client package). */
  extra?: React.ReactNode;
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

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-slate-900">
            {step.sequence}. {step.title}
            {step.isWaitingState && step.waitingOnLabel && (
              <span className="ml-1 text-xs font-normal text-slate-400">waiting on {step.waitingOnLabel}</span>
            )}
          </p>
          {step.description && <p className="text-xs text-slate-500">{step.description}</p>}
        </div>
        <div className="flex items-center gap-1.5">
          {step.agingTone && (
            <StatusBadge tone={AGING_TONE[step.agingTone]}>{step.agingDaysWaiting}d</StatusBadge>
          )}
          <StatusBadge tone={STEP_STATUS_TONE[step.status] ?? "pending"}>{step.status}</StatusBadge>
        </div>
      </div>

      {step.status === "SKIPPED" && step.skippedReason && (
        <p className="mt-1 text-xs text-slate-500">Skipped: {step.skippedReason}</p>
      )}

      {extra && <div className="mt-2">{extra}</div>}

      {requiredSlots.length > 0 && !isResolved && (
        <div className="mt-2 flex flex-col gap-2">
          {requiredSlots.map((slot) => {
            const attached = attachedFor(slot.slotCode);
            const isOpen = openSlots.has(slot.slotCode);
            return (
              <div key={slot.slotCode} className="rounded border border-slate-200 bg-slate-50 p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-slate-600">{slot.label}</p>
                  {!isOpen && (
                    <button
                      type="button"
                      onClick={() => toggleSlot(slot.slotCode)}
                      className="text-xs text-slate-500 underline hover:text-slate-900"
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
                          className="text-slate-700 underline hover:text-slate-900"
                        >
                          {d.originalFilename}
                        </a>{" "}
                        <span className="text-slate-400">({d.documentDate})</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  !isOpen && <p className="mt-0.5 text-xs text-amber-700">Required to mark this step done.</p>
                )}
                {isOpen && (
                  <form
                    action={(fd) => handleUpload(slot.slotCode, fd)}
                    className="mt-1 flex items-center gap-1.5"
                  >
                    <Input type="file" name="file" required className="h-8 text-xs" />
                    <Input
                      type="date"
                      name="documentDate"
                      defaultValue={new Date().toISOString().split("T")[0]}
                      className="h-8 w-36 text-xs"
                    />
                    <Button type="submit" size="sm" variant="secondary" disabled={isPending}>
                      Upload
                    </Button>
                    <button
                      type="button"
                      onClick={() => toggleSlot(slot.slotCode)}
                      className="text-xs text-slate-400 underline hover:text-slate-600"
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

      {optionalSlots.length > 0 && !isResolved && (
        <div className="mt-2 flex flex-col gap-2">
          {optionalSlots.map((slot) => {
            const attached = attachedFor(slot.slotCode);
            const isOpen = openSlots.has(slot.slotCode);
            return (
              <div key={slot.slotCode} className="rounded border border-slate-100 p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-slate-500">{slot.label}</p>
                  {!isOpen && (
                    <button
                      type="button"
                      onClick={() => toggleSlot(slot.slotCode)}
                      className="text-xs text-slate-500 underline hover:text-slate-900"
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
                          className="text-slate-700 underline hover:text-slate-900"
                        >
                          {d.originalFilename}
                        </a>{" "}
                        <span className="text-slate-400">({d.documentDate})</span>
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
                    <Input
                      type="date"
                      name="documentDate"
                      defaultValue={new Date().toISOString().split("T")[0]}
                      className="h-8 w-36 text-xs"
                    />
                    <Button type="submit" size="sm" variant="secondary" disabled={isPending}>
                      Upload
                    </Button>
                    <button
                      type="button"
                      onClick={() => toggleSlot(slot.slotCode)}
                      className="text-xs text-slate-400 underline hover:text-slate-600"
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

      {!isResolved && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {step.status === "PENDING" && (
            <Button size="sm" variant="secondary" disabled={isPending} onClick={() => run(() => markStepInProgress(step.id))}>
              Start
            </Button>
          )}
          {step.isWaitingState && step.status !== "WAITING_EXTERNAL" && (
            <Button size="sm" variant="secondary" disabled={isPending} onClick={() => run(() => markStepWaitingExternal(step.id))}>
              Mark waiting
            </Button>
          )}
          {step.status === "WAITING_EXTERNAL" && (
            <Button size="sm" variant="secondary" disabled={isPending} onClick={() => run(() => logFollowUp(step.id))}>
              Log follow-up ({step.followUpCount})
            </Button>
          )}
          <Button
            size="sm"
            disabled={isPending || !!blockReason}
            title={blockReason ?? undefined}
            onClick={() => run(() => markStepDone(step.id))}
          >
            Mark done
          </Button>
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
        </div>
      )}

      {message && <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{message}</p>}
    </div>
  );
}
