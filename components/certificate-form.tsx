"use client";

import { useActionState, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PayorNameField } from "@/components/payor-name-field";
import { PayorDetailsDialog } from "@/components/payor-details-dialog";
import { AtcCodeSelect, type SelectableAtcCode } from "@/components/atc-code-select";
import type { CertificateFormState } from "@/lib/actions/form2307";
import type { SavedPayor } from "@/lib/actions/payors";
import { bpsToPercentLabel } from "@/lib/money";

/**
 * Brief #5a — step 2's "Add certificate" form. Everything that used to
 * sit behind a "more fields" disclosure is now required and in the main
 * form (payor TIN/address, ATC code), so the disclosure is gone
 * entirely. The scan is part of this same save, not a separate action
 * afterward (D35 is now satisfied by construction). Picking a saved
 * payor fills TIN/address/ATC (and therefore the rate); picking an ATC
 * code fills the rate from it — both stay editable, and typing a
 * different rate is kept as an override rather than silently replaced.
 */
export function CertificateForm({
  action,
  payors,
  atcCodes,
  defaultPeriodFrom,
  defaultPeriodTo,
  onSaveNewPayor,
  onFillPayorDetail,
  onSaved,
  onCancel,
}: {
  action: (state: CertificateFormState, formData: FormData) => Promise<CertificateFormState>;
  payors: SavedPayor[];
  atcCodes: SelectableAtcCode[];
  defaultPeriodFrom: string;
  defaultPeriodTo: string;
  onSaveNewPayor: (data: {
    name: string;
    tin?: string;
    address?: string;
    usualAtcCode?: string;
  }) => Promise<{ ok: true; payor: SavedPayor } | { ok: false; error: string }>;
  /** Brief #5b — fills one blank detail on an existing saved payor. Never overwrites a value it already has. */
  onFillPayorDetail: (
    payorId: string,
    field: "tin" | "address" | "usualAtcCode",
    value: string,
  ) => Promise<{ ok: true; payor: SavedPayor } | { ok: false; error: string }>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [state, formAction, isPending] = useActionState<CertificateFormState, FormData>(action, {});

  const [localPayors, setLocalPayors] = useState(payors);
  const [payorName, setPayorName] = useState("");
  const [payorTin, setPayorTin] = useState("");
  const [payorAddress, setPayorAddress] = useState("");
  const [atcCode, setAtcCode] = useState("");
  const [ratePercent, setRatePercent] = useState("");
  // Brief #5b — "Save … to payors" opens the shared dialog; null = closed.
  const [dialogName, setDialogName] = useState<string | null>(null);
  // Brief #5b — per-field "Not now" on the fill-back offer, keyed by the
  // value that was dismissed (so re-typing something new re-offers it).
  const [dismissedFillBack, setDismissedFillBack] = useState<Record<string, string>>({});
  const [fillBackSaving, setFillBackSaving] = useState<string | null>(null);

  const matchedPayor = payorName.trim()
    ? localPayors.find((p) => p.name.toLowerCase() === payorName.trim().toLowerCase())
    : undefined;

  // Re-sync the controlled fields from the server's echoed values after a
  // rejected save, same convention as QuarterlySalesCard, so a validation
  // error doesn't lose what she typed. Guarded on state.values so this
  // never fires on first mount (initial state has none).
  useEffect(() => {
    if (!state.values) return;
    setPayorName(state.values.payorName ?? "");
    setPayorTin(state.values.payorTin ?? "");
    setPayorAddress(state.values.payorAddress ?? "");
    setAtcCode(state.values.atcCode ?? "");
    setRatePercent(state.values.withholdingRatePercent ?? "");
  }, [state.values]);

  useEffect(() => {
    if (state.saved) onSaved();
  }, [state.saved, onSaved]);

  function rateFromCode(code: string): string {
    const found = atcCodes.find((c) => c.code === code);
    return found ? bpsToPercentLabel(found.rateBps).replace("%", "") : "";
  }

  function handleSelectSavedPayor(p: SavedPayor) {
    if (p.tin) setPayorTin(p.tin);
    if (p.address) setPayorAddress(p.address);
    if (p.usualAtcCode) {
      setAtcCode(p.usualAtcCode);
      setRatePercent(rateFromCode(p.usualAtcCode));
    }
  }

  function handleAtcChange(code: string) {
    setAtcCode(code);
    setRatePercent(rateFromCode(code));
  }

  async function handleDialogSave(draft: {
    name: string;
    tin?: string;
    address?: string;
    usualAtcCode?: string;
  }): Promise<{ ok: true; payor: SavedPayor } | { ok: false; error: string }> {
    const result = await onSaveNewPayor(draft);
    if (result.ok) setLocalPayors((prev) => [...prev, result.payor]);
    return result;
  }

  /**
   * Brief #5b — "filling in blanks later": once this field's name matches
   * a saved payor, typing a value here that the payor doesn't have yet
   * offers to save it back. A payor that already has a (possibly
   * different) value for this field never gets this offer — that
   * disagreement stays on the certificate only (#5a's rule).
   */
  async function handleFillBack(field: "tin" | "address" | "usualAtcCode", value: string) {
    if (!matchedPayor) return;
    setFillBackSaving(field);
    const result = await onFillPayorDetail(matchedPayor.id, field, value);
    setFillBackSaving(null);
    if (result.ok) {
      setLocalPayors((prev) => prev.map((p) => (p.id === result.payor.id ? result.payor : p)));
    }
  }

  function fillBackOffer(field: "tin" | "address" | "usualAtcCode", label: string, value: string) {
    const trimmedValue = value.trim();
    if (!matchedPayor || matchedPayor[field] || !trimmedValue) return null;
    if (dismissedFillBack[field] === trimmedValue) return null;
    return (
      <p className="text-xs text-slate-500">
        {`Save this as ${matchedPayor.name}'s ${label} too?`}{" "}
        <button
          type="button"
          onClick={() => handleFillBack(field, trimmedValue)}
          disabled={fillBackSaving === field}
          className="text-slate-700 underline hover:text-slate-900"
        >
          {fillBackSaving === field ? "Saving…" : "Save"}
        </button>{" "}
        <button
          type="button"
          onClick={() => setDismissedFillBack((prev) => ({ ...prev, [field]: trimmedValue }))}
          className="text-slate-400 underline"
        >
          Not now
        </button>
      </p>
    );
  }

  const errs = (key: string) => state.fieldErrors?.[key];

  return (
    <>
    <form action={formAction} className="mt-1 flex flex-col gap-2 rounded border border-slate-200 p-2">
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-0.5 col-span-2">
          <Label htmlFor="cert-payorName">Payor name</Label>
          <PayorNameField
            id="cert-payorName"
            name="payorName"
            value={payorName}
            onChange={setPayorName}
            payors={localPayors}
            onSelectSaved={handleSelectSavedPayor}
            onRequestSave={setDialogName}
            required
          />
          {errs("payorName")?.map((e) => (
            <p key={e} className="text-xs text-red-600">
              {e}
            </p>
          ))}
        </div>
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="cert-payorTin">Payor TIN</Label>
          <Input
            id="cert-payorTin"
            name="payorTin"
            value={payorTin}
            onChange={(e) => setPayorTin(e.target.value)}
            required
          />
          {errs("payorTin")?.map((e) => (
            <p key={e} className="text-xs text-red-600">
              {e}
            </p>
          ))}
          {fillBackOffer("tin", "TIN", payorTin)}
        </div>
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="cert-payorAddress">Payor address</Label>
          <Input
            id="cert-payorAddress"
            name="payorAddress"
            value={payorAddress}
            onChange={(e) => setPayorAddress(e.target.value)}
            required
          />
          {errs("payorAddress")?.map((e) => (
            <p key={e} className="text-xs text-red-600">
              {e}
            </p>
          ))}
          {fillBackOffer("address", "address", payorAddress)}
        </div>
        <div className="flex flex-col gap-0.5 col-span-2">
          <Label htmlFor="cert-atcCode">ATC code</Label>
          <AtcCodeSelect id="cert-atcCode" name="atcCode" atcCodes={atcCodes} value={atcCode} onChange={handleAtcChange} required />
          {errs("atcCode")?.map((e) => (
            <p key={e} className="text-xs text-red-600">
              {e}
            </p>
          ))}
          {fillBackOffer("usualAtcCode", "usual ATC code", atcCode)}
        </div>
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="cert-withholdingRatePercent">Rate (%)</Label>
          <Input
            id="cert-withholdingRatePercent"
            name="withholdingRatePercent"
            placeholder="e.g. 5 or 5.00"
            value={ratePercent}
            onChange={(e) => setRatePercent(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="cert-incomePayment">Income amount (₱)</Label>
          <Input id="cert-incomePayment" name="incomePayment" defaultValue={state.values?.incomePayment} required />
          {errs("incomePayment")?.map((e) => (
            <p key={e} className="text-xs text-red-600">
              {e}
            </p>
          ))}
        </div>
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="cert-taxWithheld">Tax withheld (₱)</Label>
          <Input id="cert-taxWithheld" name="taxWithheld" defaultValue={state.values?.taxWithheld} required />
          {errs("taxWithheld")?.map((e) => (
            <p key={e} className="text-xs text-red-600">
              {e}
            </p>
          ))}
        </div>
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="cert-periodFrom">Period covered — from</Label>
          <Input
            id="cert-periodFrom"
            name="periodFrom"
            type="date"
            defaultValue={state.values?.periodFrom ?? defaultPeriodFrom}
            required
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="cert-periodTo">Period covered — to</Label>
          <Input
            id="cert-periodTo"
            name="periodTo"
            type="date"
            defaultValue={state.values?.periodTo ?? defaultPeriodTo}
            required
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="cert-file">Scan</Label>
          <Input id="cert-file" name="file" type="file" required className="h-9 text-xs" />
          {errs("file")?.map((e) => (
            <p key={e} className="text-xs text-red-600">
              {e}
            </p>
          ))}
        </div>
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="cert-documentDate">Scan date</Label>
          <Input
            id="cert-documentDate"
            name="documentDate"
            type="date"
            defaultValue={new Date().toISOString().split("T")[0]}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save certificate"}
        </Button>
        <button type="button" onClick={onCancel} className="text-xs text-slate-400 underline">
          Cancel
        </button>
      </div>
    </form>
    <PayorDetailsDialog
      open={dialogName !== null}
      initialName={dialogName ?? ""}
      atcCodes={atcCodes}
      onSave={handleDialogSave}
      onClose={() => setDialogName(null)}
    />
    </>
  );
}
