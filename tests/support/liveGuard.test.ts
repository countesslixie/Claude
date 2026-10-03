import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { assertSafeTestTargets, sqlitePathFromUrl } from "./liveGuard";

/**
 * D177 — the guard that keeps the test run away from her live database and
 * document vault: first as a plain function, then for real, by starting a
 * second test run and checking it refuses before any test executes.
 */
const repoRoot = process.cwd();
const runRoot = path.join(repoRoot, "data", "test-run");
const OK_DB = "file:/tmp/some-throwaway/app.db";
const OK_STORAGE = path.join("/tmp", "some-throwaway", "storage");

describe("assertSafeTestTargets", () => {
  it("accepts a throwaway database and storage", () => {
    expect(() => assertSafeTestTargets({ databaseUrl: OK_DB, storageRoot: OK_STORAGE, repoRoot })).not.toThrow();
  });

  it("refuses data/app.db however the URL is written", () => {
    for (const url of ["file:../data/app.db", `file:${path.join(repoRoot, "data", "app.db")}`, "file:../data/app.db?connection_limit=1"]) {
      expect(() => assertSafeTestTargets({ databaseUrl: url, storageRoot: OK_STORAGE, repoRoot }), url).toThrow(/live database/);
    }
  });

  it("refuses the real storage/ folder and anything inside it", () => {
    for (const s of [path.join(repoRoot, "storage"), path.join(repoRoot, "storage", "garcia-r")]) {
      expect(() => assertSafeTestTargets({ databaseUrl: OK_DB, storageRoot: s, repoRoot })).toThrow(/live storage/);
    }
  });

  it("refuses a missing or non-SQLite target", () => {
    expect(() => assertSafeTestTargets({ databaseUrl: undefined, storageRoot: OK_STORAGE, repoRoot })).toThrow();
    expect(() => assertSafeTestTargets({ databaseUrl: "postgres://x", storageRoot: OK_STORAGE, repoRoot })).toThrow();
    expect(() => assertSafeTestTargets({ databaseUrl: OK_DB, storageRoot: undefined, repoRoot })).toThrow();
  });

  it("resolves a relative file: URL against prisma/ the way Prisma does", () => {
    expect(sqlitePathFromUrl("file:../data/app.db", repoRoot)).toBe(path.join(repoRoot, "data", "app.db"));
  });
});

/** Start a second test run (just the probe file) with these environment changes. */
function childRun(extraEnv: Record<string, string>) {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  for (const k of ["BIR_TEST_RUN_DIR", "BIR_TEST_TEMPLATE_DB", "BIR_TEST_TEMPLATE_STORAGE", "BIR_STORAGE_ROOT", "TEST_DATABASE_URL", "TEST_STORAGE_ROOT"]) {
    if (!(k in extraEnv)) delete env[k];
  }
  if (!("DATABASE_URL" in extraEnv)) delete env.DATABASE_URL;
  const r = spawnSync("npx", ["vitest", "run", "tests/support/envProbe.test.ts"], { cwd: repoRoot, env, encoding: "utf8", shell: process.platform === "win32" });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const runDirs = () => (fs.existsSync(runRoot) ? fs.readdirSync(runRoot).sort() : []);

describe("the test run refuses to start against live data", () => {
  it("database URL = data/app.db: refuses before any test executes", () => {
    const before = runDirs();
    const { status, out } = childRun({ TEST_DATABASE_URL: "file:../data/app.db" });
    expect(status).not.toBe(0);
    expect(out).toMatch(/Refusing to run tests/);
    expect(out).toMatch(/live database/);
    expect(out).not.toMatch(/Tests\s+\d+ passed/); // no test executed
    expect(out).not.toMatch(/✓/);
    expect(runDirs()).toEqual(before); // nothing was even created
  }, 60_000);

  it("storage = the real storage/ folder: refuses before any test executes", () => {
    const before = runDirs();
    const { status, out } = childRun({ TEST_STORAGE_ROOT: path.join(repoRoot, "storage") });
    expect(status).not.toBe(0);
    expect(out).toMatch(/live storage/);
    expect(out).not.toMatch(/Tests\s+\d+ passed/);
    expect(runDirs()).toEqual(before);
  }, 60_000);

  it("an ambient DATABASE_URL (like the one in .env) is ignored: tests still use the throwaway database", () => {
    const { status, out } = childRun({ DATABASE_URL: "file:../data/app.db" });
    expect(out).toMatch(/Tests\s+2 passed/); // the probe asserts the database is NOT data/app.db
    expect(status).toBe(0);
  }, 180_000);
});
