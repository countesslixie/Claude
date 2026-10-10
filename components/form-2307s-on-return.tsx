import { formatTin } from "@/lib/formatTin";
import { centsToPesos } from "@/lib/money";

/**
 * D195 — step 11's read-only "Form 2307s on this return" box: one row per
 * certificate claimed on this filing, so she can see what she is keying into
 * the alphalist while she uploads. Display only — no buttons, no links, nothing
 * stored. Every heading and value is centred. TIN through formatTin (D184).
 */
export interface Form2307ListRow {
  id: string;
  payorName: string;
  payorTin: string | null;
  atcCode: string;
  incomePaymentCents: number;
  taxWithheldCents: number;
}

/** Payor name, then TIN — the SAWT keying worksheet's order (D38). */
export function sortForm2307List<T extends { payorName: string; payorTin: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.payorName.localeCompare(b.payorName) || (a.payorTin ?? "").localeCompare(b.payorTin ?? ""));
}

export function Form2307sOnReturn({ rows }: { rows: Form2307ListRow[] }) {
  const sorted = sortForm2307List(rows);
  return (
    <div className="mt-2 rounded border border-line bg-background p-2" data-box="form-2307s-on-return">
      <p className="text-xs font-semibold text-ink">Form 2307s on this return</p>
      {sorted.length === 0 ? (
        <p className="mt-1 text-center text-xs text-faint">—</p>
      ) : (
        <table className="mt-1 w-full text-center text-xs">
          <thead>
            <tr className="text-faint">
              <th className="px-2 py-1 text-center font-normal">Payor</th>
              <th className="px-2 py-1 text-center font-normal">TIN</th>
              <th className="px-2 py-1 text-center font-normal">ATC</th>
              <th className="px-2 py-1 text-center font-normal">Income</th>
              <th className="px-2 py-1 text-center font-normal">Tax withheld</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.id} className="text-ink">
                <td className="px-2 py-1 text-center">{c.payorName}</td>
                <td className="px-2 py-1 text-center font-mono">{formatTin(c.payorTin) || "—"}</td>
                <td className="px-2 py-1 text-center">{c.atcCode}</td>
                <td className="px-2 py-1 text-center tabular-nums">{centsToPesos(c.incomePaymentCents, { withSymbol: true })}</td>
                <td className="px-2 py-1 text-center tabular-nums">{centsToPesos(c.taxWithheldCents, { withSymbol: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
