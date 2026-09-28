"use client";

import { useState, useTransition } from "react";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { markStepWaitingExternal, logFollowUp } from "@/lib/actions/workflowSteps";
import { uploadDocument } from "@/lib/actions/documents";
import { stepStatusLabel } from "@/lib/workflow/status";
import { fileTooLargeMessage } from "@/lib/upload";
import type { WorkflowStepStatus } from "@/lib/workflow/types";

const AGING_TONE: Record<string, StatusTone> = { green: "done", amber: "waiting", red: "overdue" };

export interface FileGroupDoc {
  id: string;
  originalFilename: string;
  documentDate: string;
}

/**
 * Brief #5k §4 (D67) — steps 6, 7 and 10 (SAVE_SUBMISSION_SS,
 * SAVE_FORM_COPY, RECEIVE_TRRC): the file IS the step (D27), so there is
 * no Mark done button here at all — attaching the document completes the
 * step by itself (lib/actions/workflowSteps.ts's
 * recomputeFileGroupDocStepStatus), the same self-completing pattern
 * RECEIVE_2307 already uses (D46).
 *
 * Locked entirely until step 5 (FILE_RETURN) is Done: just the Pending
 * pill and a muted "Available once step 5 is done" line, no upload box
 * and no controls of any kind. This is status about this step's own
 * state, not a block-reason explaining a disabled button (D41) — the
 * same distinction the amber "waiting on..." group summary already
 * relies on — so it's allowed to render as standing text here.
 *
 * Once unlocked, the upload box (file + date + Upload) sits directly on
 * the card with no "Attach" link to open it first. RECEIVE_TRRC alone
 * also keeps Mark waiting (hasMarkWaiting) — it's still waiting on
 * someone else (BIR), unlike 6/7 which are purely "save this file."
 * Once Done, the file shows as a normal saved document row with a
 * Replace action (one-for-one, D46's pattern).
 */
export function FileGroupDocStepCard({
  stepId,
  sequence,
  title,
  status,
  isStep5Done,
  slotCode,
  slotLabel,
  documents,
  hasMarkWaiting = false,
  waitingOnLabel,
  followUpCount,
  agingDaysWaiting,
  agingTone,
}: {
  stepId: string;
  sequence: number;
  title: string;
  status: string;
  /** Whether step 5 (FILE_RETURN) is Done — this card is locked until then. */
  isStep5Done: boolean;
  slotCode: string;
  slotLabel: string;
  documents: FileGroupDoc[];
  /** Only RECEIVE_TRRC (step 10) gets Mark waiting. */
  hasMarkWaiting?: boolean;
  waitingOnLabel: string | null;
  followUpCount: number;
  agingDaysWaiting: number | null;
  agingTone: "green" | "amber" | "red" | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [showReplace, setShowReplace] = useState(false);

  const isDone = status === "DONE";
  const isWaiting = status === "WAITING_EXTERNAL";

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setMessage(result.error ?? "Could not update this step.");
    });
  }

  function handleUpload(formData: FormData) {
    const file = formData.get("file");
    if (file instanceof File) {
      const tooLarge = fileTooLargeMessage(file);
      if (tooLarge) {
        setMessage(tooLarge);
        return;
      }
    }
    formData.set("workflowStepId", stepId);
    formData.set("docSlotCode", slotCode);
    setMessage(null);
    startTransition(async () => {
      const result = await uploadDocument(formData);
      if (!result.ok) {
        setMessage(result.error ?? "Upload failed.");
        return;
      }
      setShowReplace(false);
      if (result.duplicateWarning) setMessage(result.duplicateWarning);
    });
  }

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-ink">
          {sequence}. {title}
          {isWaiting && waitingOnLabel && (
            <span className="ml-1 text-xs font-normal text-faint">waiting on {waitingOnLabel}</span>
          )}
        </p>
        <div className="flex items-center gap-1.5">
          {agingTone && <StatusBadge tone={AGING_TONE[agingTone]}>{agingDaysWaiting}d</StatusBadge>}
          <StatusBadge tone={isDone ? "done" : isWaiting ? "waiting" : "pending"}>
            {stepStatusLabel(status as WorkflowStepStatus)}
          </StatusBadge>
        </div>
      </div>

      {!isStep5Done && <p className="mt-1 text-xs text-faint">Available once step 5 is done.</p>}

      {isStep5Done && documents.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5">
          {documents.map((d) => (
            <li key={d.id} className="text-xs">
              <a href={`/api/documents/${d.id}/download`} className="text-ink-secondary underline hover:text-ink">
                {d.originalFilename}
              </a>{" "}
              <span className="text-faint">({d.documentDate})</span>
            </li>
          ))}
        </ul>
      )}

      {isStep5Done && !isDone && (
        <div className="mt-2 flex flex-col gap-2">
          {hasMarkWaiting && !isWaiting && (
            <div>
              <Button size="sm" variant="secondary" disabled={isPending} onClick={() => run(() => markStepWaitingExternal(stepId))}>
                Mark waiting
              </Button>
            </div>
          )}
          {hasMarkWaiting && isWaiting && (
            <div>
              <Button size="sm" variant="secondary" disabled={isPending} onClick={() => run(() => logFollowUp(stepId))}>
                Log follow-up ({followUpCount})
              </Button>
            </div>
          )}
          <form action={handleUpload} className="flex items-center gap-1.5">
            <p className="sr-only">{slotLabel}</p>
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
          </form>
        </div>
      )}

      {isStep5Done && isDone && !showReplace && (
        <button
          type="button"
          onClick={() => setShowReplace(true)}
          className="mt-1 text-xs text-faint underline hover:text-ink"
        >
          Replace
        </button>
      )}
      {isStep5Done && isDone && showReplace && (
        <form action={handleUpload} className="mt-1 flex items-center gap-1.5">
          <Input type="file" name="file" required className="h-8 text-xs" />
          <Input
            type="date"
            name="documentDate"
            defaultValue={new Date().toISOString().split("T")[0]}
            className="h-8 w-36 text-xs"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={isPending}>
            Replace
          </Button>
          <button
            type="button"
            onClick={() => setShowReplace(false)}
            className="text-xs text-faint underline hover:text-ink-secondary"
          >
            Cancel
          </button>
        </form>
      )}

      {message && <p className="mt-2 rounded bg-amber-tint px-2 py-1 text-xs text-amber">{message}</p>}
    </div>
  );
}
