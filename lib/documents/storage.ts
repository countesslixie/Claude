import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { DateTime } from "luxon";

/**
 * Document vault storage (SPEC.md §8). Files live on the local
 * filesystem under ./storage, never as DB blobs (SPEC.md 4). This module
 * owns the naming convention and the actual read/write; lib/actions/
 * documents.ts is the Server Action / I/O boundary that calls it.
 */

const MANILA_ZONE = "Asia/Manila";
const STORAGE_ROOT = path.join(process.cwd(), "storage");

export function computeSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export interface StoragePathParams {
  clientCode: string;
  taxableYear: number;
  period: string;
  stepCode: string;
  slotCode: string;
  documentDate: Date;
  /** 1-based; SPEC.md §8 pads to two digits, e.g. "01". */
  seq: number;
  /** Without a leading dot, e.g. "pdf". */
  ext: string;
}

/**
 * SPEC.md §8: /storage/{client.code}/{taxableYear}/{period}/{stepCode}__{slotCode}__{YYYYMMDD}__{seq}.{ext}
 * Returns the path RELATIVE to the storage root (what gets stored in
 * Document.storedPath) — never an absolute filesystem path in the DB.
 */
export function buildStorageRelativePath(params: StoragePathParams): string {
  const dateStr = DateTime.fromJSDate(params.documentDate, { zone: "utc" })
    .setZone(MANILA_ZONE)
    .toFormat("yyyyMMdd");
  const seqStr = String(params.seq).padStart(2, "0");
  const safeExt = params.ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  const filename = `${params.stepCode}__${params.slotCode}__${dateStr}__${seqStr}.${safeExt}`;
  return path.posix.join(params.clientCode, String(params.taxableYear), params.period, filename);
}

function absolutePath(relativePath: string): string {
  const resolved = path.join(STORAGE_ROOT, relativePath);
  // Defensive: a storedPath is always built by buildStorageRelativePath
  // above, but never trust a relative path enough to let it escape the
  // storage root (e.g. via "..").
  if (!resolved.startsWith(STORAGE_ROOT + path.sep) && resolved !== STORAGE_ROOT) {
    throw new Error(`Refusing to resolve a path outside the storage root: ${relativePath}`);
  }
  return resolved;
}

export async function saveDocumentFile(relativePath: string, buffer: Buffer): Promise<void> {
  const target = absolutePath(relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, buffer);
}

export async function readDocumentFile(relativePath: string): Promise<Buffer> {
  return readFile(absolutePath(relativePath));
}
