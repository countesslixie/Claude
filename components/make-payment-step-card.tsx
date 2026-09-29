"use client";

import { useActionState, useEffect, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { centsToPesos, pesosToCents } from "@/lib/money";
import { formatManilaDate } from "@/lib/dates";
import type { SavePaymentFormState } from "@/lib/actions/filings";

/**
 * D75 (brief #5m §3.1/§3.2, her decisions) — step 8 (MAKE_PAYMENT). Locked
 * ("Available once File is done.") until File (steps 5, 6, 7) is Done —
 * no controls at all before then, the same shape FileGroupDocStepCard
 * uses while locked. Once unlocked: three required fields (amount paid,
 * date of payment, paid through) and a Mark done button that validates
 * and saves in one action (lib/actions/filings.ts's savePayment, which
 * calls markStepDone itself). No Start, no Skip (D75) — Mark done is the
 * only control, so this card never renders one.
 *
 * Once Done, collapses to "Paid ₱X on [date] through [bank]" with an Edit
 * button (Save/Cancel, the same D40/D55 pattern OtherCreditsForm uses) —
 * gone once `locked` (the next filing of the same taxable year has
 * already filed with this figure baked into its own item 56/58).
 */
export function MakePaymentStepCard({
  stepId,
  sequence,
  title,
  status,
  isUnlocked,
  locked,
  action,
  defaultAmountCents,
  savedAmountCents,
  savedPaymentDate,
  savedPaymentChannel,
  previousChannels,
}: {
  stepId: string;
  sequence: number;
  title: string;
  status: string;
  /** Whether File (steps 5, 6, 7) is Done — this card is locked until then. */
  isUnlocked: boolean;
  /** Whether this filing's payment is locked from further edits — the NEXT filing of the year has already filed. */
  locked: boolean;
  action: (state: SavePaymentFormState, formData: FormData) => Promise<SavePaymentFormState>;
  /** This return's own computed tax payable — the amount field's default. 0 when there's nothing to pay (this card isn't shown then — see the NA case). */
  defaultAmountCents: number;
  savedAmountCents: number | null;
  /** "YYYY-MM-DD", or "" if never saved. */
  savedPaymentDate: string;
  savedPaymentChannel: string | null;
  previousChannels: string[];
}) {
  const isDone = status === "DONE";
  const initialValues = {
    amountPaid: savedAmountCents != null ? centsToPesos(savedAmountCents) : centsToPesos(defaultAmountCents),
    paymentDate: savedPaymentDate || new Date().toISOString().split("T")[0],
    paymentChannel: savedPaymentChannel ?? "",
  };
  const [state, formAction, isPending] = useActionState<SavePaymentFormState, FormData>(action, { values: initialValues });
  const [editing, setEditing] = useState(!isDone);
  const [savedValues, setSavedValues] = useState(initialValues);
  const [formKey, setFormKey] = useState(0);
  const [liveAmount, setLiveAmount] = useState(initialValues.amountPaid);

  useEffect(() => {
    if (!state.saved || !state.values) return;
    setSavedValues(state.values as typeof initialValues);
    setEditing(false);
  }, [state]);

  const v = (key: keyof typeof initialValues) => (state.values?.[key] ?? initialValues[key]) as string;
  const errs = (key: string) => state.fieldErrors?.[key];

  function handleCancel() {
    setEditing(false);
    setFormKey((k) => k + 1);
    setLiveAmount(savedValues.amountPaid);
  }

  const differsFromPayable = (() => {
    try {
      return pesosToCents(liveAmount) !== defaultAmountCents;
    } catch {
      return false;
    }
  })();

  // D76 — an NA'd step (this filing has nothing to pay) sits behind the
  // "Show N not applicable" toggle like any other NA step — just its
  // pill, never a locked message or a form.
  const isNA = status === "NA";
  const showForm = !isNA && isUnlocked && !locked && (editing || !isDone);

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-ink">
          {sequence}. {title}
        </p>
        <StatusBadge tone={isDone ? "done" : "pending"}>{isNA ? "Not applicable" : isDone ? "Done" : "Pending"}</StatusBadge>
      </div>

      {!isNA && !isUnlocked && <p className="mt-1 text-xs text-faint">Available once File is done.</p>}

      {isUnlocked && !showForm && isDone && (
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="text-sm text-ink-secondary">
            Paid {centsToPesos(pesosToCents(savedValues.amountPaid), { withSymbol: true })} on{" "}
            {savedValues.paymentDate ? formatManilaDate(new Date(`${savedValues.paymentDate}T00:00:00.000Z`)) : "—"} through{" "}
            {savedValues.paymentChannel || "—"}
          </p>
          {!locked && (
            <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>
      )}

      {isUnlocked && showForm && (
        <form key={formKey} action={formAction} className="mt-2 flex flex-col gap-2">
          {state.error && <p className="text-xs text-red">{state.error}</p>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`amountPaid-${stepId}`} className="text-xs">
                Amount paid (₱)
              </Label>
              <Input
                id={`amountPaid-${stepId}`}
                name="amountPaid"
                defaultValue={v("amountPaid")}
                onChange={(e) => setLiveAmount(e.target.value)}
                className="h-8 text-xs"
              />
              {errs("amountPaid")?.map((e) => (
                <p key={e} className="text-xs text-red">{e}</p>
              ))}
              {differsFromPayable && (
                <p className="text-xs text-faint">Differs from tax payable {centsToPesos(defaultAmountCents, { withSymbol: true })}</p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`paymentDate-${stepId}`} className="text-xs">
                Date of payment
              </Label>
              <Input id={`paymentDate-${stepId}`} name="paymentDate" type="date" defaultValue={v("paymentDate")} className="h-8 text-xs" />
              {errs("paymentDate")?.map((e) => (
                <p key={e} className="text-xs text-red">{e}</p>
              ))}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`paymentChannel-${stepId}`} className="text-xs">
                Paid through
              </Label>
              <Input
                id={`paymentChannel-${stepId}`}
                name="paymentChannel"
                list={`paymentChannel-options-${stepId}`}
                defaultValue={v("paymentChannel")}
                className="h-8 text-xs"
              />
              <datalist id={`paymentChannel-options-${stepId}`}>
                {previousChannels.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              {errs("paymentChannel")?.map((e) => (
                <p key={e} className="text-xs text-red">{e}</p>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Saving…" : isDone ? "Save" : "Mark done"}
            </Button>
            {isDone && (
              <button type="button" onClick={handleCancel} className="text-xs text-faint underline">
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
