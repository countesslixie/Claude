import Link from "next/link";
import { Card, CardBody } from "@/components/ui/card";

const BUILT = [
  {
    href: "/settings/tax-rule-sets",
    title: "Tax rule sets",
    description:
      "Versioned rates, thresholds, and statutory deadlines, effective by taxable year (SPEC.md 3.1–3.7).",
  },
  {
    href: "/settings/holidays",
    title: "Holidays",
    description: "Regular and special non-working days used for due-date business-day shifting.",
  },
];

const LATER = [
  { title: "ATC codes", phase: "Phase 2" },
  { title: "Workflow step template", phase: "Phase 3" },
  { title: "Chart of accounts", phase: "Phase 4" },
  { title: "Backup", phase: "Phase 4" },
];

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-lg font-semibold text-slate-900">Settings</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {BUILT.map((item) => (
          <Link key={item.href} href={item.href}>
            <Card className="h-full transition-colors hover:border-slate-400">
              <CardBody>
                <h2 className="text-sm font-semibold text-slate-900">{item.title}</h2>
                <p className="mt-1 text-sm text-slate-500">{item.description}</p>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>

      <h2 className="mt-8 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Coming in later phases
      </h2>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {LATER.map((item) => (
          <li key={item.title} className="flex items-center justify-between px-4 py-2 text-sm">
            <span className="text-slate-500">{item.title}</span>
            <span className="text-xs text-slate-400">{item.phase}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
