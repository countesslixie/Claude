import fs from "node:fs";
import path from "node:path";

/**
 * D177 — the test run must never touch her real database or her real document
 * vault. These are the checks every test-environment step runs before it
 * writes anything.
 */

/** The file a SQLite `file:` URL points at. A relative path is resolved against prisma/, the way Prisma does. */
export function sqlitePathFromUrl(url: string, repoRoot: string): string | null {
  if (!url.startsWith("file:")) return null;
  const raw = url.slice("file:".length).split("?")[0];
  if (!raw) return null;
  return path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw) ? path.normalize(raw) : path.resolve(repoRoot, "prisma", raw);
}

function real(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function sameOrInside(child: string, parent: string): boolean {
  const c = real(child).toLowerCase();
  const p = real(parent).toLowerCase();
  return c === p || c.startsWith(p + path.sep);
}

/** Throws unless both targets are safe. Run this before anything is created or deleted. */
export function assertSafeTestTargets(opts: { databaseUrl: string | undefined; storageRoot: string | undefined; repoRoot: string }): void {
  const { databaseUrl, storageRoot, repoRoot } = opts;
  if (!databaseUrl) throw new Error("Refusing to run tests: no test database is set.");
  const dbPath = sqlitePathFromUrl(databaseUrl, repoRoot);
  if (!dbPath) throw new Error(`Refusing to run tests: "${databaseUrl}" is not a SQLite file URL.`);
  const liveDb = path.join(repoRoot, "data", "app.db");
  if (real(dbPath).toLowerCase() === real(liveDb).toLowerCase() || (path.basename(dbPath).toLowerCase() === "app.db" && real(path.dirname(dbPath)).toLowerCase() === real(path.dirname(liveDb)).toLowerCase())) {
    throw new Error(
      `Refusing to run tests: the database is ${liveDb}, her live database. Tests use their own throwaway database and must never be pointed at data/app.db.`,
    );
  }
  if (!storageRoot) throw new Error("Refusing to run tests: no test storage folder is set.");
  if (sameOrInside(storageRoot, path.join(repoRoot, "storage"))) {
    throw new Error(
      `Refusing to run tests: the document storage is ${storageRoot}, her live storage/ folder. Tests use their own throwaway storage and must never be pointed at it.`,
    );
  }
}
