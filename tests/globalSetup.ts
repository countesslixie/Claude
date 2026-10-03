import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { assertSafeTestTargets, sqlitePathFromUrl } from "./support/liveGuard";

/**
 * D177 — runs once, before any test file. Builds a throwaway, freshly seeded
 * database and document folder under data/test-run/<run>/ and tells the test
 * files where they are. Every test file then works on its own private COPY
 * (tests/setupEnv.ts), so files running in parallel can't see each other's rows.
 * Her real data/app.db and storage/ are never opened.
 *
 * The only override is TEST_DATABASE_URL / TEST_STORAGE_ROOT — used by the test
 * that proves the guard fires. The guard runs first, before anything is created.
 */
const repoRoot = process.cwd();

export default function setup() {
  const runDir = path.join(repoRoot, "data", "test-run", `${process.pid}-${Date.now()}`);
  const templateUrl = process.env.TEST_DATABASE_URL ?? `file:${path.join(runDir, "template.db").replace(/\\/g, "/")}`;
  const templateStorage = process.env.TEST_STORAGE_ROOT ?? path.join(runDir, "template-storage");

  // 1. Guard first: nothing is created, deleted or opened until both targets are proven safe.
  assertSafeTestTargets({ databaseUrl: templateUrl, storageRoot: templateStorage, repoRoot });

  // Clear leftovers of crashed earlier runs (only inside data/test-run/).
  const root = path.join(repoRoot, "data", "test-run");
  if (fs.existsSync(root)) {
    for (const d of fs.readdirSync(root)) {
      const full = path.join(root, d);
      if (Date.now() - fs.statSync(full).mtimeMs > 6 * 60 * 60 * 1000) fs.rmSync(full, { recursive: true, force: true });
    }
  }
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(templateStorage, { recursive: true });

  // The template is brand new: refuse to build on top of an existing database file.
  const templateFile = sqlitePathFromUrl(templateUrl, repoRoot)!; // resolved the way Prisma resolves it
  if (fs.existsSync(templateFile)) throw new Error(`Refusing to run tests: ${templateFile} already exists.`);

  const env = { ...process.env, DATABASE_URL: templateUrl, BIR_STORAGE_ROOT: templateStorage };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });

  process.env.BIR_TEST_RUN_DIR = runDir;
  process.env.BIR_TEST_TEMPLATE_DB = templateFile;
  process.env.BIR_TEST_TEMPLATE_STORAGE = templateStorage;

  return function teardown() {
    fs.rmSync(runDir, { recursive: true, force: true });
    try {
      fs.rmdirSync(path.join(repoRoot, "data", "test-run")); // only if empty
    } catch {
      /* another run is still using it */
    }
  };
}
