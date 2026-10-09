import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { getLastBackupAt } from "@/lib/backup/lastBackup";

/**
 * D178 — the clean start: wipe every client and everything hanging off a client
 * (and every file in storage/), keep the reference data. Run once, by her, after a
 * backup, with `npm run clean-start` (scripts/clean-start.ts). All the logic lives
 * here so it can be tested against a scratch database and storage folder.
 */

/** AppSetting key the seed reads: once set, the seed never builds sample clients again. */
export const SAMPLES_REMOVED_KEY = "samplesRemoved";
export const CLEAN_START_AT_KEY = "cleanStartAt";

export const BACKUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Tables the clean start empties, in the order it deletes them (children before parents). */
export const TABLES_EMPTIED = [
  "Document",
  "AmendmentAlert",
  "WorkflowStep",
  "SawtBatch",
  "Form2307",
  "Filing",
  "QuarterlySalesCustomer",
  "QuarterlySales",
  "StartingFigures",
  "ClientTaxYear",
  "Payor",
  "ClientBirLogin",
  "Client",
] as const;

/** Audit-log rows about these entities go with the clients; rows about anything else stay. */
export const CLIENT_OWNED_LOG_ENTITIES = [
  "Client",
  "Payor",
  "QuarterlySales",
  "QuarterlySalesCustomer",
  "ClientTaxYear",
  "StartingFigures",
  "Form2307",
  "Filing",
  "AmendmentAlert",
  "WorkflowStep",
  "Document",
  "SawtBatch",
  "ClientBirLogin",
] as const;

/** Tables the clean start never touches (the migrations table is Prisma's own). */
export const TABLES_KEPT = ["TaxRuleSet", "Holiday", "AtcCode", "AppSetting", "User", "WorkflowStepTemplate", "ActivityLog (rows about rule sets, ATC codes and holidays)", "_prisma_migrations"] as const;

type Counts = { table: string; count: number }[];

async function counts(prisma: PrismaClient): Promise<{ doomed: Counts; kept: Counts }> {
  const p = prisma as unknown as Record<string, { count(args?: unknown): Promise<number> }>;
  const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
  const doomed: Counts = [];
  for (const t of TABLES_EMPTIED) doomed.push({ table: t, count: await p[lower(t)].count() });
  doomed.push({
    table: "ActivityLog (rows about clients' data)",
    count: await prisma.activityLog.count({ where: { entityType: { in: [...CLIENT_OWNED_LOG_ENTITIES] } } }),
  });
  const kept: Counts = [
    { table: "TaxRuleSet", count: await prisma.taxRuleSet.count() },
    { table: "Holiday", count: await prisma.holiday.count() },
    { table: "AtcCode", count: await prisma.atcCode.count() },
    { table: "AppSetting", count: await prisma.appSetting.count() },
    { table: "User", count: await prisma.user.count() },
    { table: "WorkflowStepTemplate", count: await prisma.workflowStepTemplate.count() },
    { table: "ActivityLog (other rows)", count: await prisma.activityLog.count({ where: { entityType: { notIn: [...CLIENT_OWNED_LOG_ENTITIES] } } }) },
  ];
  return { doomed, kept };
}

/** Every real file under the vault (the folder's .gitkeep placeholder is not a document). */
export function listStorageFiles(root: string, rel = ""): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const out: string[] = [];
  for (const entry of entries) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listStorageFiles(root, child));
    else if (entry.name !== ".gitkeep" || rel !== "") out.push(child);
  }
  return out;
}

