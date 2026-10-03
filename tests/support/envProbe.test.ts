import { describe, it, expect } from "vitest";
import path from "node:path";
import { sqlitePathFromUrl } from "./liveGuard";

/**
 * D177 — runs in the normal suite AND is what the guard test starts as a child
 * run: inside any test, the app must be pointed at the throwaway database and
 * document folder, never her live ones.
 */
describe("test environment (D177)", () => {
  it("uses a throwaway database, not data/app.db", () => {
    const db = sqlitePathFromUrl(process.env.DATABASE_URL ?? "", process.cwd());
    expect(db).not.toBeNull();
    expect(path.resolve(db!)).not.toBe(path.resolve(process.cwd(), "data", "app.db"));
    expect(db!).toContain(`${path.sep}test-run${path.sep}`);
  });

  it("uses a throwaway document folder, not storage/", () => {
    const root = path.resolve(process.env.BIR_STORAGE_ROOT ?? "");
    expect(root).not.toBe(path.resolve(process.cwd(), "storage"));
    expect(root).toContain(`${path.sep}test-run${path.sep}`);
  });
});
