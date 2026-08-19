import { prisma } from "@/lib/prisma";
import { HolidayForm } from "@/components/holiday-form";
import { deleteHoliday } from "@/lib/actions/holidays";
import { formatManilaDate } from "@/lib/dates";

const TYPE_LABELS: Record<string, string> = {
  REGULAR: "Regular",
  SPECIAL_NON_WORKING: "Special non-working",
};

export default async function HolidaysPage() {
  const holidays = await prisma.holiday.findMany({ orderBy: { date: "asc" } });

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-lg font-semibold text-slate-900">Holidays</h1>
      <p className="mt-1 text-sm text-slate-500">
        Business-day due-date shifting reads this table only — holidays are never computed
        algorithmically (SPEC.md section 3.6).
      </p>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
        <HolidayForm />
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="data-table">
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
                    <button type="submit" className="text-sm text-red-600 hover:underline">
                      Delete
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {holidays.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-sm text-slate-400">
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
