"use client";

import { useActionState, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PayorNameField } from "@/components/payor-name-field";
import { PayorDetailsDialog } from "@/components/payor-details-dialog";
import type { SelectableAtcCode } from "@/components/atc-code-select";
import type { QuarterlySalesFormState } from "@/lib/actions/quarterlySales";
import type { SavedPayor } from "@/lib/actions/payors";

type CustomerRow = { customerName: string; amount: string };

const EMPTY_ROW: CustomerRow = { customerName: "", amount: "" };

/** Same peso-string parsing tolerance as the server (lib/money.ts's pesosToCents) — for the live, client-side derived total only. */
function parsePesos(input: string): number {
  const normalized = input.replace(/,/g, "").trim();
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function formatPesos(n: number): string {
  return n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Brief #4b (D33) — a quarter's gross sales is the sum of zero or more
 * per-customer rows, added and removed freely; the total shown is always
 * derived from the rows, never itself an input. "No sales this quarter"
 * is a deliberate ₱0, distinct from leaving the quarter untouched. Save
 * as draft stores the rows without marking step 1 done; Save does both.
 *
 * Brief #4d — the card now shows plainly whether it's saved at all, and
 * if so whether that save is a draft or final:
 *   - nothing saved yet: no label, opens editable (unchanged).
 *   - draft saved: "Draft saved [date] — not final. Step 1 is still
 *     open.", opens editable (unchanged) — no Edit/Cancel toggle.
 *   - final: "Saved [date] — step 1 is done.", opens READ-ONLY with an
 *     Edit button. Edit reveals the same form with a Cancel button
 *     added (discards unsaved changes, returns to read-only). Saving
 *     the edit as a draft reverts step 1 to open and drops back to the
 *     plain editable (no-toggle) state; saving it final keeps step 1
 *     done and leaves the income page for the filing page.
 * A final Save always returns to the filing page; Save as draft always
 * stays here with a short confirmation instead.
 */
export function QuarterlySalesCard({
  quarter,
  isQ4,
  action,
  initialValues,
  initialFinalized,
  initialSavedAt,
  filingHref,
  payors,
  atcCodes,
  onSaveNewPayor,
}: {
  quarter: "Q1" | "Q2" | "Q3" | "Q4";
  isQ4: boolean;
  action: (state: QuarterlySalesFormState, formData: FormData) => Promise<QuarterlySalesFormState>;
  initialValues?: {
    customers: CustomerRow[];
    nonOperatingIncome: string;
    notes: string;
    noSalesThisQuarter: boolean;
  };
  /** Whether step 1 is currently Done for this quarter (false if nothing's ever been saved, or it's only a draft). */
  initialFinalized: boolean;
  /** Manila-formatted date of the last save, or null if nothing's been saved yet. */
  initialSavedAt: string | null;
  /** Where a successful final Save returns to. */
  filingHref: string;
  /** Brief #5a — the client's saved payor list, offered on each row's name field. */
  payors: SavedPayor[];
  atcCodes: SelectableAtcCode[];
  onSaveNewPayor: (data: {
    name: string;
    tin?: string;
    address?: string;
    usualAtcCode?: string;
  }) => Promise<{ ok: true; payor: SavedPayor } | { ok: false; error: string }>;
}) {
  const [state, formAction, isPending] = useActionState<QuarterlySalesFormState, FormData>(action, {
    values: initialValues,
  });

  const [rows, setRows] = useState<CustomerRow[]>(
    initialValues?.customers && initialValues.customers.length > 0 ? initialValues.customers : [EMPTY_ROW],
  );
  const [localPayors, setLocalPayors] = useState(payors);
  // Brief #5b — "Save … to payors" opens the shared dialog rather than
  // saving the bare name; one dialog instance per card, since only one
  // row's offer can be in flight at a time. null means closed.
  const [dialogName, setDialogName] = useState<string | null>(null);

  async function handleDialogSave(draft: {
    name: string;
    tin?: string;
    address?: string;
    usualAtcCode?: string;
  }): Promise<{ ok: true; payor: SavedPayor } | { ok: false; error: string }> {
    const result = await onSaveNewPayor(draft);
    if (result.ok) setLocalPayors((prev) => [...prev, result.payor]);
    return result;
  }
  const [noSales, setNoSales] = useState(initialValues?.noSalesThisQuarter ?? false);
  const [finalized, setFinalized] = useState(initialFinalized);
  const [savedAt, setSavedAt] = useState(initialSavedAt);
  const [overrideEditing, setOverrideEditing] = useState(false);
  const [formKey, setFormKey] = useState(0);

  // Re-sync from the server's echoed values after every submit (success or
  // validation error) so a rejected save doesn't lose what she typed.
  useEffect(() => {
    if (!state.values) return;
    setRows(state.values.customers.length > 0 ? state.values.customers : [EMPTY_ROW]);
    setNoSales(state.values.noSalesThisQuarter);
  }, [state.values]);

  // Brief #4d — react to what this save actually left behind: final
  // redirects to the filing page (a real navigation, not router.push —
  // that raced against Next's own revalidation refresh of this same
  // route and silently lost); draft (including a revert from final)
  // updates the label and drops any Edit override.
  useEffect(() => {
    if (!state.saved) return;
    if (state.savedAt) setSavedAt(state.savedAt);
    if (state.finalized) {
      setFinalized(true);
      window.location.href = filingHref;
    } else {
      setFinalized(false);
      setOverrideEditing(false);
    }
  }, [state, filingHref]);

  const v = (key: "nonOperatingIncome" | "notes") => state.values?.[key] ?? initialValues?.[key] ?? "";
  const errs = (key: string) => state.fieldErrors?.[key];

  const total = noSales ? 0 : rows.reduce((sum, r) => sum + parsePesos(r.amount), 0);

  function addRow() {
    setRows((r) => [...r, { ...EMPTY_ROW }]);
  }
  function removeRow(i: number) {
    setRows((r) => r.filter((_, idx) => idx !== i));
  }
  function updateRow(i: number, field: keyof CustomerRow, value: string) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));
  }

  function handleCancel() {
    const src = state.values ?? initialValues;
    setRows(src?.customers && src.customers.length > 0 ? src.customers : [EMPTY_ROW]);
    setNoSales(src?.noSalesThisQuarter ?? false);
    setOverrideEditing(false);
    // Uncontrolled inputs (nonOperatingIncome, notes) only pick up a new
    // defaultValue on mount — force one so Cancel actually discards them.
    setFormKey((k) => k + 1);
  }

  const savedLabel = savedAt
    ? finalized
      ? `Saved ${savedAt} — step 1 is done.`
      : `Draft saved ${savedAt} — not final. Step 1 is still open.`
    : null;

  const showForm = !finalized || overrideEditing;

  if (!showForm) {
    return (
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-ink">{quarter}</h2>
          <Button type="button" size="sm" variant="secondary" onClick={() => setOverrideEditing(true)}>
            Edit
          </Button>
        </div>
        {savedLabel && <p className="mb-2 text-xs font-medium text-faint">{savedLabel}</p>}
        <p className="text-sm text-ink-secondary">
          Quarter total: <span className="font-medium">₱{formatPesos(total)}</span>
        </p>
        <p className="mt-1 text-sm text-ink-secondary">
          {noSales
            ? "No sales this quarter"
            : rows.filter((r) => r.customerName.trim() !== "").length > 0
              ? rows
                  .filter((r) => r.customerName.trim() !== "")
                  .map((r) => r.customerName)
                  .join(", ")
              : "—"}
        </p>
      </div>
    );
  }

  return (
    <>
    <form key={formKey} action={formAction} className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-ink">{quarter}</h2>
        {isQ4 && (
          <span className="text-xs text-faint">Picked up by the ANNUAL return — no quarterly return of its own</span>
        )}
      </div>

      {savedLabel && <p className="mb-2 text-xs font-medium text-faint">{savedLabel}</p>}

      {state.error && <p className="mb-2 rounded-md bg-red-tint px-3 py-2 text-sm text-red">{state.error}</p>}

      <label className="mb-3 flex items-center gap-1.5 text-sm text-ink-secondary">
        <Checkbox
          name="noSalesThisQuarter"
          checked={noSales}
          onChange={(e) => setNoSales(e.target.checked)}
        />
        No sales this quarter
      </label>

      {!noSales && (
        <div className="mb-3 flex flex-col gap-2">
          <div className="grid grid-cols-[1fr_160px_auto] gap-2 text-xs font-medium uppercase tracking-wide text-faint">
            <span>Payor</span>
            <span>Amount (₱)</span>
            <span></span>
          </div>
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_160px_auto] gap-2">
              <PayorNameField
                name="customerName"
                value={row.customerName}
                onChange={(v) => updateRow(i, "customerName", v)}
                payors={localPayors}
                onRequestSave={setDialogName}
                placeholder="Payor name"
              />
              <Input
                name="amount"
                value={row.amount}
                onChange={(e) => updateRow(i, "amount", e.target.value)}
                placeholder="0.00"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={rows.length === 1}
                onClick={() => removeRow(i)}
              >
                Remove
              </Button>
            </div>
          ))}
          {errs("customers")?.map((e) => (
            <p key={e} className="text-xs text-red">
              {e}
            </p>
          ))}
          <div>
            <Button type="button" variant="secondary" size="sm" onClick={addRow}>
              Add payor
            </Button>
          </div>
        </div>
      )}

      <p className="mb-3 text-sm text-ink-secondary">
        Quarter total: <span className="font-medium">₱{formatPesos(total)}</span>
        <span className="ml-1 text-xs text-faint">(sum of the rows above — not itself an input)</span>
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${quarter}-nonOperatingIncome`}>Non-operating income (₱)</Label>
          <Input
            id={`${quarter}-nonOperatingIncome`}
            name="nonOperatingIncome"
            defaultValue={v("nonOperatingIncome")}
          />
          {errs("nonOperatingIncome")?.map((e) => (
            <p key={e} className="text-xs text-red">
              {e}
            </p>
          ))}
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor={`${quarter}-notes`}>Notes</Label>
          <Textarea id={`${quarter}-notes`} name="notes" rows={2} defaultValue={v("notes")} />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button type="submit" name="intent" value="draft" variant="secondary" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save as draft"}
        </Button>
        <Button type="submit" name="intent" value="final" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
        {finalized && overrideEditing && (
          <button type="button" onClick={handleCancel} className="text-xs text-faint underline">
            Cancel
          </button>
        )}
        {state.saved && !isPending && !state.finalized && (
          <span className="text-xs text-green">Draft saved.</span>
        )}
      </div>
    </form>
    <PayorDetailsDialog
      open={dialogName !== null}
      initialName={dialogName ?? ""}
      atcCodes={atcCodes}
      onSave={handleDialogSave}
      onClose={() => setDialogName(null)}
    />
    </>
  );
}
