import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { createBackupArchive } from "@/lib/backup/createBackup";
import { getLastBackupAt, recordBackup } from "@/lib/backup/lastBackup";
import { testStorageRoot } from "@/tests/helpers/testEnv";

/**
 * D176 — the last-backup time is recorded when a backup completes, and only
 * then: not when the zip failed or was abandoned partway, and not held hostage
 * by a failure to delete the temporary snapshot (Windows can refuse that).
 * Runs on this test file's own private database copy (D177).
 */
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "bir-record-test-"));
const ENV_FILE = path.join(SCRATCH, ".env");
const STORAGE = path.join(testStorageRoot(), "record-time-test");
const DOC = path.join(STORAGE, "doc.pdf");
fs.writeFileSync(ENV_FILE, "APP_PASSWORD=x\n");
fs.mkdirSync(STORAGE, { recursive: true });
fs.writeFileSync(DOC, Buffer.alloc(200_000, 7));

const NOW = new Date("2026-10-03T06:30:00Z");

async function archive(onComplete: () => Promise<void>) {
  return createBackupArchive({ client: prisma, storageRoot: STORAGE, envPath: ENV_FILE, now: NOW, onComplete });
}

async function drain(stream: NodeJS.ReadableStream) {
  for await (const _ of stream as AsyncIterable<Buffer>) void _;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.appSetting.deleteMany({ where: { key: "lastBackupAt" } });
  fs.mkdirSync(STORAGE, { recursive: true });
  fs.writeFileSync(DOC, Buffer.alloc(200_000, 7));
});

describe("recording the last-backup time (D176)", () => {
  it("is recorded after a stream that completed", async () => {
    expect(await getLastBackupAt()).toBeNull();
    const a = await archive(() => recordBackup(NOW));
    await drain(a.stream);
    await a.finished;
    expect((await getLastBackupAt())!.toISOString()).toBe(NOW.toISOString());
  });

  it("is still recorded when deleting the temp snapshot fails (the Windows case)", async () => {
    const realRm = fs.promises.rm;
    vi.spyOn(fs.promises, "rm").mockImplementation(async (p, o) => {
      if (String(p).includes("bir-backup-")) throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
      return realRm(p, o);
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = await archive(() => recordBackup(NOW));
    await drain(a.stream);
    await a.finished; // does not reject
    expect((await getLastBackupAt())!.toISOString()).toBe(NOW.toISOString());
  });

  it("is NOT recorded when the zip fails partway", async () => {
    const a = await archive(() => recordBackup(NOW));
    fs.rmSync(DOC); // the file vanishes before it is read
    await expect(drain(a.stream)).rejects.toBeTruthy();
    await expect(a.finished).rejects.toBeTruthy();
    expect(await getLastBackupAt()).toBeNull();
  });

  it("is NOT recorded when the download is abandoned partway", async () => {
    const a = await archive(() => recordBackup(NOW));
    await new Promise<void>((resolve) => {
      a.stream.once("data", () => {
        a.stream.destroy(); // the browser gave up after the first chunk
        resolve();
      });
    });
    await expect(a.finished).rejects.toThrow(/did not complete/);
    expect(await getLastBackupAt()).toBeNull();
  });

  it("a recording failure is reported, not hidden", async () => {
    const a = await archive(async () => {
      throw new Error("database is locked");
    });
    await drain(a.stream);
    await expect(a.finished).rejects.toThrow(/database is locked/);
  });
});
