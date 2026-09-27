"use client";

import { useActionState, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { centsToPesos } from "@/lib/money";
import type { OtherCreditsFormState } from "@/lib/actions/filings";

/**
 * Brief #5f §2/§3 — item 61 (1701Q) / item 63 (1701A), edited from step
 * 3's own card, above the computation sheet. Save/Edit/Cancel, mirroring
 * the income page's D40 pattern: unsaved (Filing.otherCreditsCents is
 * null) opens directly editable, pre-filled with the inherited value and
 * a small muted note naming its source; once saved, read-only with an
 * Edit button; `locked` (this filing's own step 5 is Done) drops the Edit
 * button entirely.
 */
export function OtherCreditsForm({
  action,
  locked,
  hasSavedValue,
  amountCents,
  description,
  sourceLabel,
}: {
  action: (state: OtherCreditsFormState, formData: FormData) => Promise<OtherCreditsFormState>;
  locked: boolean;
  /** True once Filing.otherCreditsCents is not null (an explicit save has happened on this filing). */
  hasSavedValue: boolean;
  /** The effective (saved or inherited) amount, in centavos. */
  amountCents: number;
  description: string;
  /** e.g. "Q2" or "starting figures" — null when there's nothing to inherit from (this is the year's own unsaved first return). */
  sourceLabel: string | null;
}) {
  const initialValues = { otherCredits: centsToPesos(amountCents), otherCreditsDescription: description };
  const [state, formAction, isPending] = useActionState<OtherCreditsFormState, FormData>(action, {
    values: initialValues,
  });
  const [editing, setEditing] = useState(!hasSavedValue);
  const [savedNow, setSavedNow] = useState(hasSavedValue);
  const [savedValues, setSavedValues] = useState(initialValues);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (!state.saved || !state.values) return;
    setSavedValues(state.values as { otherCredits: string; otherCreditsDescription: string });
    setSavedNow(true);
    setEditing(false);
  }, [state]);

  const v = (key: keyof typeof initialValues) => state.values?.[key] ?? initialValues[key];
  const errs = (key: string) => state.fieldErrors?.[key];

  function handleCancel() {
    setEditing(false);
    setFormKey((k) => k + 1);
  }

  const showForm = !locked && (editing || !savedNow);

  if (!showForm) {
    return (
      <div className="rounded border border-slate-200 bg-slate-50 p-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-slate-700">
            Other tax credits/payments (item 61): {centsToPesos(pesosStrToCentsSafe(savedValues.otherCredits), { withSymbol: true })}
            {savedValues.otherCreditsDescription ? ` — ${savedValues.otherCreditsDescription}` : ""}
            {!savedNow && sourceLabel && <span className="ml-1 text-slate-400">(from {sourceLabel})</span>}
          </p>
          {!locked && (
            <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form key={formKey} action={formAction} className="flex flex-col gap-2 rounded border border-slate-200 p-2">
      <p className="text-xs font-medium text-slate-700">Other tax credits/payments (item 61)</p>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {!hasSavedValue && sourceLabel && (
        <p className="text-xs text-slate-400">Pre-filled from {sourceLabel} — edit and Save to set this filing&apos;s own figure.</p>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="otherCredits" className="text-xs">
            Amount (₱)
          </Label>
          <Input id="otherCredits" name="otherCredits" defaultValue={v("otherCredits")} className="h-8 text-xs" />
          {errs("otherCredits")?.map((e) => (
            <p key={e} className="text-xs text-red-600">{e}</p>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="otherCreditsDescription" className="text-xs">
            Specify
          </Label>
          <Input
            id="otherCreditsDescription"
            name="otherCreditsDescription"
            defaultValue={v("otherCreditsDescription")}
            className="h-8 text-xs"
          />
          {errs("otherCreditsDescription")?.map((e) => (
            <p key={e} className="text-xs text-red-600">{e}</p>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="secondary" disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
        {hasSavedValue && (
          <button type="button" onClick={handleCancel} className="text-xs text-slate-400 underline">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function pesosStrToCentsSafe(value: string): number {
  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) return 0;
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
