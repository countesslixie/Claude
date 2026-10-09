import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { recordBackup } from "@/lib/backup/lastBackup";
import { runCleanStart, listStorageFiles, TABLES_EMPTIED, type CleanStartIo } from "@/lib/cleanStart/cleanStart";
import { testStorageRoot } from "@/tests/helpers/testEnv";

/**
 * D178 — the clean start, on this test file's own private copy of a seeded database
 * and its own storage folder (D177). Order matters: the refusals, the cancel and the
 * rollback change nothing; then the real script runs once; then the seed runs after it.
 */
const STORAGE = testStorageRoot();
const NOW = new Date("2026-10-03T06:30:00Z");

function io(answer: string) {
  const lines: string[] = [];
  const asked: string[] = [];
  const iface: CleanStartIo = {
    print: (l) => lines.push(l),
    ask: async (q) => {
      asked.push(q);
      return answer;
    },
  };
  return { iface, lines, asked, text: () => lines.join("\n") };
}

const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
async function snapshot() {
  const p = prisma as unknown as Record<string, { count(): Promise<number> }>;
  const tables: Record<string, number> = {};
  for (const t of TABLES_EMPTIED) tables[t] = await p[lower(t)].count();
  return {
    tables,
    activityLog: await prisma.activityLog.count(),
    files: listStorageFiles(STORAGE).sort(),
    ruleSets: await prisma.taxRuleSet.findMany({ orderBy: { taxableYear: "asc" } }),
    holidays: await prisma.holiday.findMany({ orderBy: { date: "asc" } }),
    atc: await prisma.atcCode.findMany({ orderBy: { code: "asc" } }),
    users: await prisma.user.findMany(),
    templates: await prisma.workflowStepTemplate.findMany({ orderBy: { id: "asc" } }),
  };
}

