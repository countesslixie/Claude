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
        {required && <span className="text-red"> *</span>}
      </Label>
      <Input id={name} name={name} type={type} defaultValue={defaultValue} required={required} placeholder={placeholder} />
      {hint && <p className="text-xs text-faint">{hint}</p>}
      {errors?.map((e) => (
        <p key={e} className="text-xs text-red">
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
        <p className="rounded-md bg-red-tint px-3 py-2 text-sm text-red">{state.error}</p>
      )}

      <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <legend className="col-span-full text-sm font-semibold text-ink">
          Effectivity
        </legend>
        <Field name="taxableYear" label="Taxable year" type="number" defaultValue={v("taxableYear")} errors={errs("taxableYear")} required />
        <div />
        <Field name="effectiveFrom" label="Effective from" type="date" defaultValue={v("effectiveFrom")} errors={errs("effectiveFrom")} required />
        <Field name="effectiveTo" label="Effective to (optional)" type="date" defaultValue={v("effectiveTo")} errors={errs("effectiveTo")} />
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <legend className="col-span-full text-sm font-semibold text-ink">
          Computation constants
        </legend>
        <Field
          name="incomeTaxRatePercent"
          label="Income tax rate (%)"
          defaultValue={v("incomeTaxRatePercent") || "8.00"}
          errors={errs("incomeTaxRatePercent")}
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
        <legend className="col-span-full text-sm font-semibold text-ink">
          Statutory due dates (confirm against the current BIR issuance)
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
        <legend className="col-span-full text-sm font-semibold text-ink">
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
        <Field
          name="eSubmissionEmail"
          label="BIR eSubmission email address (used as the To address when you email the DAT file)"
          type="email"
          defaultValue={v("eSubmissionEmail") || "esubmission@bir.gov.ph"}
          errors={errs("eSubmissionEmail")}
          required
          hint="Confirm against BIR before live use"
        />
        <Field
          name="clientDocsDueDay"
          label="Client documents due — day of the month after each period ends"
          type="number"
          defaultValue={v("clientDocsDueDay") || "20"}
          errors={errs("clientDocsDueDay")}
          required
          hint="From the engagement letter (20 = Apr 20, Jul 20, Oct 20, Jan 20). Named in the client email and the filing page's working calendar"
        />
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <legend className="col-span-full text-sm font-semibold text-ink">
          Late filing exposure — informational only
        </legend>
        <Field
          name="surchargeRatePercent"
          label="Surcharge rate (%, optional)"
          defaultValue={v("surchargeRatePercent")}
          errors={errs("surchargeRatePercent")}
        />
        <Field
          name="interestRatePercentPerAnnum"
          label="Interest rate per year (%, optional)"
          defaultValue={v("interestRatePercentPerAnnum")}
          errors={errs("interestRatePercentPerAnnum")}
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
