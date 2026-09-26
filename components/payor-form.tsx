"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { AtcCodeSelect, type SelectableAtcCode } from "@/components/atc-code-select";
import type { PayorFormState } from "@/lib/actions/payors";

/**
 * Brief #5a — add/edit form for one saved payor entry ("Payors" on
 * screen since brief #5b). Shared
 * between the inline add form and the small per-entry edit screen
 * (submitLabel distinguishes them, same convention as TaxRuleSetForm).
 * isActive's checkbox is how an entry is deactivated — there is no
 * delete, matching the ATC code list's own convention.
 */
export function PayorForm({
  action,
  atcCodes,
  initialValues,
  submitLabel,
  resetOnSuccess,
}: {
  action: (state: PayorFormState, formData: FormData) => Promise<PayorFormState>;
  atcCodes: SelectableAtcCode[];
  initialValues?: Record<string, string>;
  submitLabel: string;
  /** True for the inline "add" form (clears back to blank after a successful save); false for the edit screen. */
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, isPending] = useActionState<PayorFormState, FormData>(action, {
    values: initialValues,
  });
  const formRef = useRef<HTMLFormElement>(null);
  const [usualAtcCode, setUsualAtcCode] = useState(initialValues?.usualAtcCode ?? "");

  useEffect(() => {
    if (resetOnSuccess && !state.error && !state.fieldErrors && formRef.current) {
      formRef.current.reset();
      setUsualAtcCode("");
    }
  }, [state, resetOnSuccess]);

  const v = (key: string) => state.values?.[key] ?? initialValues?.[key] ?? "";
  const errs = (key: string) => state.fieldErrors?.[key];
  const activeDefault = state.values ? state.values.isActive === "on" : (initialValues?.isActive ?? "on") === "on";

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      {state.error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="payor-name">
            Name <span className="text-red-500">*</span>
          </Label>
          <Input id="payor-name" name="name" defaultValue={v("name")} required />
          {errs("name")?.map((e) => (
            <p key={e} className="text-xs text-red-600">
              {e}
            </p>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="payor-tin">TIN</Label>
          <Input id="payor-tin" name="tin" defaultValue={v("tin")} />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="payor-address">Address</Label>
          <Input id="payor-address" name="address" defaultValue={v("address")} />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="payor-atc">Usual ATC code</Label>
          <AtcCodeSelect
            id="payor-atc"
            name="usualAtcCode"
            atcCodes={atcCodes}
            value={usualAtcCode}
            onChange={setUsualAtcCode}
          />
        </div>
      </div>

      <label className="flex items-center gap-1.5 text-sm text-slate-700">
        <Checkbox name="isActive" defaultChecked={activeDefault} />
        Active — offered on the picker
      </label>

      <div>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
