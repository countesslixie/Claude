import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * D175 — every page that reads the database is always-dynamic, so a production
 * build can never freeze it into static HTML.
 */
function pages(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? pages(full) : e.name === "page.tsx" ? [full] : [];
  });
}

describe("pages that read the database are never prerendered (D175)", () => {
  const all = pages(path.join(process.cwd(), "app")).filter((f) => !f.includes(`${path.sep}login${path.sep}`));
  it("finds the app's pages", () => expect(all.length).toBeGreaterThan(20));
  for (const f of all) {
    it(`${path.relative(process.cwd(), f)} is force-dynamic`, () => {
      expect(fs.readFileSync(f, "utf8")).toMatch(/export const dynamic = "force-dynamic"/);
    });
  }
});
