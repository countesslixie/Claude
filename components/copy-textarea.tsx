"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * An editable, copyable block of text (rework brief #2 §5: the step 16
 * client email draft). `value` is only ever read into local state once,
 * on mount — a parent re-render with a DIFFERENT `defaultValue` does NOT
 * update what's shown (React's `useState(defaultValue)` only honors the
 * initial value). Brief #5e §2's diagnosis: this is exactly what made
 * step 4's live message preview go stale after a reopening event, since
 * this component stayed mounted across the page's re-render. Callers
 * showing a value that can change on the server MUST pass a `key` tied to
 * that value (e.g. `key={body}`) so React remounts instead of reusing
 * stale state; a caller showing a truly static, already-saved value (a
 * frozen filed snapshot, brief #5e §3's saved advice message) doesn't
 * need to.
 */
export function CopyTextarea({
  defaultValue,
  rows = 12,
  readOnly = false,
  hideCopy = false,
}: {
  defaultValue: string;
  rows?: number;
  readOnly?: boolean;
  /** D156 — a Complete filing's texts have no Copy button. */
  hideCopy?: boolean;
}) {
  const [value, setValue] = useState(defaultValue);
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
    <div className="flex flex-col gap-2">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        readOnly={readOnly}
        rows={rows}
        className="font-mono text-xs"
      />
      {!hideCopy && (
        <div>
          <Button type="button" size="sm" variant="secondary" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}
    </div>
  );
}
