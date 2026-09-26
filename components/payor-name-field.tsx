"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import type { SavedPayor } from "@/lib/actions/payors";

/**
 * Brief #5a — shared name field for the "Customers / payors" list, used
 * by step 1's customer rows and step 2's certificate form. A native
 * `<datalist>` gives suggestions from the client's saved list while still
 * allowing free typing (no combobox library — this codebase's inputs are
 * plain elements, not Radix). Typing or picking an exact saved name calls
 * `onSelectSaved` (step 2 uses this to autofill TIN/address/ATC); typing
 * a name that ISN'T on the list offers to save it inline, right here —
 * no trip to a separate screen. Editing here never changes the saved
 * entry itself — only a future pick from the list would.
 */
export function PayorNameField({
  id,
  name,
  value,
  onChange,
  payors,
  onSelectSaved,
  onSaveNew,
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
  /** Omit to disable the "save as new" offer entirely (e.g. a context with no client to save against). */
  onSaveNew?: (name: string) => Promise<{ ok: boolean; error?: string }>;
  placeholder?: string;
  required?: boolean;
}) {
  const listId = useId();
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const trimmed = value.trim();
  const matched = trimmed
    ? payors.find((p) => p.name.toLowerCase() === trimmed.toLowerCase())
    : undefined;
  const showOffer = !!onSaveNew && trimmed.length > 0 && !matched && dismissedFor !== trimmed;

  function handleChange(next: string) {
    onChange(next);
    setSaveError(null);
    const nextMatch = payors.find((p) => p.name.toLowerCase() === next.trim().toLowerCase());
    if (nextMatch && onSelectSaved) onSelectSaved(nextMatch);
  }

  async function handleSaveNew() {
    if (!onSaveNew) return;
    setSaving(true);
    setSaveError(null);
    const result = await onSaveNew(trimmed);
    setSaving(false);
    if (!result.ok) setSaveError(result.error ?? "Could not save.");
    else setDismissedFor(trimmed);
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
        <p className="text-xs text-slate-500">
          Not on your saved list.{" "}
          <button
            type="button"
            onClick={handleSaveNew}
            disabled={saving}
            className="text-slate-700 underline hover:text-slate-900"
          >
            {saving ? "Saving…" : `Save "${trimmed}" to Customers/payors`}
          </button>{" "}
          <button type="button" onClick={() => setDismissedFor(trimmed)} className="text-slate-400 underline">
            Not now
          </button>
        </p>
      )}
      {saveError && <p className="text-xs text-red-600">{saveError}</p>}
    </div>
  );
}
