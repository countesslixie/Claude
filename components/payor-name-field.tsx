"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import type { SavedPayor } from "@/lib/actions/payors";

/**
 * Brief #5a — shared name field for the saved payor list, used by step
 * 1's payor rows and step 2's certificate form. A native `<datalist>`
 * gives suggestions from the client's saved list while still allowing
 * free typing (no combobox library — this codebase's inputs are plain
 * elements, not Radix). Typing or picking an exact saved name calls
 * `onSelectSaved` (step 2 uses this to autofill TIN/address/ATC); typing
 * a name that ISN'T on the list offers to save it — right here — no trip
 * to a separate screen. Editing here never changes the saved entry
 * itself — only a future pick from the list would.
 *
 * Brief #5b — the offer now opens the shared PayorDetailsDialog (owned by
 * the caller, since it also needs the ATC list) instead of saving the
 * bare name immediately; `onRequestSave` just asks the caller to open it.
 * Once the dialog saves and the caller's payor list is updated, this
 * field's own `matched` check picks it up naturally and the offer drops
 * away — no separate dismiss needed for the success path.
 */
export function PayorNameField({
  id,
  name,
  value,
  onChange,
  payors,
  onSelectSaved,
  onRequestSave,
  placeholder,
  required,
}: {
  id?: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  payors: SavedPayor[];
  /** Called once when the typed value exactly matches a saved entry (case-insensitive). */
  onSelectSaved?: (payor: SavedPayor) => void;
  /** Omit to disable the "save as new" offer entirely (e.g. a context with no client to save against). Opens the caller's PayorDetailsDialog with this name pre-filled. */
  onRequestSave?: (name: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const listId = useId();
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  const trimmed = value.trim();
  const matched = trimmed
    ? payors.find((p) => p.name.toLowerCase() === trimmed.toLowerCase())
    : undefined;
  const showOffer = !!onRequestSave && trimmed.length > 0 && !matched && dismissedFor !== trimmed;

  function handleChange(next: string) {
    onChange(next);
    const nextMatch = payors.find((p) => p.name.toLowerCase() === next.trim().toLowerCase());
    if (nextMatch && onSelectSaved) onSelectSaved(nextMatch);
  }

  return (
    <div className="flex flex-col gap-1">
      <Input
        id={id}
        name={name}
        list={listId}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
      />
      <datalist id={listId}>
        {payors.map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>
      {showOffer && (
        <p className="text-xs text-faint">
          Not on your saved list.{" "}
          <button
            type="button"
            onClick={() => onRequestSave!(trimmed)}
            className="text-ink-secondary underline hover:text-ink"
          >
            {`Save "${trimmed}" to payors`}
          </button>{" "}
          <button type="button" onClick={() => setDismissedFor(trimmed)} className="text-faint underline">
            Not now
          </button>
        </p>
      )}
    </div>
  );
}
