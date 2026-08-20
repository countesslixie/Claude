"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { ClientTaxYearFormState } from "@/lib/actions/clientTaxYears";

const REGIMES = [
  { value: "RATE_8_PERCENT", label: "8% flat rate" },
  { value: "GRADUATED_OSD", label: "Graduated, OSD" },
  { value: "GRADUATED_ITEMIZED", label: "Graduated, itemized" },
];

const ELECTION_STATUSES = [
  { value: "NOT_YET_ELECTED", label: "Not yet elected" },
  { value: "ELECTED", label: "Elected" },
  { value: "DEFAULTED_GRADUATED", label: "Defaulted to graduated" },
];

const YEAR_END_ELECTIONS = [
  { value: "NA", label: "N/A" },
  { value: "REFUND", label: "Refund" },
  { value: "TCC", label: "Tax Credit Certificate" },
  { value: "CARRY_OVER", label: "Carry over" },
];

export function ClientTaxYearForm({
  action,
  initialValues,
  submitLabel,
}: {
  action: (state: ClientTaxYearFormState, formData: FormData) => Promise<ClientTaxYearFormState>;
  initialValues?: Record<string, string>;
  submitLabel: string;
}) {
  const [state, formAction, isPending] = useActionState<ClientTaxYearFormState, FormData>(
    action,
    { values: initialValues },
  );

  const v = (key: string) => state.values?.[key] ?? initialValues?.[key] ?? "";
  const errs = (key: string) => state.fieldErrors?.[key];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="taxableYear">
            Taxable year<span className="text-red-500"> *</span>
          </Label>
          <Input
            id="taxableYear"
            name="taxableYear"
            type="number"
            defaultValue={v("taxableYear")}
            required
          />
          {errs("taxableYear")?.map((e) => (
            <p key={e} className="text-xs text-red-600">{e}</p>
          ))}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="regime">
            Regime<span className="text-red-500"> *</span>
          </Label>
          <Select id="regime" name="regime" defaultValue={v("regime") || "RATE_8_PERCENT"} required>
            {REGIMES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="electionStatus">
            Election status<span className="text-red-500"> *</span>
          </Label>
          <Select
            id="electionStatus"
            name="electionStatus"
            defaultValue={v("electionStatus") || "NOT_YET_ELECTED"}
            required
          >
            {ELECTION_STATUSES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="priorYearExcessCredit">Prior-year excess credit (₱)</Label>
          <Input
            id="priorYearExcessCredit"
            name="priorYearExcessCredit"
            defaultValue={v("priorYearExcessCredit") || "0"}
          />
          {errs("priorYearExcessCredit")?.map((e) => (
            <p key={e} className="text-xs text-red-600">{e}</p>
          ))}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="yearEndCreditElection">Year-end credit election</Label>
          <Select
            id="yearEndCreditElection"
            name="yearEndCreditElection"
            defaultValue={v("yearEndCreditElection") || "NA"}
          >
            {YEAR_END_ELECTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
