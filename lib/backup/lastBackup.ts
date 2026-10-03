import { prisma } from "@/lib/prisma";
import { MANILA_ZONE } from "@/lib/dates";
import { DateTime } from "luxon";
import { formatDays } from "@/lib/formatDays";

/** D172 — the one AppSetting row that records the last successful backup. */
export const LAST_BACKUP_KEY = "lastBackupAt";

/** The reminder shows once the last backup is MORE than this many days old (D173). */
export const BACKUP_REMINDER_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getLastBackupAt(client: Pick<typeof prisma, "appSetting"> = prisma): Promise<Date | null> {
  const row = await client.appSetting.findUnique({ where: { key: LAST_BACKUP_KEY } });
  if (!row) return null;
  const d = new Date(row.value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function recordBackup(at: Date, client: Pick<typeof prisma, "appSetting"> = prisma): Promise<void> {
  await client.appSetting.upsert({
    where: { key: LAST_BACKUP_KEY },
    update: { value: at.toISOString() },
    create: { key: LAST_BACKUP_KEY, value: at.toISOString() },
  });
}

/** "October 3, 2026, 2:30 PM" in Manila time, or "Never backed up". */
export function formatLastBackup(last: Date | null): string {
  if (!last) return "Never backed up";
  return DateTime.fromJSDate(last, { zone: MANILA_ZONE }).toFormat("MMMM d, yyyy, h:mm a");
}

/** The backup file's name: "BIR Filing Manager backup 2026-10-03 1430.zip" (Manila time). */
export function backupFileName(at: Date): string {
  return `BIR Filing Manager backup ${DateTime.fromJSDate(at, { zone: MANILA_ZONE }).toFormat("yyyy-MM-dd HHmm")}.zip`;
}

/**
 * D173 — the Dashboard's backup reminder. Null (show nothing) when the last
 * backup is within 7 days; otherwise the sentence, with the elapsed whole days
 * counted by milliseconds (never by calendar-day extraction).
 */
export function backupReminderText(last: Date | null, now: Date): string | null {
  if (!last) return "Never backed up";
  const elapsed = now.getTime() - last.getTime();
  if (elapsed <= BACKUP_REMINDER_DAYS * DAY_MS) return null;
  return `Last backup was ${formatDays(Math.floor(elapsed / DAY_MS))} ago`;
}
