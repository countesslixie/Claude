"use client";

import { useActionState, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { centsToPesos } from "@/lib/money";
import type { StartingFiguresFormState } from "@/lib/actions/startingFigures";

export type StartingFiguresValues = {
  latestOutsideReturn: "NONE" | "Q1" | "Q2" | "Q3";
  priorYearExcessCredit: string;
  cumulativeIncome: string;
  withholdingPreviousQuarters: string;
  withholdingThisQuarter: string;
  paymentsPreviousQuarters: string;
  amountPaidThisReturn: string;
  otherCredits: string;
  otherCreditsDescription: string;
  nonOperatingIncome: string;
};

const OUTSIDE_RETURN_OPTIONS = [
  { value: "NONE", label: "None — this client starts in the app from Q1" },
  { value: "Q1", label: "Q1" },
  { value: "Q2", label: "Q2" },
  { value: "Q3", label: "Q3 (the Annual is the first return done in the app)" },
];

/**
 * Brief #5f §8 — starting figures for a client joining mid-year. Save,
 * then read-only with an Edit button (with Cancel) — the same Edit/Cancel
 * shape as the income page (D40). Locked for good once the year's first
 * in-app return is filed: `locked` hides the Edit button entirely.
 */
export function StartingFiguresForm({
  action,
  locked,
  hasSavedRow,
  initialValues,
}: {
  action: (state: StartingFiguresFormState, formData: FormData) => Promise<StartingFiguresFormState>;
  locked: boolean;
  /** Whether a StartingFigures row already exists — false opens directly editable, no Edit toggle. */
  hasSavedRow: boolean;
  initialValues: StartingFiguresValues;
}) {
  const [state, formAction, isPending] = useActionState<StartingFiguresFormState, FormData>(action, {
    values: initialValues,
  });
  const [editing, setEditing] = useState(!hasSavedRow);
  const [savedValues, setSavedValues] = useState(initialValues);
  const [latestOutsideReturn, setLatestOutsideReturn] = useState(initialValues.latestOutsideReturn);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (!state.saved || !state.values) return;
    setSavedValues(state.values as unknown as StartingFiguresValues);
    setEditing(false);
  }, [state]);

  const v = (key: keyof StartingFiguresValues) => state.values?.[key] ?? initialValues[key] ?? "";
  const errs = (key: string) => state.fieldErrors?.[key];

  function handleCancel() {
    setLatestOutsideReturn(savedValues.latestOutsideReturn);
    setEditing(false);
    setFormKey((k) => k + 1);
  }

  const showForm = !locked && (editing || !hasSavedRow);
  const isNotNone = latestOutsideReturn !== "NONE";

  if (!showForm) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Starting figures</h2>
          {!locked && (
            <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>
        {locked && (
          <p className="mb-2 text-xs text-slate-400">
            Locked — this year&apos;s first in-app return has already been filed.
          </p>
        )}
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm text-slate-700 sm:grid-cols-2">
          <Row label="Latest return filed outside the app" value={savedValues.latestOutsideReturn} />
          <Row label="Prior year's excess credit (item 55)" value={pesosDisplay(savedValues.priorYearExcessCredit)} />
          {savedValues.latestOutsideReturn !== "NONE" && (
            <>
              <Row label="Cumulative income (item 51)" value={pesosDisplay(savedValues.cumulativeIncome)} />
              <Row label="Withholding, previous quarters (item 57)" value={pesosDisplay(savedValues.withholdingPreviousQuarters)} />
              <Row label="Withholding, that quarter (item 58)" value={pesosDisplay(savedValues.withholdingThisQuarter)} />
              <Row label="Payments, previous quarters (item 56)" value={pesosDisplay(savedValues.paymentsPreviousQuarters)} />
              <Row label="Amount paid for that return" value={pesosDisplay(savedValues.amountPaidThisReturn)} />
              <Row
                label="Other tax credits/payments (item 61)"
                value={`${pesosDisplay(savedValues.otherCredits)}${savedValues.otherCreditsDescription ? ` — ${savedValues.otherCreditsDescription}` : ""}`}
              />
              <Row label="Non-operating income so far this year" value={pesosDisplay(savedValues.nonOperatingIncome)} />
            </>
          )}
        </dl>
      </div>
    );
  }

  return (
    <form key={formKey} action={formAction} className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Starting figures</h2>
      {state.error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}

      <div className="flex flex-col gap-1">
        <Label htmlFor="latestOutsideReturn">Latest return filed outside the app</Label>
        <Select
          id="latestOutsideReturn"
          name="latestOutsideReturn"
          value={latestOutsideReturn}
          onChange={(e) => setLatestOutsideReturn(e.target.value as StartingFiguresValues["latestOutsideReturn"])}
        >
          {OUTSIDE_RETURN_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="priorYearExcessCredit">Prior year&apos;s excess credit — item 55 (₱)</Label>
        <Input id="priorYearExcessCredit" name="priorYearExcessCredit" defaultValue={v("priorYearExcessCredit")} className="w-48" />
        {errs("priorYearExcessCredit")?.map((e) => (
          <p key={e} className="text-xs text-red-600">{e}</p>
        ))}
      </div>

      {isNotNone && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="cumulativeIncome" label="Cumulative income — item 51 (₱)" defaultValue={v("cumulativeIncome")} errs={errs("cumulativeIncome")} />
          <Field
            id="withholdingPreviousQuarters"
            label="Withholding, previous quarters — item 57 (₱)"
            defaultValue={v("withholdingPreviousQuarters")}
            errs={errs("withholdingPreviousQuarters")}
          />
          <Field
            id="withholdingThisQuarter"
            label="Withholding, that quarter — item 58 (₱)"
            defaultValue={v("withholdingThisQuarter")}
            errs={errs("withholdingThisQuarter")}
          />
          <Field
            id="paymentsPreviousQuarters"
            label="Payments, previous quarters — item 56 (₱)"
            defaultValue={v("paymentsPreviousQuarters")}
            errs={errs("paymentsPreviousQuarters")}
          />
          <Field
            id="amountPaidThisReturn"
            label="Amount paid for that return (₱, 0 if overpayment)"
            defaultValue={v("amountPaidThisReturn")}
            errs={errs("amountPaidThisReturn")}
          />
          <Field id="otherCredits" label="Other tax credits/payments — item 61 (₱)" defaultValue={v("otherCredits")} errs={errs("otherCredits")} />
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="otherCreditsDescription">Other credits — specify</Label>
            <Input id="otherCreditsDescription" name="otherCreditsDescription" defaultValue={v("otherCreditsDescription")} />
            {errs("otherCreditsDescription")?.map((e) => (
              <p key={e} className="text-xs text-red-600">{e}</p>
            ))}
          </div>
          <Field
            id="nonOperatingIncome"
            label="Non-operating income so far this year (₱, optional)"
            defaultValue={v("nonOperatingIncome")}
            errs={errs("nonOperatingIncome")}
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
        {hasSavedRow && (
          <button type="button" onClick={handleCancel} className="text-xs text-slate-400 underline">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  defaultValue,
  errs,
}: {
  id: string;
  label: string;
  defaultValue: string;
  errs?: string[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} defaultValue={defaultValue} />
      {errs?.map((e) => (
        <p key={e} className="text-xs text-red-600">{e}</p>
      ))}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function pesosDisplay(pesosString: string): string {
  const normalized = pesosString.replace(/,/g, "").trim();
  const n = Number(normalized);
  return centsToPesos(Number.isFinite(n) ? Math.round(n * 100) : 0, { withSymbol: true });
}
