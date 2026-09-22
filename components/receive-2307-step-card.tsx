"use client";

import { useActionState, useState, useTransition } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { deleteCertificate, type CertificateFormState } from "@/lib/actions/form2307";
import { skipStep } from "@/lib/actions/workflowSteps";
import { uploadDocument } from "@/lib/actions/documents";
import { centsToPesos, bpsToPercentLabel } from "@/lib/money";

export interface CertificateRow {
  id: string;
  payorName: string;
  payorTin: string | null;
  payorAddress: string | null;
  incomePaymentCents: number;
  taxWithheldCents: number;
  atcCode: string;
  withholdingRateBps: number;
  periodFrom: string;
  periodTo: string;
  notes: string | null;
  scans: { id: string; originalFilename: string }[];
}

/**
 * Brief #4b (D27/D34) — step 2 (RECEIVE_2307) holds one row per
 * certificate, entered here rather than on a separate register screen.
 * It is DONE once "All certificates received" is ticked AND every row
 * has its own scan — the first blocking rule in Prepare, and it fits
 * D27 (a 2307 is a document she receives). Start/Mark waiting/Mark done
 * are gone; Skip (with a written reason) stays, for clients who never
 * issue 2307s or a quarter with none.
 *
 * Brief #4d — the checkbox and Skip are mutually exclusive on whether
 * any certificate row exists yet: no rows shows Add certificate + Skip
 * only (skipping makes no sense once certificates are entered); one or
 * more rows shows the checkbox and hides Skip. Removing the last row
 * (lib/actions/form2307.ts's deleteCertificate) goes back to the first
 * state and unticks the checkbox if it was ticked.
 */
