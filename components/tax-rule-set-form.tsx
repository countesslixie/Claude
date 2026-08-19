"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { TaxRuleSetFormState } from "@/lib/actions/taxRuleSets";

type FieldProps = {
  name: string;
  label: string;
  defaultValue?: string;
  errors?: string[];
  required?: boolean;
  type?: string;
  placeholder?: string;
  hint?: string;
};

function Field({ name, label, defaultValue, errors, required, type = "text", placeholder, hint }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={name}>
        {label}
        {required && <span className="text-red-500"> *</span>}
      </Label>
      <Input id={name} name={name} type={type} defaultValue={defaultValue} required={required} placeholder={placeholder} />
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
      {errors?.map((e) => (
        <p key={e} className="text-xs text-red-600">
          {e}
        </p>
      ))}
    </div>
  );
}

export function TaxRuleSetForm({
  action,
  initialValues,
  submitLabel,
}: {
  action: (state: TaxRuleSetFormState, formData: FormData) => Promise<TaxRuleSetFormState>;
  initialValues?: Record<string, string>;
  submitLabel: string;
}) {
  const [state, formAction, isPending] = useActionState<TaxRuleSetFormState, FormData>(action, {
    values: initialValues,
  });

  const v = (key: string) => state.values?.[key] ?? initialValues?.[key] ?? "";
  const errs = (key: string) => state.fieldErrors?.[key];

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <legend className="col-span-full text-sm font-semibold text-slate-900">
          Effectivity
        </legend>
        <Field name="taxableYear" label="Taxable year" type="number" defaultValue={v("taxableYear")} errors={errs("taxableYear")} required />
        <div />
        <Field name="effectiveFrom" label="Effective from" type="date" defaultValue={v("effectiveFrom")} errors={errs("effectiveFrom")} required />
        <Field name="effectiveTo" label="Effective to (optional)" type="date" defaultValue={v("effectiveTo")} errors={errs("effectiveTo")} />
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <legend className="col-span-full text-sm font-semibold text-slate-900">
          Computation constants (SPEC.md 3.2)
        </legend>
        <Field
          name="incomeTaxRateBps"
          label="Income tax rate (bps, 800 = 8.00%)"
          type="number"
          defaultValue={v("incomeTaxRateBps") || "800"}
          errors={errs("incomeTaxRateBps")}
          required
        />
        <div />
        <Field
          name="vatThreshold"
          label="VAT threshold (₱)"
          defaultValue={v("vatThreshold") || "3,000,000.00"}
          errors={errs("vatThreshold")}
          required
        />
        <Field
          name="allowableDeduction"
          label="Allowable deduction (₱, purely self-employed)"
          defaultValue={v("allowableDeduction") || "250,000.00"}
          errors={errs("allowableDeduction")}
          required
        />
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <legend className="col-span-full text-sm font-semibold text-slate-900">
          Statutory due dates (SPEC.md 3.6 — confirm against current BIR issuance)
        </legend>
        <Field name="q1DueMonthDay" label="Q1 (1701Q) due" defaultValue={v("q1DueMonthDay") || "04-15"} errors={errs("q1DueMonthDay")} required hint="MM-DD" />
        <Field name="q2DueMonthDay" label="Q2 (1701Q) due" defaultValue={v("q2DueMonthDay") || "08-15"} errors={errs("q2DueMonthDay")} required hint="MM-DD" />
        <Field name="q3DueMonthDay" label="Q3 (1701Q) due" defaultValue={v("q3DueMonthDay") || "11-15"} errors={errs("q3DueMonthDay")} required hint="MM-DD" />
        <Field
          name="annualDueMonthDay"
          label="Annual due"
          defaultValue={v("annualDueMonthDay") || "04-15"}
          errors={errs("annualDueMonthDay")}
          required
          hint="MM-DD, of the FOLLOWING year"
        />
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <legend className="col-span-full text-sm font-semibold text-slate-900">
          SAWT / eAFS offsets
        </legend>
        <Field
          name="sawtDeadlineOffsetDays"
          label="SAWT deadline offset (days from return due date)"
          type="number"
          defaultValue={v("sawtDeadlineOffsetDays") || "0"}
          errors={errs("sawtDeadlineOffsetDays")}
          required
        />
        <Field
          name="eafsDeadlineOffsetDays"
          label="eAFS deadline offset (days from date of filing)"
          type="number"
          defaultValue={v("eafsDeadlineOffsetDays") || "15"}
          errors={errs("eafsDeadlineOffsetDays")}
          required
        />
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <legend className="col-span-full text-sm font-semibold text-slate-900">
          Late filing exposure — informational only (SPEC.md 3.7)
        </legend>
        <Field
          name="surchargeRateBps"
          label="Surcharge rate (bps, optional)"
          type="number"
          defaultValue={v("surchargeRateBps")}
          errors={errs("surchargeRateBps")}
        />
        <Field
          name="interestRateBpsPerAnnum"
          label="Interest rate per annum (bps, optional)"
          type="number"
          defaultValue={v("interestRateBpsPerAnnum")}
          errors={errs("interestRateBpsPerAnnum")}
        />
      </fieldset>

      <div className="flex flex-col gap-1">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" defaultValue={v("notes")} rows={3} />
      </div>

      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
