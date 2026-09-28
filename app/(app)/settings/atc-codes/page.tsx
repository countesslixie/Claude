import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { bpsToPercentLabel } from "@/lib/money";

/**
 * Brief #5a — ATC code maintenance (Settings, alongside holidays and tax
 * rule sets), backed by the existing AtcCode table (D19). She can add,
 * edit and deactivate here; the certificate form's ATC picker reads only
 * the active rows. verifiedAgainstIssuance is shown plainly — an
 * unverified code must never look authoritative.
 */
export default async function AtcCodesPage() {
  const codes = await prisma.atcCode.findMany({ orderBy: { code: "asc" } });

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">ATC codes</h1>
          <p className="mt-1 text-sm text-faint">
            The rate is a property of the code — the certificate form fills it in once a code is chosen.
            Never invent a code or a rate here (D19); leave it unverified until confirmed against the
            current BIR ATC list.
          </p>
        </div>
        <Link href="/settings/atc-codes/new">
          <Button>New ATC code</Button>
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="data-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Description</th>
              <th>Rate</th>
              <th>Payee type</th>
              <th>Verified</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {codes.map((c) => (
              <tr key={c.id}>
                <td className="font-mono text-xs">{c.code}</td>
                <td className="max-w-sm text-sm text-ink-secondary">{c.description}</td>
                <td>{bpsToPercentLabel(c.rateBps)}</td>
                <td>{c.payeeType || "—"}</td>
                <td>
                  {c.verifiedAgainstIssuance ? (
                    <StatusBadge tone="done">Verified</StatusBadge>
                  ) : (
                    <StatusBadge tone="waiting">Unverified</StatusBadge>
                  )}
                </td>
                <td>
                  {c.isActive ? (
                    <StatusBadge tone="done">Active</StatusBadge>
                  ) : (
                    <StatusBadge tone="pending">Inactive</StatusBadge>
                  )}
                </td>
                <td>
                  <Link href={`/settings/atc-codes/${c.id}`} className="text-sm text-ink-secondary hover:underline">
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
            {codes.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-faint">
                  No ATC codes yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
