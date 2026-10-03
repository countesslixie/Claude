"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { TaxRuleSetFormState } from "@/lib/actions/taxRuleSets";
import { effectiveFromAfterYearChange } from "@/lib/ruleSetDefaults";

type FieldProps = {
  name: string;
  label: string;
  defaultValue?: string;
  errors?: string[];
  required?: boolean;
  type?: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
};

function Field({ name, label, defaultValue, errors, required, type = "text", placeholder, value, onChange }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={name}>
        {label}
        {required && <span className="text-red"> *</span>}
      </Label>
      {onChange ? (
        <Input id={name} name={name} type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} required={required} placeholder={placeholder} />
      ) : (
        <Input id={name} name={name} type={type} defaultValue={defaultValue} required={required} placeholder={placeholder} />
      )}
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
  cancelHref,
}: {
  action: (state: TaxRuleSetFormState, formData: FormData) => Promise<TaxRuleSetFormState>;
  initialValues?: Record<string, string>;
  submitLabel: string;
  /** Where Cancel goes — saves nothing (D168). */
  cancelHref: string;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<TaxRuleSetFormState, FormData>(action, {
    values: initialValues,
  });

  // D168 — New: Effective from follows the year typed until she edits it herself.
  // Edit: the stored date is shown and never auto-changed.
  const [taxableYear, setTaxableYear] = useState(state.values?.taxableYear ?? initialValues?.taxableYear ?? "");
  const [effectiveFrom, setEffectiveFrom] = useState(state.values?.effectiveFrom ?? initialValues?.effectiveFrom ?? "");
  const [followsYear, setFollowsYear] = useState(!initialValues?.effectiveFrom);

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
        <Field
          name="taxableYear"
          label="Taxable year"
          type="number"
          value={taxableYear}
          onChange={(next) => {
            setTaxableYear(next);
            setEffectiveFrom((cur) => effectiveFromAfterYearChange({ yearText: next, current: cur, followsYear }));
          }}
          errors={errs("taxableYear")}
          required
        />
        <div />
        <Field
          name="effectiveFrom"
          label="Effective from"
          type="date"
          value={effectiveFrom}
          onChange={(next) => {
            setFollowsYear(false);
            setEffectiveFrom(next);
          }}
          errors={errs("effectiveFrom")}
          required
        />
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
        <Field name="q1DueMonthDay" label="Q1 (1701Q) due" defaultValue={v("q1DueMonthDay") || "04-15"} errors={errs("q1DueMonthDay")} required placeholder="05-15" />
        <Field name="q2DueMonthDay" label="Q2 (1701Q) due" defaultValue={v("q2DueMonthDay") || "08-15"} errors={errs("q2DueMonthDay")} required placeholder="08-15" />
        <Field name="q3DueMonthDay" label="Q3 (1701Q) due" defaultValue={v("q3DueMonthDay") || "11-15"} errors={errs("q3DueMonthDay")} required placeholder="11-15" />
        <Field
          name="annualDueMonthDay"
          label="Annual due (following year)"
          defaultValue={v("annualDueMonthDay") || "04-15"}
          errors={errs("annualDueMonthDay")}
          required
          placeholder="04-15"
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
        />
        <Field
          name="clientDocsDueDay"
          label="Client documents due — day of the month after each period ends"
          type="number"
          defaultValue={v("clientDocsDueDay") || "20"}
          errors={errs("clientDocsDueDay")}
          required
          placeholder="20"
        />
      </fieldset>

      <div className="flex flex-col gap-1">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" defaultValue={v("notes")} rows={3} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : submitLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push(cancelHref)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
