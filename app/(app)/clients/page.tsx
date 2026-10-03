import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";

// D175 — always rendered fresh from the database, never prerendered at build time.
export const dynamic = "force-dynamic";

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
        <h1 className="text-2xl font-semibold text-ink">Clients</h1>
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
          className="h-8 w-64 rounded-md border border-line px-2 text-sm outline-none focus:border-purple-400"
        />
        <div className="flex overflow-hidden rounded-md border border-line">
          {[
            { value: "active", label: "Active" },
            { value: "all", label: "All" },
            { value: "inactive", label: "Inactive" },
          ].map((opt) => (
            <Link
              key={opt.value}
              href={`/clients?status=${opt.value}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className={`px-2.5 py-1 text-xs ${
                status === opt.value ? "bg-purple-600 text-white" : "bg-surface text-ink-secondary"
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

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="data-table data-table-centered">
          <thead>
            <tr>
              <th>Code</th>
              <th>Registered name</th>
              <th>TIN</th>
              <th>RDO</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id}>
                <td className="font-mono text-xs text-faint">{c.code}</td>
                <td>
                  <Link href={`/clients/${c.id}`} className="font-medium text-ink hover:underline">
                    {c.registeredName}
                  </Link>
                  {c.tradeName && <span className="ml-1 text-faint">({c.tradeName})</span>}
                </td>
                <td className="font-mono text-xs">{c.tin}</td>
                <td>{c.rdoCode}</td>
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
                <td colSpan={5} className="py-8 text-center text-sm text-faint">
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