/** True when something is answering on the app's port (her app runs on 3000). */
export function isAppAnswering(port: number, host = "127.0.0.1", timeoutMs = 700): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (v: boolean) => {
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export interface CleanStartIo {
  /** Shows a line to her. */
  print(line: string): void;
  /** Asks a question and returns what she typed. */
  ask(question: string): Promise<string>;
}

export interface CleanStartOptions {
  prisma: PrismaClient;
  storageRoot: string;
  io: CleanStartIo;
  now?: Date;
  /** The port the app answers on; null skips the "is the app running?" check (used with --app-is-closed). */
  appPort: number | null;
  /** Test seam. */
  appIsAnswering?: (port: number) => Promise<boolean>;
}

export type CleanStartResult =
  | { status: "done"; deleted: Counts; filesRemoved: number }
  | { status: "refused"; reason: "no-recent-backup" | "app-running" }
  | { status: "cancelled" }
  | { status: "files-left"; deleted: Counts; filesRemoved: number; failures: string[] };

export async function runCleanStart(opts: CleanStartOptions): Promise<CleanStartResult> {
  const { prisma, storageRoot, io } = opts;
  const now = opts.now ?? new Date();

  // 1. A backup within the last 24 hours, or nothing happens.
  const last = await getLastBackupAt(prisma);
  if (!last || now.getTime() - last.getTime() > BACKUP_MAX_AGE_MS) {
    io.print("Please click Back up now on the Settings page first.");
    io.print("(The clean start only runs if a backup was taken in the last 24 hours.)");
    return { status: "refused", reason: "no-recent-backup" };
  }

  // 2. Not while the app is open.
  if (opts.appPort !== null) {
    const answering = await (opts.appIsAnswering ?? isAppAnswering)(opts.appPort);
    if (answering) {
      io.print(`The app seems to be running (something is answering on port ${opts.appPort}).`);
      io.print('Please close the "Bookkeeping App - keep open" window first, then run this again.');
      return { status: "refused", reason: "app-running" };
    }
  }

  // 3. Show exactly what will go; ask for DELETE.
  const { doomed, kept } = await counts(prisma);
  const files = listStorageFiles(storageRoot);
  io.print("");
  io.print("This will PERMANENTLY DELETE:");
  for (const d of doomed) io.print(`  ${d.table.padEnd(42)} ${String(d.count).padStart(6)}`);
  io.print(`  ${"Files in storage/".padEnd(42)} ${String(files.length).padStart(6)}`);
  io.print("");
  io.print("This will KEEP (not touched):");
  for (const k of kept) io.print(`  ${k.table.padEnd(42)} ${String(k.count).padStart(6)}`);
  io.print("  The migrations table, and your .env file.");
  io.print("");
  io.print("Make sure the app window is closed and your backup zip is somewhere safe.");
  const answer = (await io.ask("Type DELETE (capitals) to continue, anything else cancels: ")).trim();
  if (answer !== "DELETE") {
    io.print("Cancelled. Nothing was changed.");
    return { status: "cancelled" };
  }

  // 4. All database changes in ONE transaction: all or nothing.
  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  await prisma.$transaction(
    async (tx) => {
      const t = tx as unknown as Record<string, { deleteMany(): Promise<unknown> }>;
      const lower = (n: string) => n.charAt(0).toLowerCase() + n.slice(1);
      for (const table of TABLES_EMPTIED) await t[lower(table)].deleteMany();
      await tx.activityLog.deleteMany({ where: { entityType: { in: [...CLIENT_OWNED_LOG_ENTITIES] } } });
      for (const [key, value] of [
        [SAMPLES_REMOVED_KEY, "true"],
        [CLEAN_START_AT_KEY, now.toISOString()],
      ]) {
        await tx.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
      }
      await tx.activityLog.create({
        data: {
          entityType: "CleanStart",
          entityId: "clean-start",
          action: "DELETE",
          note: "Clean start: every client, filing, document and certificate deleted; reference data kept.",
          actorId: user?.id,
        },
      });
    },
    { timeout: 120_000, maxWait: 30_000 },
  );

  // 5. Only now, files. (The database part has already succeeded.)
  const failures: string[] = [];
  let filesRemoved = 0;
  for (const rel of files) {
    try {
      fs.rmSync(path.join(storageRoot, rel), { force: true, maxRetries: 5, retryDelay: 100 });
      filesRemoved++;
    } catch (e) {
      failures.push(`${rel}: ${(e as Error).message}`);
    }
  }
  // Empty folders go too; the storage folder itself (and its .gitkeep) stays.
  try {
    for (const entry of fs.readdirSync(storageRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) fs.rmSync(path.join(storageRoot, entry.name), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  } catch {
    /* anything left shows up in the re-count below */
  }
  const left = listStorageFiles(storageRoot);
  for (const rel of left) if (!failures.some((f) => f.startsWith(rel))) failures.push(`${rel}: still there`);

  // 6. Summary, from a fresh count.
  const after = await counts(prisma);
  const n = (rows: Counts, table: string) => rows.find((r) => r.table === table)?.count ?? 0;
  io.print("");
  if (failures.length > 0) {
    io.print("The database part is done, but some files could not be removed:");
    for (const f of failures) io.print(`  ${f}`);
    io.print("Close anything that has them open (the app, File Explorer) and delete the files in storage/ by hand.");
    return { status: "files-left", deleted: doomed, filesRemoved, failures };
  }
  io.print(
    `Done. ${n(after.doomed, "Client")} clients, ${n(after.doomed, "Filing")} filings, ${n(after.doomed, "Document")} documents. ` +
      `Kept: ${n(after.kept, "TaxRuleSet")} rule sets, ${n(after.kept, "Holiday")} holidays, ${n(after.kept, "AtcCode")} ATC codes.`,
  );
  return { status: "done", deleted: doomed, filesRemoved };
}
