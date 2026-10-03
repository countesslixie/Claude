import Link from "next/link";
import { Card, CardBody } from "@/components/ui/card";
import { BackupButton } from "@/components/backup-button";
import { getLastBackupAt, formatLastBackup } from "@/lib/backup/lastBackup";

export const dynamic = "force-dynamic";

const BUILT = [
  {
    href: "/settings/tax-rule-sets",
    title: "Tax Rules",
    description:
      "Versioned rates, thresholds, and statutory deadlines, effective by taxable year.",
  },
  {
    href: "/settings/atc-codes",
    title: "ATC",
    description: "Add, edit and deactivate the codes the certificate form's ATC picker offers.",
  },
  {
    href: "/settings/holidays",
    title: "Holidays",
    description: "Regular and special non-working days used for due-date business-day shifting.",
  },
];

export default async function SettingsPage() {
  const lastBackup = await getLastBackupAt();

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

      <h2 className="mt-8 mb-2 text-xs font-semibold uppercase tracking-wide text-faint">Backup</h2>
      <Card>
        <CardBody>
          <p className="text-sm text-ink">
            Last backup: <span className="font-medium">{formatLastBackup(lastBackup)}</span>
          </p>
          <p className="mt-1 mb-3 text-sm text-faint">
            One zip with the database, every uploaded document and the app&apos;s settings file. It goes to your
            Downloads folder. It holds clients&apos; TINs and income, so keep it somewhere private.
          </p>
          <BackupButton lastBackupAt={lastBackup ? lastBackup.toISOString() : null} />
        </CardBody>
      </Card>
    </div>
  );
}
