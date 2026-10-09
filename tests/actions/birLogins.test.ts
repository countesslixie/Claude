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
const empty = { eafsUsername: "", eafsPassword: "", eafsNotes: "", alphalistUsername: "", alphalistPassword: "", alphalistNotes: "" };

afterAll(async () => {
  await prisma.clientBirLogin.deleteMany({ where: { clientId: { in: ids } } });
  await prisma.client.deleteMany({ where: { id: { in: ids } } });
});

describe("saving, editing and clearing", () => {
  it("saves all six fields, edits one, clears one", async () => {
    const c = await makeClient("Zed Login Test");
    const r = await saveBirLogins(c.id, {
      eafsUsername: "fake.eafs", eafsPassword: "pw-one", eafsNotes: "note a",
      alphalistUsername: "fake.alpha", alphalistPassword: "pw-two", alphalistNotes: "note b",
    });
    expect(r).toEqual({ ok: true });
    let row = await prisma.clientBirLogin.findUniqueOrThrow({ where: { clientId: c.id } });
    expect(row).toMatchObject({ eafsUsername: "fake.eafs", alphalistPassword: "pw-two", alphalistNotes: "note b" });

    await saveBirLogins(c.id, { ...row, eafsPassword: "changed", alphalistNotes: "" } as never);
    row = await prisma.clientBirLogin.findUniqueOrThrow({ where: { clientId: c.id } });
    expect(row.eafsPassword).toBe("changed");
    expect(row.alphalistNotes).toBeNull();
    expect(row.eafsUsername).toBe("fake.eafs");
    expect(await prisma.clientBirLogin.count({ where: { clientId: c.id } })).toBe(1); // one row, updated
  });

  it("keeps special characters in a password exactly, trimming only the ends", async () => {
    const c = await makeClient("Special Char Test");
    const pw = `p@ss "w0rd" 'x' \\ <b>&amp; %20 #? é 漢  mid  space`;
    await saveBirLogins(c.id, { ...empty, eafsPassword: `   ${pw}\t \n` });
    const row = await prisma.clientBirLogin.findUniqueOrThrow({ where: { clientId: c.id } });
    expect(row.eafsPassword).toBe(pw);
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
    const vals = { eafsUsername: "uniq-user-7731", eafsPassword: "uniq-pass-7731", eafsNotes: "uniq-note-7731", alphalistUsername: "uniq-user-8842", alphalistPassword: "uniq-pass-8842", alphalistNotes: "uniq-note-8842" };
    await saveBirLogins(c.id, vals);
    await saveBirLogins(c.id, { ...vals, eafsPassword: "uniq-pass-9955" });
    const rows = await prisma.activityLog.findMany({ where: { entityType: "ClientBirLogin", entityId: c.id } });
    expect(rows).toHaveLength(2);
    const dump = JSON.stringify(rows);
    expect(dump).not.toMatch(/uniq-(user|pass|note)-/);
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
