"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { QuarterlySalesFormState } from "@/lib/actions/quarterlySales";

export function QuarterlySalesCard({
  quarter,
  isQ4,
  action,
  initialValues,
}: {
  quarter: "Q1" | "Q2" | "Q3" | "Q4";
  isQ4: boolean;
  action: (state: QuarterlySalesFormState, formData: FormData) => Promise<QuarterlySalesFormState>;
  initialValues?: Record<string, string>;
}) {
  const [state, formAction, isPending] = useActionState<QuarterlySalesFormState, FormData>(action, {
    values: initialValues,
  });

  const v = (key: string) => state.values?.[key] ?? initialValues?.[key] ?? "";
  const errs = (key: string) => state.fieldErrors?.[key];

  return (
    <form action={formAction} className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-900">{quarter}</h2>
        {isQ4 && (
          <span className="text-xs text-slate-400">Picked up by the ANNUAL return — no quarterly return of its own</span>
        )}
      </div>

      {state.error && <p className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${quarter}-grossSales`}>
            Gross sales (₱)<span className="text-red-500"> *</span>
          </Label>
          <Input
            id={`${quarter}-grossSales`}
            name="grossSales"
            defaultValue={v("grossSales")}
            required
            tabIndex={1}
          />
          {errs("grossSales")?.map((e) => (
            <p key={e} className="text-xs text-red-600">
              {e}
            </p>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${quarter}-nonOperatingIncome`}>Non-operating income (₱)</Label>
          <Input
            id={`${quarter}-nonOperatingIncome`}
            name="nonOperatingIncome"
            defaultValue={v("nonOperatingIncome")}
            tabIndex={2}
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
            tabIndex={3}
          />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor={`${quarter}-notes`}>Notes</Label>
          <Textarea id={`${quarter}-notes`} name="notes" rows={2} defaultValue={v("notes")} tabIndex={4} />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button type="submit" size="sm" disabled={isPending} tabIndex={5}>
          {isPending ? "Saving…" : "Save"}
        </Button>
        {state.saved && !isPending && <span className="text-xs text-emerald-600">Saved.</span>}
      </div>
    </form>
  );
}
