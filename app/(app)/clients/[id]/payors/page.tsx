import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { PayorForm } from "@/components/payor-form";
import { createPayor } from "@/lib/actions/payors";
import { bpsToPercentLabel } from "@/lib/money";

/**
 * Brief #5a — "Payors": one saved list per client (name, TIN, address,
 * usual ATC code, active flag). Adding is inline here (and from step
 * 1/step 2 directly, see components/payor-name-field.tsx) — this screen
 * is the small "edit or deactivate" fallback, not the only way in.
 * Brief #5b renamed "Customers / payors" to "Payors" on screen only — the
 * Payor model/table and internal field names are unchanged.
 */
export default async function PayorsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) notFound();

  const [payors, atcCodes] = await Promise.all([
    prisma.payor.findMany({ where: { clientId: id }, orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
    prisma.atcCode.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
  ]);

  const boundCreate = createPayor.bind(null, id);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">
            Payors — {client.registeredName}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            One shared list of names and details for this client — a company entered on a step 1 row is
            usually the same one that issues a 2307 in step 2. Picking a saved entry fills the details on
            that one row or certificate; nothing here affects income or credit amounts.
          </p>
        </div>
        <Link href={`/clients/${id}`}>
          <Button variant="secondary" size="sm">
            Back to client
          </Button>
        </Link>
      </div>

      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Add</h2>
        <PayorForm action={boundCreate} atcCodes={atcCodes} submitLabel="Add" resetOnSuccess />
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>TIN</th>
              <th>Address</th>
              <th>Usual ATC</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {payors.map((p) => {
              const atc = atcCodes.find((c) => c.code === p.usualAtcCode);
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="font-mono text-xs">{p.tin || "—"}</td>
                  <td>{p.address || "—"}</td>
                  <td className="font-mono text-xs">
                    {p.usualAtcCode ? `${p.usualAtcCode}${atc ? ` (${bpsToPercentLabel(atc.rateBps)})` : ""}` : "—"}
                  </td>
                  <td>
                    {p.isActive ? (
                      <StatusBadge tone="done">Active</StatusBadge>
                    ) : (
                      <StatusBadge tone="pending">Inactive</StatusBadge>
                    )}
                  </td>
                  <td>
                    <Link href={`/clients/${id}/payors/${p.id}`} className="text-sm text-slate-600 hover:underline">
                      Edit
                    </Link>
                  </td>
                </tr>
              );
            })}
            {payors.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm text-slate-400">
                  No saved payors yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
