import { prisma } from "@/lib/prisma";
import { HolidaysHeader } from "@/components/holidays-header";
import { deleteHoliday } from "@/lib/actions/holidays";
import { formatManilaDate } from "@/lib/dates";

// D175 — always rendered fresh from the database, never prerendered at build time.
export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  REGULAR: "Regular",
  SPECIAL_NON_WORKING: "Special non-working",
};

export default async function HolidaysPage() {
  const holidays = await prisma.holiday.findMany({ orderBy: { date: "asc" } });

  return (
    <div className="mx-auto max-w-4xl">
      <HolidaysHeader />

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="data-table data-table-centered">
          <thead>
            <tr>
              <th>Date</th>
              <th>Name</th>
              <th>Type</th>
              <th>Scope</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {holidays.map((h) => (
              <tr key={h.id}>
                <td>{formatManilaDate(h.date)}</td>
                <td>{h.name}</td>
                <td>{TYPE_LABELS[h.type]}</td>
                <td>{h.scope === "LOCAL" ? `Local — ${h.localScope}` : "National"}</td>
                <td>
                  <form action={deleteHoliday.bind(null, h.id)}>
                    <button type="submit" className="text-sm text-red hover:underline">
                      Delete
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {holidays.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-sm text-faint">
                  No holidays seeded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
