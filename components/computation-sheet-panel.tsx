"use client";

import { useEffect, useState } from "react";
import { centsToPesos } from "@/lib/money";
import type { BreakdownLine } from "@/lib/tax/types";

const SHOW_EXPLANATIONS_KEY = "computationSheet.showExplanations";

/**
 * §4.4 — the computation sheet's content is correct and unchanged; only
 * the presentation moves. Collapsed by default with a one-line summary
 * (§4.2's ordering: this is derived output, not the work). The
 * per-row explanatory sentences are teaching material shown on every
 * visit, so they're behind a "show explanations" toggle whose setting is
 * remembered (this is a per-browser display preference, not data — a
 * plain localStorage read/write is exactly what it's for).
 */
export function ComputationSheetPanel({
  breakdown,
  isOverpayment,
  overpaymentCents,
  taxPayableCents,
  formType,
  isFrozen,
}: {
  breakdown: BreakdownLine[];
  isOverpayment: boolean;
  overpaymentCents: number;
  taxPayableCents: number;
  formType: string;
  isFrozen: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [showExplanations, setShowExplanations] = useState(false);

  useEffect(() => {
    try {
      setShowExplanations(window.localStorage.getItem(SHOW_EXPLANATIONS_KEY) === "1");
    } catch {
      // localStorage unavailable (private window, blocked storage) — default stays off.
    }
  }, []);

  function toggleExplanations() {
    setShowExplanations((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SHOW_EXPLANATIONS_KEY, next ? "1" : "0");
      } catch {
        // best-effort only
      }
      return next;
    });
  }

  const summaryLabel = isOverpayment
    ? `Overpayment ${centsToPesos(overpaymentCents, { withSymbol: true })}`
    : `Tax payable ${centsToPesos(taxPayableCents, { withSymbol: true })}`;

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left"
      >
        <span className="text-sm font-semibold text-slate-900">
          Computation sheet {isFrozen ? "(frozen — as filed)" : "(live preview — not yet filed)"}
        </span>
        <span className="text-sm text-slate-600">
          {summaryLabel} <span className="ml-2 text-xs text-slate-400">{open ? "Hide" : "Show"}</span>
        </span>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-4 py-3">
          <label className="mb-2 flex items-center gap-1.5 text-xs text-slate-500">
            <input type="checkbox" checked={showExplanations} onChange={toggleExplanations} />
            Show explanations
          </label>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {breakdown.map((line) => (
                <tr key={line.label} className="border-b border-slate-100 last:border-0">
                  <td className="py-1 pr-2">{line.label}</td>
                  <td className="py-1 pr-2 text-right font-mono">
                    {centsToPesos(line.amountCents, { withSymbol: true })}
                  </td>
                  {showExplanations && <td className="py-1 text-xs text-slate-400">{line.sourceNote}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-400">
            Form {formType}. This is a preparation aid; the filed return and BIR&apos;s own assessment govern.
          </p>
        </div>
      )}
    </div>
  );
}
