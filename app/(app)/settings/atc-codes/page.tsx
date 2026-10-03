import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { bpsToPercentLabel } from "@/lib/money";

/**
 * ATC maintenance (Settings), backed by the AtcCode table (D19). She can
 * add, edit and deactivate here; the certificate form's ATC picker reads
 * only the active rows. Payee type and verified state are not shown (D163/D165).
 */
export default async function AtcCodesPage() {
  const codes = await prisma.atcCode.findMany({ orderBy: { code: "asc" } });

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">ATC</h1>
        <Link href="/settings/atc-codes/new">
          <Button>New ATC</Button>
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="data-table data-table-centered">
          <thead>
            <tr>
              <th>Code</th>
              <th>Description</th>
              <th>Rate</th>
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
                <td colSpan={5} className="py-8 text-center text-sm text-faint">
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
