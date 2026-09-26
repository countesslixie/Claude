"use client";

import Link from "next/link";
import { Select } from "@/components/ui/select";
import { bpsToPercentLabel } from "@/lib/money";

export interface SelectableAtcCode {
  code: string;
  description: string;
  rateBps: number;
  verifiedAgainstIssuance: boolean;
}

/**
 * Brief #5a — "ATC code becomes a picker of the active codes." Reused by
 * the certificate form and the Payor ("Payors" on screen) form. If the
 * list is empty, says so and links to Settings rather than showing an
 * empty dropdown with no explanation.
 */
export function AtcCodeSelect({
  atcCodes,
  name,
  value,
  onChange,
  required,
  id,
}: {
  atcCodes: SelectableAtcCode[];
  name: string;
  value: string;
  onChange: (code: string) => void;
  required?: boolean;
  id?: string;
}) {
  if (atcCodes.length === 0) {
    return (
      <p className="text-sm text-amber-700">
        No ATC codes yet —{" "}
        <Link href="/settings/atc-codes" className="underline">
          add one in Settings
        </Link>{" "}
        before choosing one here.
      </p>
    );
  }

  // A previously-saved value that no longer appears in the active list
  // (deactivated or edited since) is kept as its own option rather than
  // silently dropped by a re-save that didn't touch this field.
  const currentIsUnlisted = value !== "" && !atcCodes.some((c) => c.code === value);

  return (
    <Select id={id} name={name} value={value} onChange={(e) => onChange(e.target.value)} required={required}>
      <option value="">Choose an ATC code…</option>
      {currentIsUnlisted && <option value={value}>{value} (no longer active)</option>}
      {atcCodes.map((c) => (
        <option key={c.code} value={c.code}>
          {c.code} — {bpsToPercentLabel(c.rateBps)} — {c.description}
          {!c.verifiedAgainstIssuance ? " (unverified)" : ""}
        </option>
      ))}
    </Select>
  );
}
