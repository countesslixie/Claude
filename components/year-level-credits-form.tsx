"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { centsToPesos } from "@/lib/money";
import type { YearLevelCreditsFormState } from "@/lib/actions/clientTaxYears";

/**
 * Brief #5e §8 — items 55/57 (prior-year excess credit) and 61/63 (other
 * tax credits/payments), edited inline from a filing's own computation
 * sheet. Both are single client-year figures (ClientTaxYear), the same
 * full amount on every return of the year. Editable while THIS filing's
 * step 3 is not Done; read-only once it is (server-enforced too, in
 * lib/actions/clientTaxYears.ts's updateYearLevelCredits).
 */
export function YearLevelCreditsForm({
  action,
  readOnly,
  initialValues,
}: {
  action: (state: YearLevelCreditsFormState, formData: FormData) => Promise<YearLevelCreditsFormState>;
  readOnly: boolean;
  initialValues: { priorYearExcessCredit: string; otherCredits: string; otherCreditsDescription: string };
}) {
  const [state, formAction, isPending] = useActionState<YearLevelCreditsFormState, FormData>(action, {
    values: initialValues,
  });

  const v = (key: string) => state.values?.[key] ?? initialValues[key as keyof typeof initialValues] ?? "";
  const errs = (key: string) => state.fieldErrors?.[key];

  if (readOnly) {
    return (
      <div className="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
        <p className="font-medium text-slate-700">Year-level credits (read-only — step 3 is Done)</p>
        <p className="mt-1">Prior year&apos;s excess credit: {centsToPesos(pesosStrToCentsSafe(v("priorYearExcessCredit")), { withSymbol: true })}</p>
        <p>
          Other tax credits/payments: {centsToPesos(pesosStrToCentsSafe(v("otherCredits")), { withSymbol: true })}
          {v("otherCreditsDescription") ? ` — ${v("otherCreditsDescription")}` : ""}
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded border border-slate-200 p-2">
      <p className="text-xs font-medium text-slate-700">Year-level credits (applies to every return of this taxable year)</p>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="priorYearExcessCredit" className="text-xs">
            Prior year&apos;s excess credit (₱)
          </Label>
          <Input id="priorYearExcessCredit" name="priorYearExcessCredit" defaultValue={v("priorYearExcessCredit")} className="h-8 text-xs" />
          {errs("priorYearExcessCredit")?.map((e) => (
            <p key={e} className="text-xs text-red-600">{e}</p>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="otherCredits" className="text-xs">
            Other tax credits/payments (₱)
          </Label>
          <Input id="otherCredits" name="otherCredits" defaultValue={v("otherCredits")} className="h-8 text-xs" />
          {errs("otherCredits")?.map((e) => (
            <p key={e} className="text-xs text-red-600">{e}</p>
          ))}
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="otherCreditsDescription" className="text-xs">
            Other credits — specify
          </Label>
          <Input
            id="otherCreditsDescription"
            name="otherCreditsDescription"
            defaultValue={v("otherCreditsDescription")}
            className="h-8 text-xs"
          />
        </div>
      </div>
      <div>
        <Button type="submit" size="sm" variant="secondary" disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
        {state.saved && <span className="ml-2 text-xs text-emerald-700">Saved.</span>}
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
