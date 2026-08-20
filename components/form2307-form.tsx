"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { Form2307FormState } from "@/lib/actions/form2307";

type FieldProps = {
  name: string;
  label: string;
  defaultValue?: string;
  errors?: string[];
  required?: boolean;
  type?: string;
  placeholder?: string;
};

function Field({ name, label, defaultValue, errors, required, type = "text", placeholder }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={name}>
        {label}
        {required && <span className="text-red-500"> *</span>}
      </Label>
      <Input id={name} name={name} type={type} defaultValue={defaultValue} required={required} placeholder={placeholder} />
      {errors?.map((e) => (
        <p key={e} className="text-xs text-red-600">
          {e}
        </p>
      ))}
    </div>
  );
}

export function Form2307Form({
  action,
  initialValues,
  submitLabel,
}: {
  action: (state: Form2307FormState, formData: FormData) => Promise<Form2307FormState>;
  initialValues?: Record<string, string>;
  submitLabel: string;
}) {
  const [state, formAction, isPending] = useActionState<Form2307FormState, FormData>(action, {
    values: initialValues,
  });

  const v = (key: string) => state.values?.[key] ?? initialValues?.[key] ?? "";
  const errs = (key: string) => state.fieldErrors?.[key];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field name="payorName" label="Payor name" defaultValue={v("payorName")} errors={errs("payorName")} required />
        <Field name="payorTin" label="Payor TIN" defaultValue={v("payorTin")} errors={errs("payorTin")} />
        <div className="sm:col-span-2">
          <Field name="payorAddress" label="Payor address" defaultValue={v("payorAddress")} errors={errs("payorAddress")} />
        </div>
        <Field name="periodFrom" label="Period from" type="date" defaultValue={v("periodFrom")} errors={errs("periodFrom")} required />
        <Field name="periodTo" label="Period to" type="date" defaultValue={v("periodTo")} errors={errs("periodTo")} required />
        <Field
          name="quarterCovered"
          label="Quarter covered (1-4)"
          type="number"
          defaultValue={v("quarterCovered") || "1"}
          errors={errs("quarterCovered")}
          required
        />
        <Field name="atcCode" label="ATC code" defaultValue={v("atcCode")} errors={errs("atcCode")} required placeholder="WI010" />
        <Field name="incomePayment" label="Income payment (₱)" defaultValue={v("incomePayment")} errors={errs("incomePayment")} required />
        <Field name="taxWithheld" label="Tax withheld (₱)" defaultValue={v("taxWithheld")} errors={errs("taxWithheld")} required />
        <Field
          name="withholdingRateBps"
          label="Withholding rate (bps, 500 = 5%)"
          type="number"
          defaultValue={v("withholdingRateBps") || "500"}
          errors={errs("withholdingRateBps")}
          required
        />
        <Field name="dateReceived" label="Date received" type="date" defaultValue={v("dateReceived")} errors={errs("dateReceived")} />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" defaultValue={v("notes")} rows={2} />
      </div>

      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
