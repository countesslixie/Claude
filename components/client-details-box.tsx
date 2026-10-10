import { formatTin } from "@/lib/formatTin";
import { formatManilaDateMDY } from "@/lib/dates";

/**
 * D185 — step 3's "Client details" box: TIN, branch code and birthday at
 * hand while she fills in eBIRForms. Display only: no controls, nothing
 * stored on the filing. Birthday is MM/DD/YYYY here only. D196 centred it in three
 * equal columns; D197 replaced that: the three items sit side by side from the left,
 * sized to their content (about 40px apart), each value centred under its label.
 */
function Item({ label, value }: { label: string; value: string | null | undefined }) {
  const empty = value == null || value.trim() === "" || value === "—";
  return (
    <div className="text-center">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className={empty ? "text-sm text-faint" : "font-mono text-sm text-ink"}>{empty ? "—" : value}</dd>
    </div>
  );
}

export function ClientDetailsBox({
  tin,
  branchCode,
  birthDate,
}: {
  tin: string | null;
  branchCode: string | null;
  birthDate: Date | null;
}) {
  return (
    <div className="rounded border border-line bg-background p-2" data-box="client-details">
      <p className="text-xs font-semibold text-ink">Client details</p>
      <dl className="mt-1 flex flex-wrap gap-x-10 gap-y-2">
        <Item label="TIN" value={formatTin(tin)} />
        <Item label="Branch code" value={branchCode} />
        <Item label="Birthday" value={formatManilaDateMDY(birthDate)} />
      </dl>
    </div>
  );
}
