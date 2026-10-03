"use client";

import { useActionState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { createHoliday, type HolidayFormState } from "@/lib/actions/holidays";

export function HolidayForm({ onSaved, onCancel }: { onSaved?: () => void; onCancel?: () => void }) {
  const [state, formAction, isPending] = useActionState<HolidayFormState, FormData>(
    createHoliday,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);
  const scope = state.values?.scope ?? "NATIONAL";

  useEffect(() => {
    if (!state.error && !state.fieldErrors && formRef.current) {
      formRef.current.reset();
    }
    if (state.saved) onSaved?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const errs = (key: string) => state.fieldErrors?.[key];

  return (
    <form ref={formRef} action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-6 sm:items-end">
      <div className="flex flex-col gap-1">
        <Label htmlFor="date">Date *</Label>
        <Input id="date" name="date" type="date" defaultValue={state.values?.date} required />
        {errs("date")?.map((e) => (
          <p key={e} className="text-xs text-red">{e}</p>
        ))}
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <Label htmlFor="name">Name *</Label>
        <Input id="name" name="name" defaultValue={state.values?.name} required placeholder="e.g. Araw ng Kagitingan" />
        {errs("name")?.map((e) => (
          <p key={e} className="text-xs text-red">{e}</p>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="type">Type *</Label>
        <Select id="type" name="type" defaultValue={state.values?.type || "REGULAR"} required>
          <option value="REGULAR">Regular</option>
          <option value="SPECIAL_NON_WORKING">Special non-working</option>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="scope">Scope</Label>
        <Select id="scope" name="scope" defaultValue={scope}>
          <option value="NATIONAL">National</option>
          <option value="LOCAL">Local</option>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="localScope">Local area</Label>
        <Input id="localScope" name="localScope" defaultValue={state.values?.localScope} placeholder="e.g. Quezon City" />
        {errs("localScope")?.map((e) => (
          <p key={e} className="text-xs text-red">{e}</p>
        ))}
      </div>
      <div className="flex gap-2 sm:col-span-6">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
