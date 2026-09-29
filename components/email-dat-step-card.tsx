"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { CopyTextarea } from "@/components/copy-textarea";
import { markStepDone } from "@/lib/actions/workflowSteps";
import { stepStatusLabel } from "@/lib/workflow/status";
import type { WorkflowStepStatus } from "@/lib/workflow/types";

/**
 * D87 (brief #5o §4) — step 12, "Email DAT file to BIR eSubmission". A
 * ready-to-copy email (To, Subject, Body — built by
 * lib/workflow/eSubmissionEmail.ts, the same idea as step 4's message) plus
 * a reminder of exactly which DAT file to attach, with a download link.
 * Mark done only — no Start, no Skip (refused server-side). Marking it
 * Done saves the exact draft on the filing (D51's pattern) and the card
 * collapses to "Emailed [date] — <subject>". Locked until step 11 is Done;
 * a missing RDO code shows one muted line and never blocks Mark done.
 */
export function EmailDatStepCard({
  stepId,
  clientId,
  sequence,
  title,
  status,
  lockedMessage,
  to,
  subject,
  body,
  rdoMissing,
  datFile,
  savedAtLabel,
}: {
  stepId: string;
  clientId: string;
  sequence: number;
  title: string;
  status: string;
  lockedMessage: string | null;
  to: string;
  subject: string;
  body: string;
  rdoMissing: boolean;
  datFile: { id: string; filename: string } | null;
  /** Manila-formatted date the draft was saved, once Done. */
  savedAtLabel: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const isDone = status === "DONE";
  const isNA = status === "NA";

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  function markDone() {
    setMessage(null);
    startTransition(async () => {
      const result = await markStepDone(stepId);
      if (!result.ok) setMessage(result.error ?? "Could not update this step.");
    });
  }

  const line = (key: string, label: string, value: string) => (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-14 flex-shrink-0 text-faint">{label}</span>
      <span className="min-w-0 flex-1 break-all text-ink">{value}</span>
      <button type="button" onClick={() => copy(key, value)} className="flex-shrink-0 text-faint underline hover:text-ink">
        {copied === key ? "Copied" : "Copy"}
      </button>
    </div>
  );

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-ink">
          {sequence}. {title}
        </p>
        <StatusBadge tone={isDone ? "done" : "pending"}>{stepStatusLabel(status as WorkflowStepStatus)}</StatusBadge>
      </div>

      {!isNA && lockedMessage && <p className="mt-1 text-xs text-faint">{lockedMessage}</p>}

      {!isNA && !lockedMessage && !isDone && (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            {line("to", "To", to)}
            {line("subject", "Subject", subject)}
          </div>
          <CopyTextarea key={body} defaultValue={body} rows={4} />
          {rdoMissing && (
            <p className="text-xs text-faint">
              RDO code missing —{" "}
              <Link href={`/clients/${clientId}/edit`} className="underline hover:text-ink">
                add it on the client page
              </Link>
            </p>
          )}
          <p className="text-xs text-ink-secondary">
            Attach:{" "}
            {datFile ? (
              <a href={`/api/documents/${datFile.id}/download`} className="underline hover:text-ink">
                {datFile.filename}
              </a>
            ) : (
              <span className="text-faint">the DAT file saved on step 11</span>
            )}
          </p>
          <div>
            <Button size="sm" disabled={isPending} onClick={markDone}>
              Mark done
            </Button>
          </div>
        </div>
      )}

      {!isNA && isDone && (
        <div className="mt-1 flex flex-col gap-1">
          <p className="text-xs text-ink-secondary">
            Emailed {savedAtLabel} — {subject}{" "}
            <button type="button" onClick={() => setShow((v) => !v)} className="text-faint underline hover:text-ink">
              {show ? "Hide email" : "Show email"}
            </button>
          </p>
          {show && (
            <div className="flex flex-col gap-1">
              {line("to", "To", to)}
              <CopyTextarea defaultValue={body} rows={4} readOnly />
            </div>
          )}
        </div>
      )}

      {message && <p className="mt-2 rounded bg-amber-tint px-2 py-1 text-xs text-amber">{message}</p>}
    </div>
  );
}
