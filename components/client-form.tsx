"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import type { ClientFormState } from "@/lib/actions/clients";

const TAXPAYER_TYPES = [
  { value: "PURELY_SELF_EMPLOYED", label: "Purely self-employed" },
  { value: "MIXED_INCOME", label: "Mixed income" },
];

const BOOKS_TYPES = [
  { value: "MANUAL", label: "Manual" },
  { value: "LOOSE_LEAF", label: "Loose-leaf" },
  { value: "CAS", label: "CAS" },
];

const CIVIL_STATUSES = [
  { value: "", label: "—" },
  { value: "SINGLE", label: "Single" },
  { value: "MARRIED", label: "Married" },
  { value: "WIDOWED", label: "Widowed" },
  { value: "LEGALLY_SEPARATED", label: "Legally separated" },
  { value: "ANNULLED", label: "Annulled" },
];

const RECOGNITION_BASES = [
  { value: "COLLECTION", label: "Collection (cash received)" },
  { value: "BILLING", label: "Billing (accrual)" },
];

type FieldProps = {
  name: string;
  label: string;
  defaultValue?: string;
  errors?: string[];
  required?: boolean;
  type?: string;
  placeholder?: string;
};

function TextField({ name, label, defaultValue, errors, required, type = "text", placeholder }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={name}>
        {label}
        {required && <span className="text-red-500"> *</span>}
      </Label>
      <Input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        placeholder={placeholder}
      />
      {errors?.map((e) => (
        <p key={e} className="text-xs text-red-600">
          {e}
        </p>
      ))}
    </div>
  );
}

export function ClientForm({
  action,
  initialValues,
  submitLabel,
}: {
  action: (state: ClientFormState, formData: FormData) => Promise<ClientFormState>;
  initialValues?: Record<string, string>;
  submitLabel: string;
}) {
  const [state, formAction, isPending] = useActionState<ClientFormState, FormData>(action, {
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
          Registration
        </legend>
        <TextField
          name="code"
          label="Client code (used in file paths)"
          defaultValue={v("code")}
          errors={errs("code")}
          required
          placeholder="dela-cruz-j"
        />
        <TextField
          name="registeredName"
          label="Registered name"
          defaultValue={v("registeredName")}
          errors={errs("registeredName")}
          required
        />
        <TextField name="tradeName" label="Trade name" defaultValue={v("tradeName")} errors={errs("tradeName")} />
        <TextField
          name="tin"
          label="TIN (9 digits)"
          defaultValue={v("tin")}
          errors={errs("tin")}
          required
          placeholder="123456789"
        />
        <TextField
          name="branchCode"
          label="Branch code"
          defaultValue={v("branchCode") || "000"}
          errors={errs("branchCode")}
        />
        <TextField
          name="rdoCode"
          label="RDO code"
          defaultValue={v("rdoCode")}
          errors={errs("rdoCode")}
          required
        />
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="registeredAddress">
            Registered address<span className="text-red-500"> *</span>
          </Label>
          <Textarea
            id="registeredAddress"
            name="registeredAddress"
            defaultValue={v("registeredAddress")}
            required
            rows={2}
          />
          {errs("registeredAddress")?.map((e) => (
            <p key={e} className="text-xs text-red-600">{e}</p>
          ))}
        </div>
        <TextField name="email" label="Email" type="email" defaultValue={v("email")} errors={errs("email")} />
        <TextField name="mobile" label="Mobile" defaultValue={v("mobile")} errors={errs("mobile")} />
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <legend className="col-span-full text-sm font-semibold text-slate-900">
          Tax profile
        </legend>
        <div className="flex flex-col gap-1">
          <Label htmlFor="taxpayerType">
            Taxpayer type<span className="text-red-500"> *</span>
          </Label>
          <Select id="taxpayerType" name="taxpayerType" defaultValue={v("taxpayerType")} required>
            <option value="" disabled>
              Select…
            </option>
            {TAXPAYER_TYPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          {errs("taxpayerType")?.map((e) => (
            <p key={e} className="text-xs text-red-600">{e}</p>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="recognitionBasis">Revenue recognition basis</Label>
          <Select id="recognitionBasis" name="recognitionBasis" defaultValue={v("recognitionBasis") || "COLLECTION"}>
            {RECOGNITION_BASES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <TextField name="lineOfBusiness" label="Line of business" defaultValue={v("lineOfBusiness")} errors={errs("lineOfBusiness")} />
        <TextField name="psicCode" label="PSIC code" defaultValue={v("psicCode")} errors={errs("psicCode")} />
        <div className="flex flex-col gap-1">
          <Label htmlFor="civilStatus">Civil status</Label>
          <Select id="civilStatus" name="civilStatus" defaultValue={v("civilStatus")}>
            {CIVIL_STATUSES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <TextField
          name="defaultWithholdingRateBps"
          label="Default WHT rate (bps, e.g. 500 = 5%)"
          type="number"
          defaultValue={v("defaultWithholdingRateBps")}
          errors={errs("defaultWithholdingRateBps")}
        />
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <legend className="col-span-full text-sm font-semibold text-slate-900">
          Books & compliance
        </legend>
        <div className="flex flex-col gap-1">
          <Label htmlFor="booksType">
            Books type<span className="text-red-500"> *</span>
          </Label>
          <Select id="booksType" name="booksType" defaultValue={v("booksType")} required>
            <option value="" disabled>
              Select…
            </option>
            {BOOKS_TYPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          {errs("booksType")?.map((e) => (
            <p key={e} className="text-xs text-red-600">{e}</p>
          ))}
        </div>
        <TextField
          name="booksRegistrationDate"
          label="Books registration date"
          type="date"
          defaultValue={v("booksRegistrationDate")}
          errors={errs("booksRegistrationDate")}
        />
        <TextField
          name="booksPermitNumber"
          label="Books permit number"
          defaultValue={v("booksPermitNumber")}
          errors={errs("booksPermitNumber")}
        />
        <TextField
          name="swornDeclarationYear"
          label="Sworn declaration year"
          type="number"
          defaultValue={v("swornDeclarationYear")}
          errors={errs("swornDeclarationYear")}
        />
        <div className="flex items-center gap-2 pt-5">
          <Checkbox id="swornDeclarationOnFile" name="swornDeclarationOnFile" defaultChecked={v("swornDeclarationOnFile") === "on"} />
          <Label htmlFor="swornDeclarationOnFile">Sworn declaration on file</Label>
        </div>
        <TextField
          name="eBIRFormsEmail"
          label="eBIRForms email"
          type="email"
          defaultValue={v("eBIRFormsEmail")}
          errors={errs("eBIRFormsEmail")}
        />
        <div className="flex items-center gap-2 pt-5">
          <Checkbox id="eFPSEnrolled" name="eFPSEnrolled" defaultChecked={v("eFPSEnrolled") === "on"} />
          <Label htmlFor="eFPSEnrolled">eFPS enrolled</Label>
        </div>
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <legend className="col-span-full text-sm font-semibold text-slate-900">
          Status
        </legend>
        <TextField
          name="engagedSince"
          label="Engaged since"
          type="date"
          defaultValue={v("engagedSince")}
          errors={errs("engagedSince")}
        />
        <div className="flex items-center gap-2 pt-5">
          <Checkbox
            id="isActive"
            name="isActive"
            defaultChecked={initialValues ? v("isActive") === "on" : true}
          />
          <Label htmlFor="isActive">Active</Label>
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" name="notes" defaultValue={v("notes")} rows={3} />
        </div>
      </fieldset>

      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