export function Receive2307StepCard({
  stepId,
  sequence,
  title,
  status,
  skippedReason,
  certificates,
  allReceived,
  locked,
  addCertificateAction,
  toggleAllReceivedAction,
  defaultPeriodFrom,
  defaultPeriodTo,
}: {
  stepId: string;
  sequence: number;
  title: string;
  status: string;
  skippedReason: string | null;
  certificates: CertificateRow[];
  allReceived: boolean;
  locked: boolean;
  addCertificateAction: (state: CertificateFormState, formData: FormData) => Promise<CertificateFormState>;
  toggleAllReceivedAction: (received: boolean) => Promise<void>;
  /** Brief #4c — "Period covered" pre-fills with this filing's own quarter. */
  defaultPeriodFrom: string;
  defaultPeriodTo: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [skipReason, setSkipReason] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [openMore, setOpenMore] = useState<Set<string>>(new Set());
  const [openScanUpload, setOpenScanUpload] = useState<Set<string>>(new Set());
  const [addState, addFormAction, addPending] = useActionState<CertificateFormState, FormData>(
    addCertificateAction,
    {},
  );

  const isResolved = status === "DONE" || status === "SKIPPED";
  const allHaveScans = certificates.length > 0 && certificates.every((c) => c.scans.length > 0);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setMessage(result.error ?? "Could not update this step.");
    });
  }

  function toggleSet(set: Set<string>, setFn: (s: Set<string>) => void, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFn(next);
  }

  function handleScanUpload(certId: string, formData: FormData) {
    formData.set("workflowStepId", stepId);
    formData.set("docSlotCode", "form2307_scan");
    formData.set("form2307Id", certId);
    setMessage(null);
    startTransition(async () => {
      const result = await uploadDocument(formData);
      if (!result.ok) setMessage(result.error ?? "Upload failed.");
    });
  }

  function handleToggleAllReceived(checked: boolean) {
    run(async () => {
      await toggleAllReceivedAction(checked);
      return { ok: true };
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-900">
          {sequence}. {title}
        </p>
        <StatusBadge tone={status === "DONE" ? "done" : status === "SKIPPED" ? "pending" : "waiting"}>
          {status === "DONE" ? "Done" : status === "SKIPPED" ? "Skipped" : "Waiting on client"}
        </StatusBadge>
      </div>

      {status === "SKIPPED" && skippedReason && <p className="mt-1 text-xs text-slate-500">Skipped: {skippedReason}</p>}

      {status !== "SKIPPED" && (
        <>
          <div className="mt-2 flex flex-col gap-2">
            {certificates.length === 0 && <p className="text-xs text-slate-400">No certificates entered yet.</p>}
            {certificates.map((c) => (
              <div key={c.id} className="rounded border border-slate-200 bg-slate-50 p-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm text-slate-900">{c.payorName}</p>
                    <p className="text-xs text-slate-500">
                      {centsToPesos(c.incomePaymentCents, { withSymbol: true })} income ·{" "}
                      {centsToPesos(c.taxWithheldCents, { withSymbol: true })} withheld
                    </p>
                  </div>
                  {!locked && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => run(() => deleteCertificate(c.id, "Removed by bookkeeper."))}
                    >
                      Remove
                    </Button>
                  )}
                </div>

                {c.scans.length > 0 ? (
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {c.scans.map((d) => (
                      <li key={d.id} className="text-xs">
                        <a href={`/api/documents/${d.id}/download`} className="text-slate-700 underline hover:text-slate-900">
                          {d.originalFilename}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-amber-700">Scan required for this row.</p>
                )}
                {!locked && !openScanUpload.has(c.id) && (
                  <div className="mt-1 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggleSet(openScanUpload, setOpenScanUpload, c.id)}
                      className="text-xs text-slate-500 underline hover:text-slate-900"
                    >
                      {c.scans.length > 0 ? "Attach another" : "Attach scan"}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleSet(openMore, setOpenMore, c.id)}
                      className="text-xs text-slate-400 underline hover:text-slate-600"
                    >
                      {openMore.has(c.id) ? "Hide details" : "More"}
                    </button>
                  </div>
                )}
                {!locked && openScanUpload.has(c.id) && (
                  <>
                    <form action={(fd) => handleScanUpload(c.id, fd)} className="mt-1 flex items-center gap-1.5">
                      <Input type="file" name="file" required className="h-8 text-xs" />
                      <Input
                        type="date"
                        name="documentDate"
                        defaultValue={new Date().toISOString().split("T")[0]}
                        className="h-8 w-36 text-xs"
                      />
                      <Button type="submit" size="sm" variant="secondary" disabled={isPending}>
                        Upload
                      </Button>
                      <button
                        type="button"
                        onClick={() => toggleSet(openScanUpload, setOpenScanUpload, c.id)}
                        className="text-xs text-slate-400 underline hover:text-slate-600"
                      >
                        Cancel
                      </button>
                    </form>
                    <button
                      type="button"
                      onClick={() => toggleSet(openMore, setOpenMore, c.id)}
                      className="mt-1 text-xs text-slate-400 underline hover:text-slate-600"
                    >
                      {openMore.has(c.id) ? "Hide details" : "More"}
                    </button>
                  </>
                )}
                {locked && (
                  <button
                    type="button"
                    onClick={() => toggleSet(openMore, setOpenMore, c.id)}
                    className="mt-1 text-xs text-slate-400 underline hover:text-slate-600"
                  >
                    {openMore.has(c.id) ? "Hide details" : "More"}
                  </button>
                )}
                {openMore.has(c.id) && (
                  <dl className="mt-1 grid grid-cols-2 gap-1 text-xs text-slate-500">
                    <div>
                      <dt className="inline font-medium">TIN:</dt> {c.payorTin || "—"}
                    </div>
                    <div>
                      <dt className="inline font-medium">Address:</dt> {c.payorAddress || "—"}
                    </div>
                    <div>
                      <dt className="inline font-medium">ATC code:</dt> {c.atcCode || "— (unverified)"}
                    </div>
                    <div>
                      <dt className="inline font-medium">Rate:</dt> {bpsToPercentLabel(c.withholdingRateBps)}
                    </div>
                    <div className="col-span-2">
                      <dt className="inline font-medium">Period:</dt> {c.periodFrom} – {c.periodTo}
                    </div>
                    {c.notes && (
                      <div className="col-span-2">
                        <dt className="inline font-medium">Notes:</dt> {c.notes}
                      </div>
                    )}
                  </dl>
                )}
              </div>
            ))}
          </div>

          {!locked && (
            <div className="mt-2">
              {!showAddForm ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => setShowAddForm(true)}>
                  Add certificate
                </Button>
              ) : (
                <form action={addFormAction} className="mt-1 flex flex-col gap-2 rounded border border-slate-200 p-2">
                  {addState.error && <p className="text-xs text-red-600">{addState.error}</p>}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-0.5 col-span-2">
                      <Label htmlFor="cert-payorName">Payor name</Label>
                      <Input id="cert-payorName" name="payorName" defaultValue={addState.values?.payorName} required />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <Label htmlFor="cert-incomePayment">Income amount (₱)</Label>
                      <Input id="cert-incomePayment" name="incomePayment" defaultValue={addState.values?.incomePayment} required />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <Label htmlFor="cert-taxWithheld">Tax withheld (₱)</Label>
                      <Input id="cert-taxWithheld" name="taxWithheld" defaultValue={addState.values?.taxWithheld} required />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <Label htmlFor="cert-periodFrom">Period covered — from</Label>
                      <Input
                        id="cert-periodFrom"
                        name="periodFrom"
                        type="date"
                        defaultValue={addState.values?.periodFrom ?? defaultPeriodFrom}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <Label htmlFor="cert-periodTo">Period covered — to</Label>
                      <Input
                        id="cert-periodTo"
                        name="periodTo"
                        type="date"
                        defaultValue={addState.values?.periodTo ?? defaultPeriodTo}
                        required
                      />
                    </div>
                  </div>
                  {addState.fieldErrors && (
                    <ul className="flex flex-col gap-0.5">
                      {Object.entries(addState.fieldErrors).flatMap(([field, errs]) =>
                        (errs ?? []).map((e) => (
                          <li key={`${field}-${e}`} className="text-xs text-red-600">
                            {e}
                          </li>
                        )),
                      )}
                    </ul>
                  )}
                  <details>
                    <summary className="cursor-pointer text-xs text-slate-500">More fields</summary>
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-0.5">
                        <Label htmlFor="cert-payorTin">Payor TIN</Label>
                        <Input id="cert-payorTin" name="payorTin" defaultValue={addState.values?.payorTin} />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <Label htmlFor="cert-payorAddress">Payor address</Label>
                        <Input id="cert-payorAddress" name="payorAddress" defaultValue={addState.values?.payorAddress} />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <Label htmlFor="cert-atcCode">ATC code (unverified)</Label>
                        <Input id="cert-atcCode" name="atcCode" defaultValue={addState.values?.atcCode} />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <Label htmlFor="cert-withholdingRatePercent">Rate (%)</Label>
                        <Input
                          id="cert-withholdingRatePercent"
                          name="withholdingRatePercent"
                          placeholder="e.g. 5 or 5.00"
                          defaultValue={addState.values?.withholdingRatePercent}
                        />
                      </div>
                    </div>
                  </details>
                  <div className="flex items-center gap-2">
                    <Button type="submit" size="sm" disabled={addPending}>
                      {addPending ? "Saving…" : "Save certificate"}
                    </Button>
                    <button type="button" onClick={() => setShowAddForm(false)} className="text-xs text-slate-400 underline">
                      Cancel
                    </button>
                    {addState.saved && !addPending && <span className="text-xs text-emerald-600">Saved.</span>}
                  </div>
                </form>
              )}
            </div>
          )}

          {certificates.length > 0 && (
            <>
              <label className="mt-3 flex items-center gap-1.5 text-sm text-slate-700">
                <Checkbox
                  checked={allReceived}
                  disabled={isPending || locked}
                  onChange={(e) => handleToggleAllReceived(e.target.checked)}
                />
                All certificates received
              </label>
              {allReceived && !allHaveScans && (
                <p className="mt-1 text-xs text-amber-700">Every row needs its own scan before this step can be Done.</p>
              )}
            </>
          )}
        </>
      )}

      {/* Brief #4d — Skip only makes sense before any certificate is entered; once one exists, "All certificates received" replaces it. */}
      {!locked && !isResolved && certificates.length === 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Input
            placeholder="Skip reason"
            value={skipReason}
            onChange={(e) => setSkipReason(e.target.value)}
            className="h-8 w-40 text-xs"
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending || !skipReason.trim()}
            onClick={() => run(() => skipStep(stepId, skipReason))}
          >
            Skip
          </Button>
        </div>
      )}

      {message && <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{message}</p>}
    </div>
  );
}
