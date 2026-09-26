"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import type { AtcCodeFormState } from "@/lib/actions/atcCodes";

/**
 * Brief #5a — add/edit form for one ATC code. verifiedAgainstIssuance is
 * shown plainly, not tucked away, per D19: an unverified code must never
 * look authoritative. isActive is how a code is "deactivated" — there is
 * no delete.
 */
export function AtcCodeForm({
  action,
  initialValues,
  submitLabel,
}: {
  action: (state: AtcCodeFormState, formData: FormData) => Promise<AtcCodeFormState>;
  /** verifiedAgainstIssuance/isActive as "on" or "" (or omitted), same shape a submit echoes back. */
  initialValues?: Record<string, string>;
  submitLabel: string;
}) {
  const [state, formAction, isPending] = useActionState<AtcCodeFormState, FormData>(action, {
    values: initialValues,
  });

  const v = (key: string) => state.values?.[key] ?? initialValues?.[key] ?? "";
  const errs = (key: string) => state.fieldErrors?.[key];
  const checked = (key: "verifiedAgainstIssuance" | "isActive", fallback: boolean) => {
    const raw = state.values?.[key] ?? initialValues?.[key];
    return raw === undefined ? fallback : raw === "on";
  };

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="code">
            Code <span className="text-red-500">*</span>
          </Label>
          <Input id="code" name="code" defaultValue={v("code")} required placeholder="e.g. WI010" />
          {errs("code")?.map((e) => (
            <p key={e} className="text-xs text-red-600">
              {e}
            </p>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ratePercent">
            Rate (%) <span className="text-red-500">*</span>
          </Label>
          <Input id="ratePercent" name="ratePercent" defaultValue={v("ratePercent")} required placeholder="e.g. 5 or 5.00" />
          {errs("ratePercent")?.map((e) => (
            <p key={e} className="text-xs text-red-600">
              {e}
            </p>
          ))}
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="description">
            Description <span className="text-red-500">*</span>
          </Label>
          <Textarea id="description" name="description" rows={2} defaultValue={v("description")} required />
          {errs("description")?.map((e) => (
            <p key={e} className="text-xs text-red-600">
              {e}
            </p>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="payeeType">Payee type</Label>
          <Input id="payeeType" name="payeeType" defaultValue={v("payeeType")} placeholder="e.g. Individual, Corporate" />
        </div>
      </div>

      <label className="flex items-center gap-1.5 text-sm text-slate-700">
        <Checkbox name="verifiedAgainstIssuance" defaultChecked={checked("verifiedAgainstIssuance", false)} />
        Verified against a BIR issuance
      </label>
      {!checked("verifiedAgainstIssuance", false) && (
        <p className="text-xs text-amber-700">
          Unverified — this code and rate have not been confirmed against the current BIR ATC list. It will
          still show as unverified wherever it&rsquo;s used (D19).
        </p>
      )}

      <label className="flex items-center gap-1.5 text-sm text-slate-700">
        <Checkbox name="isActive" defaultChecked={checked("isActive", true)} />
        Active — offered on the certificate picker
      </label>

      <div className="flex flex-col gap-1">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={2} defaultValue={v("notes")} />
      </div>

      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
