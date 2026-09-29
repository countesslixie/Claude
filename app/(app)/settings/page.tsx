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
  {
    href: "/settings/atc-codes",
    title: "ATC codes",
    description: "Add, edit and deactivate the codes the certificate form's ATC picker offers (D19).",
  },
];

const LATER = [
  { title: "Workflow step template", phase: "Phase 3" },
  { title: "Backup", phase: "Phase 4" },
];

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-2xl font-semibold text-ink">Settings</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {BUILT.map((item) => (
          <Link key={item.href} href={item.href}>
            <Card className="h-full transition-colors hover:border-separator">
              <CardBody>
                <h2 className="text-sm font-semibold text-ink">{item.title}</h2>
                <p className="mt-1 text-sm text-faint">{item.description}</p>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>

      <h2 className="mt-8 mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
        Coming in later phases
      </h2>
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {LATER.map((item) => (
          <li key={item.title} className="flex items-center justify-between px-4 py-2 text-sm">
            <span className="text-faint">{item.title}</span>
            <span className="text-xs text-faint">{item.phase}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
