import { describe, it, expect, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { saveBirLogins } from "@/lib/actions/birLogins";
import { SETTINGS } from "@/components/nav";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/** D180 — the BIR Logins page. Every name, username and password here is made up. */
const ids: string[] = [];
async function makeClient(name: string, isActive = true) {
  const c = await prisma.client.create({
    data: {
      code: `bl-${Math.random().toString(36).slice(2, 8)}`,
      registeredName: name,
      tin: "000111222",
      rdoCode: "000",
      registeredAddress: "N/A",
      taxpayerType: "PURELY_SELF_EMPLOYED",
      booksType: "MANUAL",
      isActive,
    },
  });
  ids.push(c.id);
  return c;
}
const empty = { eafsUsername: "", eafsPassword: "", alphalistUsername: "", alphalistPassword: "", orusUsername: "", orusPassword: "" };

afterAll(async () => {
  await prisma.clientBirLogin.deleteMany({ where: { clientId: { in: ids } } });
  await prisma.client.deleteMany({ where: { id: { in: ids } } });
});

describe("saving, editing and clearing", () => {
  it("saves all six fields (eAFS, Alphalist, ORUS), edits one, clears one", async () => {
    const c = await makeClient("Zed Login Test");
    const r = await saveBirLogins(c.id, {
      eafsUsername: "fake.eafs", eafsPassword: "pw-one",
      alphalistUsername: "fake.alpha", alphalistPassword: "pw-two",
      orusUsername: "fake.orus", orusPassword: "pw-three",
    });
    expect(r).toEqual({ ok: true });
    let row = await prisma.clientBirLogin.findUniqueOrThrow({ where: { clientId: c.id } });
    expect(row).toMatchObject({ eafsUsername: "fake.eafs", eafsPassword: "pw-one", alphalistUsername: "fake.alpha", alphalistPassword: "pw-two", orusUsername: "fake.orus", orusPassword: "pw-three" });

    await saveBirLogins(c.id, { eafsUsername: "fake.eafs", eafsPassword: "changed", alphalistUsername: "fake.alpha", alphalistPassword: "pw-two", orusUsername: "fake.orus", orusPassword: "" });
    row = await prisma.clientBirLogin.findUniqueOrThrow({ where: { clientId: c.id } });
    expect(row.eafsPassword).toBe("changed");
    expect(row.orusPassword).toBeNull();
    expect(row.orusUsername).toBe("fake.orus");
    expect(await prisma.clientBirLogin.count({ where: { clientId: c.id } })).toBe(1); // one row, updated
  });

  it("clears every field one at a time", async () => {
    const c = await makeClient("Clear Each Test");
    const all = { eafsUsername: "a", eafsPassword: "b", alphalistUsername: "c", alphalistPassword: "d", orusUsername: "e", orusPassword: "f" };
    await saveBirLogins(c.id, all);
    for (const k of Object.keys(all) as (keyof typeof all)[]) {
      await saveBirLogins(c.id, { ...all, [k]: "" });
      const row = await prisma.clientBirLogin.findUniqueOrThrow({ where: { clientId: c.id } });
      expect(row[k]).toBeNull();
      await saveBirLogins(c.id, all);
    }
  });

  it("saving leaves the old notes columns exactly as they were", async () => {
    const c = await makeClient("Old Notes Test");
    await prisma.clientBirLogin.create({ data: { clientId: c.id, eafsNotes: "kept note one", alphalistNotes: "kept note two", eafsUsername: "x" } });
    await saveBirLogins(c.id, { ...empty, eafsUsername: "new.user", orusPassword: "p" });
    const row = await prisma.clientBirLogin.findUniqueOrThrow({ where: { clientId: c.id } });
    expect(row.eafsNotes).toBe("kept note one");
    expect(row.alphalistNotes).toBe("kept note two");
    expect(row.eafsUsername).toBe("new.user");
  });

  it("keeps special characters in a password exactly, trimming only the ends", async () => {
    const c = await makeClient("Special Char Test");
    const pw = `p@ss "w0rd" 'x' \\ <b>&amp; %20 #? é 漢  mid  space`;
    await saveBirLogins(c.id, { ...empty, eafsPassword: `   ${pw}\t \n`, orusPassword: pw });
    const row = await prisma.clientBirLogin.findUniqueOrThrow({ where: { clientId: c.id } });
    expect(row.eafsPassword).toBe(pw);
    expect(row.orusPassword).toBe(pw);
  });

  it("validates: too long is refused with a message that does not echo the value", async () => {
    const c = await makeClient("Too Long Test");
    const secret = "S".repeat(201);
    const r = await saveBirLogins(c.id, { ...empty, eafsPassword: secret });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(secret);
    expect(await prisma.clientBirLogin.count({ where: { clientId: c.id } })).toBe(0);
  });

  it("refuses an unknown client", async () => {
    expect((await saveBirLogins("nope", empty)).ok).toBe(false);
  });
});

describe("the activity log never holds a login value", () => {
  it("records only a plain note", async () => {
    const c = await makeClient("Log Check Test");
    const vals = { eafsUsername: "uniq-user-7731", eafsPassword: "uniq-pass-7731", alphalistUsername: "uniq-user-8842", alphalistPassword: "uniq-pass-8842", orusUsername: "uniq-user-6620", orusPassword: "uniq-pass-6620" };
    await saveBirLogins(c.id, vals);
    await saveBirLogins(c.id, { ...vals, eafsPassword: "uniq-pass-9955" });
    const rows = await prisma.activityLog.findMany({ where: { entityType: "ClientBirLogin", entityId: c.id } });
    expect(rows).toHaveLength(2);
    const dump = JSON.stringify(rows);
    expect(dump).not.toMatch(/uniq-(user|pass)-/);
    for (const r of rows) {
      expect(r.beforeJson).toBeNull();
      expect(r.afterJson).toBeNull();
      expect(r.note).toBe("BIR logins updated for Log Check Test");
    }
  });
});

describe("the page", () => {
  const page = fs.readFileSync(path.join(process.cwd(), "app/(app)/settings/bir-logins/page.tsx"), "utf8");
  it("exports force-dynamic, lists active clients only, sorted by name", () => {
    expect(page).toMatch(/export const dynamic = "force-dynamic"/);
    expect(page).toMatch(/where: \{ isActive: true \}/);
    expect(page).toMatch(/localeCompare/);
  });
  it("the table has no Notes and no Copy, and shows ORUS", () => {
    const table = fs.readFileSync(path.join(process.cwd(), "components/bir-logins-table.tsx"), "utf8");
    expect(table).not.toMatch(/notes|clipboard|>\s*Copy|Copy</i);
    expect(table).toContain('title: "ORUS"');
    expect(page).not.toMatch(/notes/i);
  });
  it("uses the Dashboard's container width and nothing on the table wraps (D182)", () => {
    const dash = fs.readFileSync(path.join(process.cwd(), "app/(app)/page.tsx"), "utf8");
    const dashWidth = dash.match(/max-w-\[\d+px\]/)?.[0];
    expect(dashWidth).toBeTruthy();
    expect(page).toContain(dashWidth!);
    const table = fs.readFileSync(path.join(process.cwd(), "components/bir-logins-table.tsx"), "utf8");
    const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    const rule = css.slice(css.indexOf("table.data-table.data-table-tight {"), css.indexOf("}", css.indexOf("table.data-table.data-table-tight {")));
    expect(rule).toContain("white-space: nowrap");
    expect(table).not.toMatch(/break-all|break-words|overflow-wrap/);
    expect(table).toContain("data-table-tight");
    expect(table).toMatch(/overflow-x-auto rounded-lg/); // the card scrolls, not the page
    // the button column's header matches the Client cell: both span the two header rows
    expect(table.match(/<th rowSpan=\{2\}/g)).toHaveLength(2);
  });
  it("the query it runs returns active clients only", async () => {
    const a = await makeClient("Active Zed Page");
    const b = await makeClient("Inactive Zed Page", false);
    const listed = await prisma.client.findMany({ where: { isActive: true }, select: { id: true } });
    expect(listed.map((x) => x.id)).toContain(a.id);
    expect(listed.map((x) => x.id)).not.toContain(b.id);
  });
  it("is in the Settings menu and on the hub, with Back and no export of values", () => {
    expect(SETTINGS.map((l) => l.label)).toEqual(["Tax Rules", "ATC", "Holidays", "BIR Logins"]);
    expect(SETTINGS[3].href).toBe("/settings/bir-logins");
    expect(fs.readFileSync(path.join(process.cwd(), "app/(app)/settings/page.tsx"), "utf8")).toContain("/settings/bir-logins");
    expect(page).toContain("BackToSettings");
  });
});

describe("kept out of everywhere else", () => {
  it("no backup/package/export/log code reads the logins table", () => {
    const files = ["lib/backup/createBackup.ts", "lib/documents/filingPackage.ts", "lib/workflow/clientPackageEmail.ts", "lib/sawt"];
    for (const f of files) {
      const full = path.join(process.cwd(), f);
      const list = fs.statSync(full).isDirectory() ? fs.readdirSync(full).map((x) => path.join(full, x)) : [full];
      for (const file of list) expect(fs.readFileSync(file, "utf8")).not.toMatch(/birLogin|BirLogin/i);
    }
    expect(fs.readFileSync(path.join(process.cwd(), "lib/actions/birLogins.ts"), "utf8")).not.toMatch(/console\./);
  });
});
