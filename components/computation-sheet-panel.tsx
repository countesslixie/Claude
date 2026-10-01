"use client";

import { useState } from "react";
import Link from "next/link";
import { centsToPesos, formatBreakdownAmount } from "@/lib/money";
import type { BreakdownLine } from "@/lib/tax/types";

/**
 * §4.4 — the computation sheet's content is correct and unchanged; only
 * the presentation moves. Collapsed by default with a one-line summary
 * (§4.2's ordering: this is derived output, not the work). D133 — the
 * per-row explanations are gone: form lines and figures only.
 */
export function ComputationSheetPanel({
  breakdown,
  isOverpayment,
  overpaymentCents,
  taxPayableCents,
  isFrozen,
  hasSalesRecorded,
  period,
  taxableYear,
  incomeHref,
}: {
  breakdown: BreakdownLine[];
  isOverpayment: boolean;
  overpaymentCents: number;
  taxPayableCents: number;
  isFrozen: boolean;
  /** False when this filing's own quarter has no declared sales yet (rework brief #2 §3.1). */
  hasSalesRecorded: boolean;
  period: string;
  taxableYear: number;
  incomeHref: string;
}) {
  const [open, setOpen] = useState(false);

  const summaryLabel = !hasSalesRecorded
    ? `No sales recorded for ${period} ${taxableYear}`
    : isOverpayment
      ? `Overpayment ${centsToPesos(overpaymentCents, { withSymbol: true })}`
      : `Tax payable ${centsToPesos(taxPayableCents, { withSymbol: true })}`;

  return (
    <div className="rounded-lg border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left"
      >
        <span className="text-sm font-semibold text-ink">
          Computation sheet {isFrozen ? "(Filed)" : "(live preview — not yet filed)"}
        </span>
        <span className="text-sm text-ink-secondary">
          {summaryLabel} <span className="ml-2 text-xs text-faint">{open ? "Hide" : "Show"}</span>
        </span>
      </button>
      {open && (
        <div className="border-t border-line px-4 py-3">
          {!hasSalesRecorded && (
            <p className="mb-2 rounded bg-amber-tint px-2 py-1 text-xs text-amber">
              No sales recorded for {period} {taxableYear} — enter the client&apos;s declared figure to compute.{" "}
              <Link href={incomeHref} className="underline">
                Record quarterly sales
              </Link>
              .
            </p>
          )}
          <table className="w-full border-collapse text-sm">
            <tbody>
              {breakdown.map((line) => (
                <tr key={line.label} className="border-b border-line last:border-0">
                  <td className="py-1 pr-2">{line.label}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {formatBreakdownAmount(line.amountCents, line.isOverpaymentLine)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
