"use client";

import { useState } from "react";
import Link from "next/link";
import { CopyTextarea } from "@/components/copy-textarea";
import { CopyRow } from "@/components/copy-row";

/**
 * Brief #5e §3 — step 4's message card. While not yet Done, it's a live
 * preview keyed on its own text (see copy-textarea.tsx) so it never goes
 * stale across a reopening event. Once Done, it collapses to one summary
 * line ("Advised [date] · Amount payable ₱X" / "Overpayment ₱X") with a
 * "Show message" link revealing the exact text saved at Mark done,
 * read-only, with its own Copy button. Reopening (brief #5d §6) clears
 * the saved text server-side, which flips this back to the live preview.
 */
export function AdviceMessageCard({
  clientId,
  clientEmail,
  isDone,
  savedAtLabel,
  isOverpayment,
  amountLabel,
  subject,
  body,
  readOnly = false,
}: {
  clientId: string;
  /** D191 — shown above the Subject line, display only (null/blank = the "email missing" line). */
  clientEmail: string | null;
  isDone: boolean;
  /** Manila-formatted date the message was saved, e.g. "Sep 27, 2026". Only meaningful when isDone. */
  savedAtLabel: string | null;
  isOverpayment: boolean;
  /** Pre-formatted peso amount, e.g. "₱12,100.00". */
  amountLabel: string;
  subject: string;
  body: string;
  /** D156 — the filing is Complete: the saved text can be shown but not copied or typed in. */
  readOnly?: boolean;
}) {
  const [showMessage, setShowMessage] = useState(false);

  // D191/D198 — the same To and Subject rows as step 16, each with Copy (none on a Complete filing, D156).
  // A client with no email gets the muted missing line instead, with no Copy.
  const toLine = clientEmail?.trim() ? (
    <CopyRow label="To" value={clientEmail.trim()} readOnly={readOnly} />
  ) : (
    <p className="text-xs text-faint">
      Client email missing —{" "}
      <Link href={`/clients/${clientId}/edit`} className="underline hover:text-ink">
        add it on the client page
      </Link>
    </p>
  );
  const subjectLine = <CopyRow label="Subject" value={subject} readOnly={readOnly} />;

  if (!isDone) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium text-ink-secondary">Message to client</p>
        {toLine}
        {subjectLine}
        <CopyTextarea richCopy key={body} defaultValue={body} rows={8} readOnly={readOnly} hideCopy={readOnly} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-ink-secondary">
        Advised on {savedAtLabel} · {isOverpayment ? "Overpayment" : "Amount payable"} {amountLabel}
        {" — "}
        <button
          type="button"
          onClick={() => setShowMessage((v) => !v)}
          className="text-faint underline hover:text-ink"
        >
          {showMessage ? "Hide message" : "Show message"}
        </button>
      </p>
      {showMessage && (
        <div className="flex flex-col gap-1">
          {toLine}
          {subjectLine}
          <CopyTextarea richCopy defaultValue={body} rows={8} readOnly hideCopy={readOnly} />
        </div>
      )}
    </div>
  );
}
