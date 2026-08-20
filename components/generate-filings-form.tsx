"use client";

import { useActionState } from "react";
import { generateFilingsAction, type GenerateFilingsResult } from "@/lib/actions/filings";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

async function runGenerate(
  clientId: string,
  _prev: GenerateFilingsResult | null,
  formData: FormData,
): Promise<GenerateFilingsResult> {
  const year = Number(formData.get("taxableYear"));
  return generateFilingsAction(clientId, year);
}

/**
 * Triggers generateFilingsForClientYear (Phase 3) — creates a Filing +
 * 16-step checklist for every period in the given taxable year (Q1, Q2,
 * Q3, ANNUAL; never Q4). Safe to click again for the same year: existing
 * periods are reported as skipped, not duplicated.
 */
export function GenerateFilingsForm({ clientId, defaultYear }: { clientId: string; defaultYear: number }) {
  const [state, formAction, isPending] = useActionState(runGenerate.bind(null, clientId), null);

  return (
    <form action={formAction} className="flex items-end gap-2">
      <div>
        <label className="text-xs font-medium uppercase tracking-wide text-slate-400" htmlFor="taxableYear">
          Generate filings for year
        </label>
        <Input id="taxableYear" name="taxableYear" type="number" defaultValue={defaultYear} className="w-28" />
      </div>
      <Button type="submit" size="sm" variant="secondary" disabled={isPending}>
        {isPending ? "Generating…" : "Generate"}
      </Button>
      {state && (
        <p className={`text-xs ${state.ok ? "text-slate-500" : "text-red-600"}`}>
          {state.ok
            ? `Created ${state.createdCount} filing(s), skipped ${state.skippedCount} (already existed).`
            : state.error}
        </p>
      )}
    </form>
  );
}
