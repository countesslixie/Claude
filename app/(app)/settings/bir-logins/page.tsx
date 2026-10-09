import { prisma } from "@/lib/prisma";
import { BackToSettings } from "@/components/back-to-settings";
import { BirLoginsTable, type BirLoginRow } from "@/components/bir-logins-table";

// D175 — always rendered fresh from the database, never prerendered at build time.
export const dynamic = "force-dynamic";

export default async function BirLoginsPage() {
  const clients = await prisma.client.findMany({
    where: { isActive: true },
    select: { id: true, registeredName: true, birLogin: true },
  });
  const rows: BirLoginRow[] = clients
    .sort((a, b) => a.registeredName.localeCompare(b.registeredName, "en", { sensitivity: "base" }))
    .map((c) => ({
      clientId: c.id,
      name: c.registeredName,
      eafsUsername: c.birLogin?.eafsUsername ?? "",
      eafsPassword: c.birLogin?.eafsPassword ?? "",
      alphalistUsername: c.birLogin?.alphalistUsername ?? "",
      alphalistPassword: c.birLogin?.alphalistPassword ?? "",
      orusUsername: c.birLogin?.orusUsername ?? "",
      orusPassword: c.birLogin?.orusPassword ?? "",
    }));

  // D182 — the same container width the Dashboard uses (app/(app)/page.tsx).
  return (
    <div className="mx-auto w-full max-w-[1100px]">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">BIR Logins</h1>
        <BackToSettings />
      </div>
      <BirLoginsTable rows={rows} />
    </div>
  );
}
