import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";

const TAXPAYER_TYPE_LABELS: Record<string, string> = {
  PURELY_SELF_EMPLOYED: "Purely self-employed",
  MIXED_INCOME: "Mixed income",
};

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status = "active", q = "" } = await searchParams;

  const clients = await prisma.client.findMany({
    where: {
      isActive: status === "all" ? undefined : status === "active",
      ...(q
        ? {
            OR: [
              { registeredName: { contains: q } },
              { tradeName: { contains: q } },
              { code: { contains: q } },
              { tin: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { registeredName: "asc" },
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Clients</h1>
        <Link href="/clients/new">
          <Button>New client</Button>
        </Link>
      </div>

      <form className="mb-4 flex items-center gap-3" method="get">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search name, code, or TIN…"
          className="h-8 w-64 rounded-md border border-slate-300 px-2 text-sm outline-none focus:border-slate-500"
        />
        <div className="flex overflow-hidden rounded-md border border-slate-300">
          {[
            { value: "active", label: "Active" },
            { value: "all", label: "All" },
            { value: "inactive", label: "Inactive" },
          ].map((opt) => (
            <Link
              key={opt.value}
              href={`/clients?status=${opt.value}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className={`px-2.5 py-1 text-xs ${
                status === opt.value ? "bg-slate-900 text-white" : "bg-white text-slate-600"
              }`}
            >
              {opt.label}
            </Link>
          ))}
        </div>
        <Button type="submit" variant="secondary" size="sm">
          Search
        </Button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="data-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Registered name</th>
              <th>TIN</th>
              <th>RDO</th>
              <th>Taxpayer type</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id}>
                <td className="font-mono text-xs text-slate-500">{c.code}</td>
                <td>
                  <Link href={`/clients/${c.id}`} className="font-medium text-slate-900 hover:underline">
                    {c.registeredName}
                  </Link>
                  {c.tradeName && <span className="ml-1 text-slate-400">({c.tradeName})</span>}
                </td>
                <td className="font-mono text-xs">{c.tin}</td>
                <td>{c.rdoCode}</td>
                <td>{TAXPAYER_TYPE_LABELS[c.taxpayerType]}</td>
                <td>
                  {c.isActive ? (
                    <StatusBadge tone="done">Active</StatusBadge>
                  ) : (
                    <StatusBadge tone="pending">Inactive</StatusBadge>
                  )}
                </td>
              </tr>
            ))}
            {clients.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm text-slate-400">
                  No clients found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
