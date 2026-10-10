"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { CopyTextarea } from "@/components/copy-textarea";
import { markStepDone, unskipStep } from "@/lib/actions/workflowSteps";
import { stepStatusLabel } from "@/lib/workflow/status";
import type { WorkflowStepStatus } from "@/lib/workflow/types";

/**
 * D101/D102 (brief #5r) — step 16, "Send client package". Mark done only (no
 * Start, no Skip — refused server-side too). Before Done: a To line, a
 * Subject line and the Body, each with its own Copy, plus Download package.
 * Marking it Done saves the exact email on the filing (D51's pattern) and
 * the card collapses to "Emailed [date]: [subject]" with a Show email link.
 * A filing whose step 16 was Done before the email was saved has no email
 * to show: it reads "Done [date]" and nothing more. A missing client email
 * shows one muted line and never blocks.
 */
export function ClientPackageStepCard({
  stepId,
  clientId,
  sequence,
  title,
  status,
  lockedMessage,
  to,
  subject,
  body,
  hasSavedEmail,
  doneDateLabel,
  savedAtLabel,
  skippedReason,
  downloadHref,
  readOnly = false,
}: {
  stepId: string;
  clientId: string;
  sequence: number;
  title: string;
  status: string;
  lockedMessage: string | null;
  to: string | null;
  subject: string;
  body: string;
  /** True once Done AND the email was saved at that moment. */
  hasSavedEmail: boolean;
  /** Manila date the step was marked Done (for the no-saved-email case). */
  doneDateLabel: string | null;
  savedAtLabel: string | null;
  skippedReason: string | null;
  downloadHref: string;
  /** D153/D156 — the filing is Complete: no Undo skip, no Copy, the text is read-only (the saved email can still be shown). */
  readOnly?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const isDone = status === "DONE";
  const isSkipped = status === "SKIPPED";
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

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setMessage(result.error ?? "Could not update this step.");
    });
  }

  const line = (key: string, label: string, value: string) => (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-14 flex-shrink-0 text-faint">{label}</span>
      <span className="min-w-0 flex-1 break-all text-ink">{value}</span>
      {!readOnly && (
        <button type="button" onClick={() => copy(key, value)} className="flex-shrink-0 text-faint underline hover:text-ink">
          {copied === key ? "Copied" : "Copy"}
        </button>
      )}
    </div>
  );

  const toLine = to ? (
    line("to", "To", to)
  ) : (
    <p className="text-xs text-faint">
      Client email missing —{" "}
      <Link href={`/clients/${clientId}/edit`} className="underline hover:text-ink">
        add it on the client page
      </Link>
    </p>
  );

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-ink">
          {sequence}. {title}
        </p>
        <StatusBadge tone={isDone ? "done" : "pending"}>{stepStatusLabel(status as WorkflowStepStatus)}</StatusBadge>
      </div>

      {!isNA && !isSkipped && !isDone && lockedMessage && <p className="mt-1 text-xs text-faint">{lockedMessage}</p>}

      {!isNA && !isSkipped && !isDone && !lockedMessage && (
        <div className="mt-2 flex flex-col gap-2">
          <div>
            <a href={downloadHref}>
              <Button type="button" size="sm" variant="secondary">
                Download package
              </Button>
            </a>
          </div>
          <div className="flex flex-col gap-1">
            {toLine}
            {line("subject", "Subject", subject)}
          </div>
          <CopyTextarea richCopy key={body} defaultValue={body} rows={14} readOnly={readOnly} hideCopy={readOnly} />
          <div>
            <Button size="sm" disabled={isPending} onClick={() => run(() => markStepDone(stepId))}>
              Mark done
            </Button>
          </div>
        </div>
      )}

      {isSkipped && (
        <div className="mt-1 flex flex-col gap-1">
          <p className="text-xs text-ink-secondary">Skipped{skippedReason ? ` — ${skippedReason}` : ""}</p>
          {!readOnly && (
            <div>
              <Button size="sm" variant="secondary" disabled={isPending} onClick={() => run(() => unskipStep(stepId))}>
                Undo skip
              </Button>
            </div>
          )}
        </div>
      )}

      {isDone && !hasSavedEmail && <p className="mt-1 text-xs text-ink-secondary">Done{doneDateLabel ? ` on ${doneDateLabel}` : ""}</p>}

      {isDone && hasSavedEmail && (
        <div className="mt-1 flex flex-col gap-1">
          <p className="text-xs text-ink-secondary">
            Emailed on {savedAtLabel}: {subject}{" "}
            <button type="button" onClick={() => setShow((v) => !v)} className="text-faint underline hover:text-ink">
              {show ? "Hide email" : "Show email"}
            </button>
          </p>
          {show && (
            <div className="flex flex-col gap-1">
              {toLine}
              <CopyTextarea richCopy defaultValue={body} rows={14} readOnly hideCopy={readOnly} />
            </div>
          )}
        </div>
      )}

      {message && <p className="mt-2 rounded bg-amber-tint px-2 py-1 text-xs text-amber">{message}</p>}
    </div>
  );
}
