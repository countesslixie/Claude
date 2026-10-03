import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import JSZip from "jszip";
import { PrismaClient } from "@prisma/client";
import { createBackupArchive, restoreReadme } from "@/lib/backup/createBackup";
import {
  getLastBackupAt,
  recordBackup,
  formatLastBackup,
  backupFileName,
  backupReminderText,
} from "@/lib/backup/lastBackup";

/**
 * Brief #6g (D172/D173) — the one-click backup, against a throwaway database
 * and storage folder in the system temp directory; never data/app.db.
 */
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "bir-backup-test-"));
const DB_FILE = path.join(ROOT, "live.db");
const DB_URL = `file:${DB_FILE}`;
const STORAGE = path.join(ROOT, "storage");
const ENV_FILE = path.join(ROOT, ".env");
const NOW = new Date("2026-10-03T06:30:00Z"); // 2:30 PM Manila

let db: PrismaClient;

const sha = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

async function tableCounts(client: PrismaClient): Promise<Record<string, number>> {
  const tables = (await client.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )).map((t) => t.name);
  const out: Record<string, number> = {};
  for (const t of tables) {
    const r = await client.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM "${t}"`);
    out[t] = Number(r[0].n);
  }
  return out;
}

async function makeBackup(now = NOW) {
  const archive = await createBackupArchive({ client: db, storageRoot: STORAGE, envPath: ENV_FILE, now });
  const buf = await collect(archive.stream);
  await archive.finished;
  return { archive, zip: await JSZip.loadAsync(buf), buf };
}

beforeAll(async () => {
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: DB_URL }, stdio: "pipe" });
  db = new PrismaClient({ datasources: { db: { url: DB_URL } } });
  await db.appSetting.create({ data: { key: "sample-1", value: "one" } });
  await db.appSetting.create({ data: { key: "sample-2", value: "two" } });
  fs.mkdirSync(path.join(STORAGE, "AAA-001", "2026", "Q1"), { recursive: true });
  fs.mkdirSync(path.join(STORAGE, "BBB-002", "2026", "ANNUAL"), { recursive: true });
  fs.writeFileSync(path.join(STORAGE, "AAA-001", "2026", "Q1", "step6__a__20261001__1.pdf"), Buffer.from("SAMPLE one"));
  fs.writeFileSync(path.join(STORAGE, "BBB-002", "2026", "ANNUAL", "step7__a__20261002__1.pdf"), crypto.getRandomValues(new Uint8Array(5000)));
  fs.writeFileSync(ENV_FILE, 'APP_PASSWORD="scratch"\nSESSION_SECRET="abc"\n');
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("Backup zip (D172)", () => {
  it("holds the database snapshot, every file under storage/ (same folders), .env and README.txt", async () => {
    const { zip } = await makeBackup();
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
    expect(names).toEqual([
      ".env",
      "README.txt",
      "data/app.db",
      "storage/AAA-001/2026/Q1/step6__a__20261001__1.pdf",
      "storage/BBB-002/2026/ANNUAL/step7__a__20261002__1.pdf",
    ]);
    for (const rel of ["AAA-001/2026/Q1/step6__a__20261001__1.pdf", "BBB-002/2026/ANNUAL/step7__a__20261002__1.pdf"]) {
      const inZip = await zip.file(`storage/${rel}`)!.async("nodebuffer");
      expect(sha(inZip)).toBe(sha(fs.readFileSync(path.join(STORAGE, rel))));
    }
    expect(await zip.file(".env")!.async("string")).toBe(fs.readFileSync(ENV_FILE, "utf8"));
  });

  it("the database inside opens and has the same row counts as the live one", async () => {
    const { zip } = await makeBackup();
    const out = path.join(ROOT, "from-zip.db");
    fs.writeFileSync(out, await zip.file("data/app.db")!.async("nodebuffer"));
    const copy = new PrismaClient({ datasources: { db: { url: `file:${out}` } } });
    try {
      const live = await tableCounts(db);
      expect(Object.keys(live).length).toBeGreaterThan(10);
      expect(live.AppSetting).toBeGreaterThanOrEqual(2);
      expect(await tableCounts(copy)).toEqual(live);
    } finally {
      await copy.$disconnect();
    }
  });

  it("is named with the Manila time and the README says when and how to restore", async () => {
    const { archive, zip } = await makeBackup();
    expect(archive.fileName).toBe("BIR Filing Manager backup 2026-10-03 1430.zip");
    expect(backupFileName(NOW)).toBe("BIR Filing Manager backup 2026-10-03 1430.zip");
    const readme = await zip.file("README.txt")!.async("string");
    expect(readme).toContain("October 3, 2026, 2:30 PM");
    expect(readme).toContain("Stop the app");
    expect(readme).toContain("app.db");
    expect(readme).toContain("storage");
    expect(readme).toContain(".env");
    expect(readme).toContain("Start the app");
    expect(restoreReadme(NOW)).toContain("TINs");
  });

  it("leaves no temp snapshot behind", async () => {
    const before = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("bir-backup-") && f.endsWith(".db"));
    await makeBackup();
    const after = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("bir-backup-") && f.endsWith(".db"));
    expect(after.sort()).toEqual(before.sort());
  });

  it("copes with a storage/ folder that does not exist yet", async () => {
    const archive = await createBackupArchive({ client: db, storageRoot: path.join(ROOT, "nope"), envPath: ENV_FILE, now: NOW });
    const zip = await JSZip.loadAsync(await collect(archive.stream));
    await archive.finished;
    expect(Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort()).toEqual([".env", "README.txt", "data/app.db"]);
  });
});

describe("Last backup time (D172)", () => {
  it("is never until recorded, then reads back and formats in Manila time", async () => {
    expect(await getLastBackupAt(db)).toBeNull();
    expect(formatLastBackup(null)).toBe("Never backed up");
    await recordBackup(NOW, db);
    expect((await getLastBackupAt(db))!.toISOString()).toBe(NOW.toISOString());
    expect(formatLastBackup(NOW)).toBe("October 3, 2026, 2:30 PM");
    const later = new Date("2026-10-04T00:05:00Z");
    await recordBackup(later, db);
    expect((await getLastBackupAt(db))!.toISOString()).toBe(later.toISOString());
    expect(await db.appSetting.count({ where: { key: "lastBackupAt" } })).toBe(1);
    await db.appSetting.delete({ where: { key: "lastBackupAt" } }); // keep the row counts of later tests stable
  });
});

describe("Restore round-trip (D172)", () => {
  it("restoring from the zip undoes a later change, and every document opens", async () => {
    const { zip } = await makeBackup();

    // change things after the backup
    await db.appSetting.create({ data: { key: "added-after-backup", value: "x" } });
    await db.appSetting.delete({ where: { key: "sample-1" } });
    const docPath = path.join(STORAGE, "AAA-001", "2026", "Q1", "step6__a__20261001__1.pdf");
    fs.writeFileSync(docPath, "CHANGED");
    fs.writeFileSync(path.join(STORAGE, "stray.txt"), "added after");
    fs.writeFileSync(ENV_FILE, 'APP_PASSWORD="changed"\n');
    await db.$disconnect();

    // the manual restore: unzip, then put app.db, storage/ and .env back
    const unzipped = path.join(ROOT, "unzipped");
    for (const name of Object.keys(zip.files)) {
      const target = path.join(unzipped, name);
      if (zip.files[name].dir) fs.mkdirSync(target, { recursive: true });
      else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, await zip.file(name)!.async("nodebuffer"));
      }
    }
    fs.renameSync(STORAGE, STORAGE + "-before-restore");
    fs.cpSync(path.join(unzipped, "storage"), STORAGE, { recursive: true });
    fs.copyFileSync(path.join(unzipped, "data", "app.db"), DB_FILE);
    fs.copyFileSync(path.join(unzipped, ".env"), ENV_FILE);

    db = new PrismaClient({ datasources: { db: { url: DB_URL } } });
    const keys = (await db.appSetting.findMany({ orderBy: { key: "asc" } })).map((r) => r.key);
    expect(keys).toEqual(["sample-1", "sample-2"]); // the later change is gone, the deleted row is back
    expect(fs.readFileSync(docPath, "utf8")).toBe("SAMPLE one");
    expect(fs.existsSync(path.join(STORAGE, "stray.txt"))).toBe(false);
    expect(fs.readFileSync(ENV_FILE, "utf8")).toContain('APP_PASSWORD="scratch"');
    // every document opens: each restored file is byte-identical to its original in the zip
    for (const name of Object.keys(zip.files).filter((n) => n.startsWith("storage/") && !zip.files[n].dir)) {
      expect(sha(fs.readFileSync(path.join(ROOT, name)))).toBe(sha(await zip.file(name)!.async("nodebuffer")));
    }
  });
});

describe("Backup reminder (D173)", () => {
  const day = 24 * 60 * 60 * 1000;
  it("shows when there has never been a backup", () => {
    expect(backupReminderText(null, NOW)).toBe("Never backed up");
  });
  it("shows the days when the last backup is more than 7 days old", () => {
    expect(backupReminderText(new Date(NOW.getTime() - 9 * day), NOW)).toBe("Last backup was 9 days ago");
    expect(backupReminderText(new Date(NOW.getTime() - 8 * day), NOW)).toBe("Last backup was 8 days ago");
  });
  it("hides within 7 days (7 days exactly is still recent)", () => {
    expect(backupReminderText(new Date(NOW.getTime() - 7 * day), NOW)).toBeNull();
    expect(backupReminderText(new Date(NOW.getTime() - 1 * day), NOW)).toBeNull();
    expect(backupReminderText(NOW, NOW)).toBeNull();
  });
});
