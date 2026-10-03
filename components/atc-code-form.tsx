"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import type { AtcCodeFormState } from "@/lib/actions/atcCodes";

/**
 * Add/edit form for one ATC code. isActive is how a code is "deactivated" —
 * there is no delete. No payee type or verified field (D164/D165).
 */
export function AtcCodeForm({
  action,
  initialValues,
  submitLabel,
  cancelHref,
}: {
  action: (state: AtcCodeFormState, formData: FormData) => Promise<AtcCodeFormState>;
  /** isActive as "on" or "" (or omitted), same shape a submit echoes back. */
  initialValues?: Record<string, string>;
  submitLabel: string;
  /** Where Cancel goes — saves nothing. */
  cancelHref: string;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<AtcCodeFormState, FormData>(action, {
    values: initialValues,
  });

  const v = (key: string) => state.values?.[key] ?? initialValues?.[key] ?? "";
  const errs = (key: string) => state.fieldErrors?.[key];
  const checked = (key: "isActive", fallback: boolean) => {
    const raw = state.values?.[key] ?? initialValues?.[key];
    return raw === undefined ? fallback : raw === "on";
  };

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && <p className="rounded-md bg-red-tint px-3 py-2 text-sm text-red">{state.error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="code">
            Code <span className="text-red">*</span>
          </Label>
          <Input id="code" name="code" defaultValue={v("code")} required placeholder="e.g. WI010" />
          {errs("code")?.map((e) => (
            <p key={e} className="text-xs text-red">
              {e}
            </p>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ratePercent">
            Rate (%) <span className="text-red">*</span>
          </Label>
          <Input id="ratePercent" name="ratePercent" defaultValue={v("ratePercent")} required placeholder="e.g. 5 or 5.00" />
          {errs("ratePercent")?.map((e) => (
            <p key={e} className="text-xs text-red">
              {e}
            </p>
          ))}
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="description">
            Description <span className="text-red">*</span>
          </Label>
          <Textarea id="description" name="description" rows={2} defaultValue={v("description")} required />
          {errs("description")?.map((e) => (
            <p key={e} className="text-xs text-red">
              {e}
            </p>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-1.5 text-sm text-ink-secondary">
        <Checkbox name="isActive" defaultChecked={checked("isActive", true)} />
        Active
      </label>

      <div className="flex flex-col gap-1">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={2} defaultValue={v("notes")} />
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
