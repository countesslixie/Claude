"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import type { ClientFormState } from "@/lib/actions/clients";
import { suggestClientCode } from "@/lib/clients/suggestCode";

type FieldProps = {
  name: string;
  label: string;
  defaultValue?: string;
  errors?: string[];
  required?: boolean;
  type?: string;
  placeholder?: string;
  className?: string;
  /** Controlled mode (the Client code box on New client, D147). */
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

function TextField({ name, label, defaultValue, errors, required, type = "text", placeholder, className, value, onChange }: FieldProps) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <Label htmlFor={name}>
        {label}
        {required && <span className="text-red"> *</span>}
      </Label>
      <Input
        id={name}
        name={name}
        type={type}
        {...(value !== undefined ? { value } : { defaultValue })}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
      />
      {errors?.map((e) => (
        <p key={e} className="text-xs text-red">
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
  cancelHref,
  suggestCode = false,
}: {
  action: (state: ClientFormState, formData: FormData) => Promise<ClientFormState>;
  initialValues?: Record<string, string>;
  submitLabel: string;
  /** Where Cancel goes — saves nothing (D144). */
  cancelHref: string;
  /** New client only: fill the Client code in from the Registered name (D147). */
  suggestCode?: boolean;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<ClientFormState, FormData>(action, {
    values: initialValues,
  });

  // D147 — the code follows the name until she types in the code box herself.
  const [code, setCode] = useState(initialValues?.code ?? "");
  const [codeTyped, setCodeTyped] = useState(false);

  const v = (key: string) => state.values?.[key] ?? initialValues?.[key] ?? "";
  const errs = (key: string) => state.fieldErrors?.[key];

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.error && (
        <p className="rounded-md bg-red-tint px-3 py-2 text-sm text-red">{state.error}</p>
      )}

      <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-6">
        <legend className="col-span-full text-sm font-semibold text-ink">
          Registration
        </legend>
        <TextField
          name="tin"
          label="TIN (9 digits)"
          defaultValue={v("tin")}
          errors={errs("tin")}
          required
          placeholder="123456789"
          className="sm:col-span-2"
        />
        <TextField
          name="branchCode"
          label="Branch code"
          defaultValue={v("branchCode") || "000"}
          errors={errs("branchCode")}
          className="sm:col-span-2"
        />
        <TextField
          name="rdoCode"
          label="RDO code"
          defaultValue={v("rdoCode")}
          errors={errs("rdoCode")}
          required
          className="sm:col-span-2"
        />
        <TextField
          name="registeredName"
          label="Registered name"
          defaultValue={v("registeredName")}
          errors={errs("registeredName")}
          required
          className="sm:col-span-6"
          onChange={
            suggestCode
              ? (e) => {
                  if (!codeTyped) setCode(suggestClientCode(e.target.value));
                }
              : undefined
          }
        />
        <TextField
          name="tradeName"
          label="Trade name"
          defaultValue={v("tradeName")}
          errors={errs("tradeName")}
          className="sm:col-span-6"
        />
        <div className="flex flex-col gap-1 sm:col-span-6">
          <Label htmlFor="registeredAddress">
            Registered address<span className="text-red"> *</span>
          </Label>
          <Textarea
            id="registeredAddress"
            name="registeredAddress"
            defaultValue={v("registeredAddress")}
            required
            rows={2}
          />
          {errs("registeredAddress")?.map((e) => (
            <p key={e} className="text-xs text-red">{e}</p>
          ))}
        </div>
        <TextField
          name="birthDate"
          label="Birthday"
          type="date"
          defaultValue={v("birthDate")}
          errors={errs("birthDate")}
          required
          className="sm:col-span-3"
        />
        <TextField
          name="code"
          label="Client code"
          value={code}
          onChange={(e) => {
            setCodeTyped(true);
            setCode(e.target.value);
          }}
          errors={errs("code")}
          required
          placeholder="reyes-maria"
          className="sm:col-span-3"
        />
        <TextField
          name="email"
          label="Email"
          type="email"
          defaultValue={v("email")}
          errors={errs("email")}
          className="sm:col-span-3"
        />
        <TextField
          name="mobile"
          label="Mobile phone number"
          defaultValue={v("mobile")}
          errors={errs("mobile")}
          className="sm:col-span-3"
        />
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <legend className="col-span-full text-sm font-semibold text-ink">
          Tax profile
        </legend>
        <TextField name="lineOfBusiness" label="Line of business" defaultValue={v("lineOfBusiness")} errors={errs("lineOfBusiness")} />
        <TextField name="psicCode" label="PSIC code" defaultValue={v("psicCode")} errors={errs("psicCode")} />
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <legend className="col-span-full text-sm font-semibold text-ink">
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

      <div className="flex items-center gap-2">
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
