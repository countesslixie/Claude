"use client";

import { useState } from "react";

/**
 * One "label · value · Copy" row (step 16's To/Subject rows, D102; step 4's, D198).
 * `readOnly` leaves out the Copy link (a Complete filing has no Copy, D156).
 */
export function CopyRow({ label, value, readOnly = false }: { label: string; value: string; readOnly?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-14 flex-shrink-0 text-faint">{label}</span>
      <span className="min-w-0 flex-1 break-all text-ink">{value}</span>
      {!readOnly && (
        <button type="button" onClick={copy} className="flex-shrink-0 text-faint underline hover:text-ink">
          {copied ? "Copied" : "Copy"}
        </button>
      )}
    </div>
  );
}
