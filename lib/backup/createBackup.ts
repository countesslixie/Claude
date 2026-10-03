import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import JSZip from "jszip";
import { DateTime } from "luxon";
import { MANILA_ZONE } from "@/lib/dates";
import { backupFileName } from "@/lib/backup/lastBackup";

/**
 * D172 — one-click backup. Builds ONE zip: a consistent snapshot of the
 * database (SQLite `VACUUM INTO`, safe while the app is running), every file
 * under storage/ with its folder structure, `.env`, and a README.txt that says
 * when it was made and how to restore. Runs on the server and streams; files
 * are fed to the zip as read streams so a large storage/ never sits in memory.
 * No network. The temp snapshot is deleted when the stream ends or fails.
 */

/** The minimum of a Prisma client this needs — lets a test hand in a scratch database. */
export interface SnapshotClient {
  $executeRawUnsafe(query: string): Promise<unknown>;
}

export interface BackupOptions {
  client: SnapshotClient;
  storageRoot: string;
  envPath: string;
  now?: Date;
  tmpDir?: string;
  /**
   * Called once, only after the whole zip has been generated and handed on (the zip's
   * last bytes are its table of contents, so "ended" means complete). Never called
   * for a zip that failed or was abandoned partway — and a failure to delete the
   * temp snapshot afterwards (Windows can refuse while the file is still closing)
   * never stops it: D176.
   */
  onComplete?: () => Promise<void>;
}

export interface BackupArchive {
  fileName: string;
  stream: Readable;
  /** Resolves once the zip has been fully read, `onComplete` has run and cleanup was attempted; rejects if the zip failed or was abandoned. */
  finished: Promise<void>;
}

export function restoreReadme(at: Date): string {
  const when = DateTime.fromJSDate(at, { zone: MANILA_ZONE }).toFormat("MMMM d, yyyy, h:mm a");
  return `BIR Filing Manager backup
Made on ${when} (Manila time).

THIS FILE HOLDS CLIENTS' TINs, INCOME AND DOCUMENTS.
Keep it somewhere private (your own drive or a USB stick you keep safe).
Do not put it in a shared folder and do not email it.

WHAT IS INSIDE
  data/app.db   the database (every client, return, figure and step)
  storage/      every uploaded document, in its folders
  .env          the app's password and settings (the app cannot start without it)
  README.txt    this note

HOW TO RESTORE
Restoring REPLACES everything in the app with what is in this backup.
Anything entered after ${when} will be gone.

1. Stop the app. Close the window the app is running in (the black window
   opened by "Start Bookkeeping App"). Make sure no browser tab is mid-save.
2. Unzip this backup. In File Explorer, right-click the zip, choose
   "Extract All...", and pick an empty folder, for example your Desktop.
3. Copy the three things back into the app's folder (the folder that holds
   package.json), replacing what is there. To be safe, first rename the
   current ones so you can go back:
     - rename  data\\app.db  to  app.db.before-restore, then copy the backup's
       data\\app.db into the app's data folder. If you see app.db-wal or
       app.db-shm next to it, delete those two files.
     - rename  storage  to  storage-before-restore, then copy the backup's
       whole storage folder into the app's folder.
     - copy the backup's .env file into the app's folder, replacing the old one.
       (.env starts with a dot, so File Explorer may hide it. In File Explorer
       choose View > Show > Hidden items.)
4. Start the app again as you normally do, sign in, and open a client's
   filing to check a document opens.

THE SAME STEPS IN POWERSHELL (optional)
Open PowerShell in the app's folder, with the app stopped, and replace
BACKUPFOLDER with the folder you unzipped into:
  Rename-Item data\\app.db app.db.before-restore
  Rename-Item storage storage-before-restore
  Copy-Item "BACKUPFOLDER\\data\\app.db" data\\app.db
  Copy-Item "BACKUPFOLDER\\storage" . -Recurse
  Copy-Item "BACKUPFOLDER\\.env" .env -Force
`;
}

async function* walkFiles(root: string, rel = ""): AsyncGenerator<string> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(path.join(root, rel), { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT" && rel === "") return;
    throw e;
  }
  for (const entry of entries) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* walkFiles(root, child);
    else if (entry.isFile()) yield child;
  }
}

export async function createBackupArchive(opts: BackupOptions): Promise<BackupArchive> {
  const now = opts.now ?? new Date();
  const tmpDir = opts.tmpDir ?? os.tmpdir();
  const snapshotPath = path.join(tmpDir, `bir-backup-${randomBytes(8).toString("hex")}.db`);
  // Windows can briefly refuse to delete a file whose handle is still closing: retry, and never let it matter.
  const removeSnapshot = () =>
    fs.promises.rm(snapshotPath, { force: true, maxRetries: 10, retryDelay: 100 }).catch((e) => {
      console.warn(`Backup: could not delete the temporary snapshot ${snapshotPath}:`, e);
    });

  try {
    // A consistent copy taken through SQLite itself, not a raw file copy.
    await opts.client.$executeRawUnsafe(`VACUUM INTO '${snapshotPath.replace(/'/g, "''")}'`);

    // JSZip neither fails nor finishes when one of its input files cannot be read; it just stops.
    // So a read error is caught here and aborts the whole zip (nothing half-made is ever "complete").
    const readErrors: Error[] = [];
    let abort: (err: Error) => void = (err) => readErrors.push(err);
    const open = (file: string) => {
      const rs = fs.createReadStream(file);
      rs.once("error", (err) => abort(err));
      return rs;
    };

    const zip = new JSZip();
    zip.file("data/app.db", open(snapshotPath));
    for await (const rel of walkFiles(opts.storageRoot)) {
      zip.file(`storage/${rel}`, open(path.join(opts.storageRoot, rel)));
    }
    zip.file(".env", open(opts.envPath));
    zip.file("README.txt", restoreReadme(now));

    // JSZip hands back an old-style (streams2) readable; wrap it so it is a real
    // node:stream Readable (async-iterable, and Readable.toWeb works on it).
    const raw = zip.generateNodeStream({ streamFiles: true, compression: "DEFLATE" }) as unknown as NodeJS.ReadableStream;
    const stream = new Readable().wrap(raw);
    abort = (err) => stream.destroy(err);
    for (const err of readErrors) abort(err);
    const finished = new Promise<void>((resolve, reject) => {
      let ended = false;
      stream.once("end", () => {
        ended = true;
        // Record first (the zip is complete), then clean up; a cleanup problem cannot undo a good backup.
        Promise.resolve(opts.onComplete?.())
          .then(removeSnapshot, async (err) => {
            await removeSnapshot();
            throw err;
          })
          .then(resolve, reject);
      });
      stream.once("error", (err) => void removeSnapshot().then(() => reject(err)));
      // Closed without ending = the reader gave up partway: not a backup.
      stream.once("close", () => {
        if (!ended) void removeSnapshot().then(() => reject(new Error("The backup download did not complete.")));
      });
    });
    finished.catch(() => {}); // the route listens through `finished`; never leave a rejection unhandled
    return { fileName: backupFileName(now), stream, finished };
  } catch (err) {
    await removeSnapshot();
    throw err;
  }
}
