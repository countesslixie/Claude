import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { assertSafeTestTargets } from "./support/liveGuard";

/**
 * D177 — runs at the top of every test file, before it imports the app.
 * Gives this file its own private copy of the freshly seeded template database
 * and document folder, and points the app at them. DATABASE_URL is set here, so
 * Prisma never falls back to the one in .env (which names data/app.db).
 */
const template = process.env.BIR_TEST_TEMPLATE_DB;
const templateStorage = process.env.BIR_TEST_TEMPLATE_STORAGE;
const runDir = process.env.BIR_TEST_RUN_DIR;
if (!template || !templateStorage || !runDir) {
  throw new Error("Refusing to run tests: the test database was not prepared (tests/globalSetup.ts did not run).");
}

const mine = path.join(runDir, `f-${randomBytes(6).toString("hex")}`);
const dbFile = path.join(mine, "app.db");
const storage = path.join(mine, "storage");
const databaseUrl = `file:${dbFile.replace(/\\/g, "/")}`;

assertSafeTestTargets({ databaseUrl, storageRoot: storage, repoRoot: process.cwd() });

fs.mkdirSync(mine, { recursive: true });
fs.copyFileSync(template, dbFile);
fs.cpSync(templateStorage, storage, { recursive: true });

process.env.DATABASE_URL = databaseUrl;
process.env.BIR_STORAGE_ROOT = storage;
