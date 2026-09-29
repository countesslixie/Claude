import type { BreakdownLine } from "./types";

/**
 * D83 (brief #5o) — pure comparison of a filed return's frozen computation
 * against a live recomputation, item by item. Works on the `breakdown` every
 * result shape carries (1701Q, 1701A and the legacy annual), matching lines
 * by their item number ("56.") or, failing that, their label. The final
 * payable/overpayment line is left out here — its net effect is
 * `netPayableCents` below — because its label flips between "Tax Payable" and
 * "— overpayment".
 */
export interface ChangedItem {
  item: string;
  label: string;
  oldCents: number;
  newCents: number;
  diffCents: number;
}

interface SheetLike {
  breakdown: BreakdownLine[];
  taxPayableCents: number;
  overpaymentCents: number;
}

const keyOf = (line: BreakdownLine) => /^(\d+)\./.exec(line.label)?.[1] ?? line.label;

export function netPayableCents(sheet: Pick<SheetLike, "taxPayableCents" | "overpaymentCents">): number {
  return sheet.taxPayableCents - sheet.overpaymentCents;
}

export function changedItems(frozen: SheetLike, live: SheetLike): ChangedItem[] {
  const liveByKey = new Map(live.breakdown.filter((l) => !l.isOverpaymentLine).map((l) => [keyOf(l), l]));
  const changes: ChangedItem[] = [];
  for (const line of frozen.breakdown) {
    if (line.isOverpaymentLine) continue;
    const key = keyOf(line);
    const now = liveByKey.get(key);
    if (!now) continue;
    // the last line ("63. Tax Payable/(Overpayment)") is compared through the net figure instead
    if (/tax payable/i.test(line.label)) continue;
    if (now.amountCents !== line.amountCents) {
      changes.push({
        item: /^\d+$/.test(key) ? key : "",
        label: line.label,
        oldCents: line.amountCents,
        newCents: now.amountCents,
        diffCents: now.amountCents - line.amountCents,
      });
    }
  }
  return changes;
}

/** True when anything on the return would now read differently — items or the net figure. */
export function differsFromFrozen(frozen: SheetLike, live: SheetLike): boolean {
  return changedItems(frozen, live).length > 0 || netPayableCents(frozen) !== netPayableCents(live);
}