function runScript(args: string[], input: string, extraEnv: Record<string, string> = {}) {
  const r = spawnSync("npx", ["tsx", "scripts/clean-start.ts", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: "59871", ...extraEnv },
    input,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

afterAll(async () => {
  await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS block_client_delete");
});

describe("the clean start refuses and cancels without changing anything", () => {
  it("starts from a seeded database with documents on disk", async () => {
    const s = await snapshot();
    expect(s.tables.Client).toBeGreaterThan(0);
    expect(s.tables.Filing).toBeGreaterThan(0);
    expect(s.tables.Document).toBeGreaterThan(0);
    expect(s.files.length).toBeGreaterThan(0);
  });

  it("refuses with no backup at all, in plain words", async () => {
    const before = await snapshot();
    const t = io("DELETE");
    const r = await runCleanStart({ prisma, storageRoot: STORAGE, io: t.iface, now: NOW, appPort: null });
    expect(r).toEqual({ status: "refused", reason: "no-recent-backup" });
    expect(t.text()).toContain("Please click Back up now on the Settings page first.");
    expect(t.asked).toHaveLength(0); // it did not even ask
    expect(await snapshot()).toEqual(before);
  });

  it("refuses when the last backup is more than 24 hours old", async () => {
    await recordBackup(new Date(NOW.getTime() - 25 * 3600 * 1000));
    const before = await snapshot();
    const t = io("DELETE");
    const r = await runCleanStart({ prisma, storageRoot: STORAGE, io: t.iface, now: NOW, appPort: null });
    expect(r).toEqual({ status: "refused", reason: "no-recent-backup" });
    expect(await snapshot()).toEqual(before);
  });

  it("refuses while the app is answering on its port", async () => {
    await recordBackup(new Date(NOW.getTime() - 3600 * 1000));
    const before = await snapshot();
    const t = io("DELETE");
    const r = await runCleanStart({ prisma, storageRoot: STORAGE, io: t.iface, now: NOW, appPort: 3000, appIsAnswering: async () => true });
    expect(r).toEqual({ status: "refused", reason: "app-running" });
    expect(t.text()).toContain("close");
    expect(await snapshot()).toEqual(before);
  });

  it("anything other than DELETE cancels", async () => {
    const before = await snapshot();
    for (const answer of ["", "delete", "yes", "DELETE ME", "y"]) {
      const t = io(answer);
      const r = await runCleanStart({ prisma, storageRoot: STORAGE, io: t.iface, now: NOW, appPort: null });
      expect(r.status, JSON.stringify(answer)).toBe("cancelled");
      expect(t.text()).toContain("Cancelled. Nothing was changed.");
    }
    expect(await snapshot()).toEqual(before);
  });

  it("shows what it will delete and what it keeps before asking", async () => {
    const t = io("no");
    await runCleanStart({ prisma, storageRoot: STORAGE, io: t.iface, now: NOW, appPort: null });
    const text = t.text();
    for (const table of TABLES_EMPTIED) expect(text).toContain(table);
    expect(text).toMatch(/Files in storage\/\s+\d+/);
    for (const kept of ["TaxRuleSet", "Holiday", "AtcCode", "AppSetting", "User"]) expect(text).toContain(kept);
    expect(text).toContain("migrations table");
  });

  it("is all-or-nothing: a failure part-way rolls the database back and leaves every file", async () => {
    await recordBackup(new Date(NOW.getTime() - 3600 * 1000));
    const before = await snapshot();
    // The last table it empties (Client) refuses, after every other table was already emptied inside the transaction.
    await prisma.$executeRawUnsafe(
      "CREATE TRIGGER block_client_delete BEFORE DELETE ON Client BEGIN SELECT RAISE(ABORT, 'blocked for the test'); END",
    );
    const t = io("DELETE");
    try {
      // (Prisma reports a trigger's ABORT as a constraint violation.)
      await expect(runCleanStart({ prisma, storageRoot: STORAGE, io: t.iface, now: NOW, appPort: null })).rejects.toThrow(/Foreign key|constraint|blocked/);
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS block_client_delete");
    }
    expect(await snapshot()).toEqual(before);
    expect(await prisma.appSetting.findUnique({ where: { key: "samplesRemoved" } })).toBeNull();
  });

  it("the real script (npm run clean-start) refuses without a recent backup and cancels on wrong input", async () => {
    const before = await snapshot();
    await prisma.appSetting.deleteMany({ where: { key: "lastBackupAt" } });
    const refused = runScript([], "DELETE\n");
    expect(refused.status).toBe(1);
    expect(refused.out).toContain("Please click Back up now on the Settings page first.");

    await recordBackup(new Date());
    const cancelled = runScript([], "nope\n");
    expect(cancelled.status).toBe(0);
    expect(cancelled.out).toContain("Cancelled. Nothing was changed.");
    expect(cancelled.out).toMatch(/Files in storage\/\s+\d+/);
    const after = await snapshot();
    expect(after.tables).toEqual(before.tables);
    expect(after.files).toEqual(before.files);
  }, 120_000);
});

describe("a full run", () => {
  let before: Awaited<ReturnType<typeof snapshot>>;
  let run: { status: number | null; out: string };

  it("deletes everything that hangs off a client, and every file, and keeps the reference data", async () => {
    // Her own edits to reference data, and an audit row about it, must survive.
    await prisma.taxRuleSet.update({ where: { taxableYear: 2026 }, data: { notes: "hers, edited" } });
    const user = await prisma.user.findFirstOrThrow();
    await prisma.activityLog.create({ data: { entityType: "TaxRuleSet", entityId: "x", action: "UPDATE", actorId: user.id } });
    await prisma.appSetting.upsert({ where: { key: "lastBackupAt" }, update: { value: new Date().toISOString() }, create: { key: "lastBackupAt", value: new Date().toISOString() } });
    fs.writeFileSync(path.join(STORAGE, "Engagement Letter - Test.pdf"), "a loose file");
    // D180 — a client's BIR logins and the audit note about them go with the client.
    const someClient = await prisma.client.findFirstOrThrow();
    await prisma.clientBirLogin.create({ data: { clientId: someClient.id, eafsUsername: "fake-user", eafsPassword: "fake-pass", orusUsername: "fake-orus", orusPassword: "fake-orus-pw" } });
    await prisma.activityLog.create({ data: { entityType: "ClientBirLogin", entityId: someClient.id, action: "UPDATE", note: "BIR logins updated for X", actorId: user.id } });
    before = await snapshot();
    expect(before.tables.ClientBirLogin).toBe(1);
    expect(before.tables.Client).toBeGreaterThan(0);
    const lastBackup = await prisma.appSetting.findUniqueOrThrow({ where: { key: "lastBackupAt" } });

    run = runScript([], "DELETE\n");
    expect(run.status, run.out).toBe(0);

    const after = await snapshot();
    for (const t of TABLES_EMPTIED) expect(after.tables[t], t).toBe(0);
    expect(after.files).toEqual([]);
    expect(fs.existsSync(STORAGE)).toBe(true); // the folder stays
    // every kept table is exactly as it was
    expect(after.ruleSets).toEqual(before.ruleSets);
    expect(after.ruleSets.find((r) => r.taxableYear === 2026)!.notes).toBe("hers, edited");
    expect(after.holidays).toEqual(before.holidays);
    expect(after.atc).toEqual(before.atc);
    expect(after.users).toEqual(before.users);
    expect(after.templates).toEqual(before.templates);
    // the last-backup time is kept, the flag is set, the audit row about reference data stays
    expect((await prisma.appSetting.findUniqueOrThrow({ where: { key: "lastBackupAt" } })).value).toBe(lastBackup.value);
    expect((await prisma.appSetting.findUniqueOrThrow({ where: { key: "samplesRemoved" } })).value).toBe("true");
    expect(await prisma.activityLog.count({ where: { entityType: "TaxRuleSet" } })).toBe(1);
    expect(await prisma.activityLog.count({ where: { entityType: { in: ["Filing", "Document", "WorkflowStep", "QuarterlySales", "StartingFigures", "Form2307"] } } })).toBe(0);
    expect(await prisma.activityLog.count({ where: { entityType: "CleanStart" } })).toBe(1);
    expect(await prisma.clientBirLogin.count()).toBe(0);
    expect(await prisma.activityLog.count({ where: { entityType: "ClientBirLogin" } })).toBe(0);
    expect(run.out).toMatch(/ClientBirLogin\s+1/); // the plan names it
  }, 120_000);

  it("prints the plan first and a plain summary at the end", async () => {
    expect(run.out).toMatch(/PERMANENTLY DELETE/);
    expect(run.out).toMatch(/Type DELETE/);
    const rules = before.ruleSets.length, hol = before.holidays.length, atc = before.atc.length;
    expect(run.out).toContain(`Done. 0 clients, 0 filings, 0 documents. Kept: ${rules} rule sets, ${hol} holidays, ${atc} ATC codes.`);
  });

  it("the Clients, Dashboard and Kanban queries now come back empty", async () => {
    expect(await prisma.client.count()).toBe(0);
    expect(await prisma.filing.count({ where: { deletedAt: null } })).toBe(0);
  });
});

describe("the seed after a clean start (D178)", () => {
  function seed() {
    const r = spawnSync("npx", ["tsx", "prisma/seed.ts"], { cwd: process.cwd(), env: process.env, encoding: "utf8", shell: process.platform === "win32" });
    return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
  }

  it("adds no sample clients, and does not overwrite her reference data", async () => {
    const rulesBefore = await prisma.taxRuleSet.findMany({ orderBy: { taxableYear: "asc" } });
    const r = seed();
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("not adding them back");
    expect(await prisma.client.count()).toBe(0);
    expect(await prisma.filing.count()).toBe(0);
    expect(await prisma.document.count()).toBe(0);
    expect(listStorageFiles(STORAGE)).toEqual([]);
    expect(await prisma.taxRuleSet.findMany({ orderBy: { taxableYear: "asc" } })).toEqual(rulesBefore);
    expect((await prisma.taxRuleSet.findUniqueOrThrow({ where: { taxableYear: 2026 } })).notes).toBe("hers, edited");
  }, 120_000);

  it("still tops up reference data that is missing", async () => {
    const holiday = await prisma.holiday.findFirstOrThrow();
    await prisma.holiday.delete({ where: { id: holiday.id } });
    const count = await prisma.holiday.count();
    const r = seed();
    expect(r.status, r.out).toBe(0);
    expect(await prisma.holiday.count()).toBe(count + 1);
    expect(await prisma.client.count()).toBe(0);
  }, 120_000);

  it("never mixes samples into a database that holds real clients, even without the flag", async () => {
    await prisma.appSetting.delete({ where: { key: "samplesRemoved" } });
    await prisma.client.create({
      data: {
        code: "REAL-1",
        registeredName: "Real Person",
        tin: "000000000",
        rdoCode: "000",
        registeredAddress: "Somewhere",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    const r = seed();
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("already has real clients");
    expect(await prisma.client.count()).toBe(1);
    await prisma.client.deleteMany();
  }, 120_000);

  it("(control) without the flag and without real clients the seed does build the samples", async () => {
    const r = seed();
    expect(r.status, r.out).toBe(0);
    expect(await prisma.client.count()).toBe(8);
  }, 180_000);
});
