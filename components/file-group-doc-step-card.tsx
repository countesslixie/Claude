"use client";

import { useState, useTransition } from "react";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { uploadDocument } from "@/lib/actions/documents";
import { birWaitTone } from "@/lib/workflow/aging";
import { stepStatusLabel } from "@/lib/workflow/status";
import { fileTooLargeMessage } from "@/lib/upload";
import type { WorkflowStepStatus } from "@/lib/workflow/types";
import { formatDays } from "@/lib/formatDays";

const AGING_TONE: Record<string, StatusTone> = { green: "done", amber: "waiting", red: "overdue" };

export interface FileGroupDoc {
  id: string;
  originalFilename: string;
}

/**
 * Every self-completing document step (D67/D71/D75): steps 6, 7 (File), 9
 * (Pay), 10, 14 (BIR Confirmations). The file IS the step (D27), so there
 * is no Mark done button here at all — attaching the document completes
 * the step by itself (lib/actions/workflowSteps.ts's
 * recomputeFileGroupDocStepStatus), the same self-completing pattern
 * RECEIVE_2307 already uses (D46).
 *
 * Locked entirely until its own gating step is Done: just the Pending pill
 * and a muted "Available once step N is done" line, no upload box and no
 * controls of any kind. This is status about this step's own state, not a
 * block-reason explaining a disabled button (D41) — the same distinction
 * the amber "waiting on..." group summary already relies on — so it's
 * allowed to render as standing text here.
 *
 * Once unlocked, the upload box (file + date + Upload) sits directly on
 * the card with no "Attach" link to open it first. Once Done, the file
 * shows as a normal saved document row with a Replace action (one-for-one,
 * D46's pattern).
 *
 * D68/D71 (briefs #5l/#5m) — steps 10 and 14 alone enter WAITING_EXTERNAL
 * automatically (the instant their own gating step is Done), never by a
 * manual click — there is no Mark waiting button anywhere on this card for
 * any of the five steps it's used for. D72 (brief #5m §2) — no Log
 * follow-up either: she can't follow up with BIR on any of these, so the
 * only thing a waiting state shows is a single "Waiting on BIR · N days" pill,
 * coloured by the aging thresholds (amber while waiting, red once past
 * twice the expected response days — never green on a waiting step),
 * replacing what used to be three separate pieces (grey "waiting on"
 * text, a green aging pill, and an amber "Waiting" status pill all at
 * once).
 */
export function FileGroupDocStepCard({
  stepId,
  sequence,
  title,
  status,
  isUnlocked,
  lockedMessage,
  slots,
  waitingOnLabel,
  agingDaysWaiting,
  agingTone,
}: {
  stepId: string;
  sequence: number;
  title: string;
  status: string;
  /** Whether this card's own gating step is Done — locked until then. */
  isUnlocked: boolean;
  /** e.g. "Available once step 5 is done." — shown in place of any controls while locked. */
  lockedMessage: string;
  /**
   * One entry per required document. Steps 6, 7, 9, 10, 13, 14 have one; step 11
   * (D86) has two — the generated report and the DAT file — and is Done only when
   * BOTH have a file (lib/actions/workflowSteps.ts's recomputeFileGroupDocStepStatus).
   */
  slots: { slotCode: string; label: string; documents: FileGroupDoc[] }[];
  waitingOnLabel: string | null;
  agingDaysWaiting: number | null;
  agingTone: "green" | "amber" | "red" | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<string | null>(null);

  const isDone = status === "DONE";
  const isWaiting = status === "WAITING_EXTERNAL";
  // D76 — an NA'd step (SAVE_PROOF_PAYMENT, on a "nothing to pay" return)
  // sits behind the "Show N not applicable" toggle like any other NA step
  // — just its pill, never a locked message or a form, the same as the
  // generic WorkflowStepCard already does for NA.
  const isNA = status === "NA";
  // D72 — the single combined pill applies wherever this card is used for
  // a BIR wait (steps 10, 14); step 9 never enters WAITING_EXTERNAL at
  // all (D75 §3.3), so this never fires for it.
  const isWaitingOnBir = isWaiting && waitingOnLabel === "BIR";

  function handleUpload(slotCode: string, formData: FormData) {
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
      setReplacing(null);
      if (result.duplicateWarning) setMessage(result.duplicateWarning);
    });
  }

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-ink">
          {sequence}. {title}
        </p>
        <div className="flex items-center gap-1.5">
          {isWaitingOnBir ? (
            <StatusBadge tone={birWaitTone(agingTone)}>
              Waiting on BIR{agingDaysWaiting != null ? ` · ${formatDays(agingDaysWaiting)}` : ""}
            </StatusBadge>
          ) : (
            <>
              {agingTone && <StatusBadge tone={AGING_TONE[agingTone]}>{formatDays(agingDaysWaiting ?? 0)}</StatusBadge>}
              <StatusBadge tone={isDone ? "done" : isWaiting ? "waiting" : "pending"}>
                {stepStatusLabel(status as WorkflowStepStatus)}
              </StatusBadge>
            </>
          )}
        </div>
      </div>

      {!isNA && !isUnlocked && <p className="mt-1 text-xs text-faint">{lockedMessage}</p>}

      {!isNA &&
        isUnlocked &&
        slots.map((slot) => {
          const hasFile = slot.documents.length > 0;
          const showForm = !hasFile || replacing === slot.slotCode;
          return (
            <div key={slot.slotCode} className={slots.length > 1 ? "mt-2 rounded border border-line bg-background p-2" : "mt-2"}>
              {slots.length > 1 && <p className="text-xs font-medium text-ink-secondary">{slot.label}</p>}
              {hasFile && (
                <ul className="flex flex-col gap-0.5">
                  {slot.documents.map((d) => (
                    <li key={d.id} className="text-xs">
                      <a href={`/api/documents/${d.id}/download`} className="text-ink-secondary underline hover:text-ink">
                        {d.originalFilename}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {showForm ? (
                <form action={(fd) => handleUpload(slot.slotCode, fd)} className="mt-1 flex items-center gap-1.5">
                  <p className="sr-only">{slot.label}</p>
                  <Input type="file" name="file" required className="h-8 text-xs" />
                  <Button type="submit" size="sm" variant="secondary" disabled={isPending}>
                    {hasFile ? "Replace" : "Upload"}
                  </Button>
                  {hasFile && (
                    <button
                      type="button"
                      onClick={() => setReplacing(null)}
                      className="text-xs text-faint underline hover:text-ink-secondary"
                    >
                      Cancel
                    </button>
                  )}
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setReplacing(slot.slotCode)}
                  className="mt-1 text-xs text-faint underline hover:text-ink"
                >
                  Replace
                </button>
              )}
            </div>
          );
        })}

      {message && <p className="mt-2 rounded bg-amber-tint px-2 py-1 text-xs text-amber">{message}</p>}
    </div>
  );
}
