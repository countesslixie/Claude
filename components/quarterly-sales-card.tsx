"use client";

import { useActionState, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { QuarterlySalesFormState } from "@/lib/actions/quarterlySales";

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
 */
export function QuarterlySalesCard({
  quarter,
  isQ4,
  action,
  initialValues,
}: {
  quarter: "Q1" | "Q2" | "Q3" | "Q4";
  isQ4: boolean;
  action: (state: QuarterlySalesFormState, formData: FormData) => Promise<QuarterlySalesFormState>;
  initialValues?: {
    customers: CustomerRow[];
    nonOperatingIncome: string;
    sourceNote: string;
    notes: string;
    noSalesThisQuarter: boolean;
  };
}) {
  const [state, formAction, isPending] = useActionState<QuarterlySalesFormState, FormData>(action, {
    values: initialValues,
  });

  const [rows, setRows] = useState<CustomerRow[]>(
    initialValues?.customers && initialValues.customers.length > 0 ? initialValues.customers : [EMPTY_ROW],
  );
  const [noSales, setNoSales] = useState(initialValues?.noSalesThisQuarter ?? false);

  // Re-sync from the server's echoed values after every submit (success or
  // validation error) so a rejected save doesn't lose what she typed.
  useEffect(() => {
    if (!state.values) return;
    setRows(state.values.customers.length > 0 ? state.values.customers : [EMPTY_ROW]);
    setNoSales(state.values.noSalesThisQuarter);
  }, [state.values]);

  const v = (key: "nonOperatingIncome" | "sourceNote" | "notes") =>
    state.values?.[key] ?? initialValues?.[key] ?? "";
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

  return (
    <form action={formAction} className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-900">{quarter}</h2>
        {isQ4 && (
          <span className="text-xs text-slate-400">Picked up by the ANNUAL return — no quarterly return of its own</span>
        )}
      </div>

      {state.error && <p className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}

      <label className="mb-3 flex items-center gap-1.5 text-sm text-slate-700">
        <Checkbox
          name="noSalesThisQuarter"
          checked={noSales}
          onChange={(e) => setNoSales(e.target.checked)}
        />
        No sales this quarter
      </label>

      {!noSales && (
        <div className="mb-3 flex flex-col gap-2">
          <div className="grid grid-cols-[1fr_160px_auto] gap-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            <span>Customer</span>
            <span>Amount (₱)</span>
            <span></span>
          </div>
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_160px_auto] gap-2">
              <Input
                name="customerName"
                value={row.customerName}
                onChange={(e) => updateRow(i, "customerName", e.target.value)}
                placeholder="Customer name"
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
            <p key={e} className="text-xs text-red-600">
              {e}
            </p>
          ))}
          <div>
            <Button type="button" variant="secondary" size="sm" onClick={addRow}>
              Add customer
            </Button>
          </div>
        </div>
      )}

      <p className="mb-3 text-sm text-slate-700">
        Quarter total: <span className="font-medium">₱{formatPesos(total)}</span>
        <span className="ml-1 text-xs text-slate-400">(sum of the rows above — not itself an input)</span>
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
            <p key={e} className="text-xs text-red-600">
              {e}
            </p>
          ))}
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor={`${quarter}-sourceNote`}>Where this figure came from</Label>
          <Input
            id={`${quarter}-sourceNote`}
            name="sourceNote"
            placeholder="e.g. client's own summary, texted Sept 14"
            defaultValue={v("sourceNote")}
          />
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
        {state.saved && !isPending && (
          <span className="text-xs text-emerald-600">
            Saved.{state.finalized ? " Step 1 marked done." : ""}
          </span>
        )}
      </div>
    </form>
  );
}
