import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { nextActionForFiling } from "@/lib/workflow/groups";
import { filingOrderBlockReason, type FilingOrderContext } from "@/lib/workflow/filingOrder";
import { renameSawtSteps, backfillFilingStatuses } from "@/prisma/backfills";

/**
 * Brief #5n Part 5 (D82) — the seed builds eight labelled scenarios through
 * the app's own actions, runs cleanly twice in a row on a fresh database,
 * and leaves no half-worked overdue filing behind. Runs in child processes
 * against a throwaway database file so it never touches data/app.db and
 * never reads the database the rest of the suite uses (D5 — tax tests
 * still never read seed data; this is a seed test, not a tax test).
 */
// D177 — its own database AND document folder in the system temp directory: never data/ or storage/.
const SCRATCH = mkdtempSync(path.join(tmpdir(), "bir-seed-test-"));
const DB_FILE = path.join(SCRATCH, "seed.db");
const DB_URL = `file:${DB_FILE.replace(/\\/g, "/")}`;
const env = { ...process.env, DATABASE_URL: DB_URL, BIR_STORAGE_ROOT: path.join(SCRATCH, "storage") };

let firstRunOutput = "";
let secondRunOutput = "";
let db: PrismaClient;

function cleanup() {
  rmSync(SCRATCH, { recursive: true, force: true });
}

describe("seed scenarios (D82)", () => {
  beforeAll(() => {
    execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
    firstRunOutput = execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" }).toString();
    secondRunOutput = execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" }).toString();
    db = new PrismaClient({ datasources: { db: { url: DB_URL } } });
  }, 240_000);

  afterAll(async () => {
    await db?.$disconnect();
    cleanup();
  });

  const filingWithSteps = (clientCode: string, period: "Q1" | "Q2" | "Q3" | "ANNUAL") =>
    db.filing.findFirstOrThrow({
      where: { client: { code: clientCode }, taxableYear: 2026, period },
      include: { workflowSteps: true },
    });
  const statusOf = (f: { workflowSteps: { stepCode: string; status: string }[] }, code: string) =>
    f.workflowSteps.find((s) => s.stepCode === code)?.status;
  const daysWaiting = (f: { workflowSteps: { stepCode: string; waitingSince: Date | null }[] }, code: string) => {
    const since = f.workflowSteps.find((s) => s.stepCode === code)?.waitingSince;
    return since ? Math.floor((Date.now() - since.getTime()) / 86_400_000) : null;
  };

  it("runs cleanly twice in a row — the second run leaves the samples alone", () => {
    expect(firstRunOutput).toContain("Seed complete.");
    expect(secondRunOutput).toContain("Seed complete.");
    expect(secondRunOutput).toContain("already present");
  });

  it("creates eight clients, each with a one-line scenario in Notes", async () => {
    const clients = await db.client.findMany();
    expect(clients).toHaveLength(8);
    expect(clients.every((c) => c.notes?.startsWith("Sample "))).toBe(true);
  });

  it("keeps the TaxRuleSet, Holiday and ATC seeding, with WI010/WI011 still unverified (D19)", async () => {
    expect(await db.taxRuleSet.count()).toBeGreaterThanOrEqual(2);
    expect(await db.holiday.count()).toBeGreaterThan(0);
    const atc = await db.atcCode.findMany({ where: { code: { in: ["WI010", "WI011"] } } });
    expect(atc).toHaveLength(2);
    expect(atc.every((a) => a.verifiedAgainstIssuance === false)).toBe(true);
  });

  it("every past-due filing is Complete — none half-worked", async () => {
    const overdueIncomplete = await db.filing.findMany({
      where: { adjustedDueDate: { lt: new Date() }, status: { not: "COMPLETE" } },
    });
    expect(overdueIncomplete).toEqual([]);
    expect(await db.filing.count({ where: { status: "BLOCKED" } })).toBe(0);
  });

  it("A: Q1 and Q2 complete in the app, Q3 not started", async () => {
    for (const p of ["Q1", "Q2"] as const) expect((await filingWithSteps("villamor-e", p)).status).toBe("COMPLETE");
    expect((await filingWithSteps("villamor-e", "Q3")).status).toBe("NOT_STARTED");
  });

  it("B: only Q3 and Annual exist, Q1/Q2 absent", async () => {
    const filings = await db.filing.findMany({ where: { client: { code: "pangilinan-a" } } });
    expect(filings.map((f) => f.period).sort()).toEqual(["ANNUAL", "Q3"]);
  });

  it("C: no starting figures and no filings", async () => {
    expect(await db.filing.count({ where: { client: { code: "lacson-b" } } })).toBe(0);
    expect(await db.startingFigures.count({ where: { client: { code: "lacson-b" } } })).toBe(0);
  });

  it("D: filed and paid with proof, TRRC waiting about 2 days, eAFS steps untouched and live", async () => {
    const f = await filingWithSteps("mendoza-c", "Q3");
    for (const code of ["FILE_RETURN", "SAVE_SUBMISSION_SS", "SAVE_FORM_COPY", "MAKE_PAYMENT", "SAVE_PROOF_PAYMENT"]) {
      expect(statusOf(f, code)).toBe("DONE");
    }
    expect(statusOf(f, "RECEIVE_TRRC")).toBe("WAITING_EXTERNAL");
    expect(daysWaiting(f, "RECEIVE_TRRC")).toBe(2);
    for (const code of ["ALPHALIST_ENTRY", "EMAIL_DAT", "SAWT_ACK", "EAFS_SUBMIT"]) expect(statusOf(f, code)).toBe("PENDING");
    expect(f.amountPaidCents).toBeGreaterThan(0);
    expect(await db.form2307.count({ where: { claimedOnFilingId: f.id } })).toBeGreaterThan(0);
  });

  it("E: overpayment — steps 8 and 9 went NA through the real filing path, and Q3 comes to ₱8,200.00", async () => {
    const f = await filingWithSteps("garcia-r", "Q3");
    expect(statusOf(f, "FILE_RETURN")).toBe("DONE");
    expect(statusOf(f, "MAKE_PAYMENT")).toBe("NA");
    expect(statusOf(f, "SAVE_PROOF_PAYMENT")).toBe("NA");
    expect(f.amountPaidCents).toBeNull();
    expect(firstRunOutput).toContain("Rosario Garcia TY2026 Q3 overpayment: ₱8,200.00");
    for (const code of ["ALPHALIST_ENTRY", "EMAIL_DAT", "SAWT_ACK", "SAWT_VALIDATION"]) expect(statusOf(f, code)).toBe("NA");
    expect(statusOf(f, "EAFS_SUBMIT")).toBe("NA"); // D93: no certificate -> the whole eAFS group is NA
  });

  it("F: step 5 done, steps 6/7 not saved, TRRC waiting", async () => {
    const f = await filingWithSteps("ocampo-f", "Q3");
    expect(statusOf(f, "FILE_RETURN")).toBe("DONE");
    expect(statusOf(f, "SAVE_SUBMISSION_SS")).toBe("PENDING");
    expect(statusOf(f, "SAVE_FORM_COPY")).toBe("PENDING");
    expect(statusOf(f, "RECEIVE_TRRC")).toBe("WAITING_EXTERNAL");
    for (const code of ["ALPHALIST_ENTRY", "EMAIL_DAT", "SAWT_ACK", "EAFS_SUBMIT"]) expect(statusOf(f, code)).toBe("PENDING"); // has a certificate; locked until Pay is done
  });

  it("G: everything of hers done including eAFS, TRRC waiting about 8 days, validation waiting", async () => {
    const f = await filingWithSteps("tolentino-g", "Q3");
    for (const code of ["ALPHALIST_ENTRY", "EMAIL_DAT", "SAWT_ACK", "EAFS_SUBMIT", "MAKE_PAYMENT", "SAVE_PROOF_PAYMENT"]) {
      expect(statusOf(f, code)).toBe("DONE");
    }
    expect(statusOf(f, "RECEIVE_TRRC")).toBe("WAITING_EXTERNAL");
    expect(daysWaiting(f, "RECEIVE_TRRC")).toBe(8);
    expect(statusOf(f, "SAWT_VALIDATION")).toBe("WAITING_EXTERNAL");
    // seeded through the real path: step 12's draft was saved when it was marked Done, and both returns are frozen (D83)
    expect(f.dataEmailSubject).toMatch(/^SAWT 1701Q 09302026 GLORIA TOLENTINO \d{12}$/);
    expect(f.computationSnapshot).not.toBeNull();
    expect(f.filedAt).not.toBeNull();
  });

  it("every filed sample return has a frozen snapshot", async () => {
    const filed = await db.filing.findMany({ where: { workflowSteps: { some: { stepCode: "FILE_RETURN", status: "DONE" } } } });
    expect(filed.length).toBeGreaterThan(0);
    expect(filed.every((f) => f.computationSnapshot != null && f.filedAt != null)).toBe(true);
  });

  it("H: the mixed-income sample has an Annual filing only, not started", async () => {
    const filings = await db.filing.findMany({ where: { client: { code: "navarro-e" } }, include: { client: true } });
    expect(filings.map((f) => f.period)).toEqual(["ANNUAL"]);
    expect(filings[0].status).toBe("NOT_STARTED");
    expect(filings[0].client.taxpayerType).toBe("MIXED_INCOME");
  });

  it("seeded documents are placeholder files marked SAMPLE, with a SHA-256", async () => {
    const docs = await db.document.findMany({ where: { notes: null } });
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.every((d) => d.originalFilename.startsWith("SAMPLE_"))).toBe(true);
    expect(docs.every((d) => /^[0-9a-f]{64}$/.test(d.sha256))).toBe(true);
  });

  // ---- brief #5q ------------------------------------------------------------

  it("D97: every sample filing's status pill agrees with Next — Waiting on BIR exactly when nothing of hers is left", async () => {
    const filings = await db.filing.findMany({ include: { workflowSteps: true } });
    expect(filings.length).toBeGreaterThan(0);
    for (const f of filings) {
      if (f.status === "COMPLETE" || f.status === "BLOCKED") continue;
      const next = nextActionForFiling(f.workflowSteps);
      expect(f.status === "WAITING_BIR", `${f.clientId} ${f.period}`).toBe(next.kind === "birWait");
    }
  });

  it("D97: D and F read In progress with their TRRC still waiting; E and G read Waiting on BIR", async () => {
    for (const [code, expected] of [
      ["mendoza-c", "IN_PROGRESS"],
      ["ocampo-f", "IN_PROGRESS"],
      ["garcia-r", "WAITING_BIR"],
      ["tolentino-g", "WAITING_BIR"],
    ] as const) {
      const f = await filingWithSteps(code, "Q3");
      expect(f.status, code).toBe(expected);
    }
    expect(statusOf(await filingWithSteps("mendoza-c", "Q3"), "RECEIVE_TRRC")).toBe("WAITING_EXTERNAL");
    expect(statusOf(await filingWithSteps("ocampo-f", "Q3"), "RECEIVE_TRRC")).toBe("WAITING_EXTERNAL");
  });

  it("D97 backfill: a row still reading Waiting on BIR while her work remains is corrected, and a second run changes nothing", async () => {
    const f = await filingWithSteps("mendoza-c", "Q3");
    await db.filing.update({ where: { id: f.id }, data: { status: "WAITING_BIR" } });
    await backfillFilingStatuses(db);
    expect((await db.filing.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("IN_PROGRESS");
    await backfillFilingStatuses(db);
    expect((await db.filing.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("IN_PROGRESS");
  });

  it("D96: steps 13 and 14 carry the SAWT names; the backfill renames old titles and is safe to run twice", async () => {
    const g = await filingWithSteps("tolentino-g", "Q3");
    expect(g.workflowSteps.find((x) => x.stepCode === "SAWT_ACK")!.title).toBe("Save SAWT acknowledgement email");
    expect(g.workflowSteps.find((x) => x.stepCode === "SAWT_VALIDATION")!.title).toBe("Save SAWT validation email");
    await db.workflowStep.updateMany({ where: { stepCode: "SAWT_ACK" }, data: { title: "Receive & save acknowledgement email" } });
    await db.workflowStep.updateMany({ where: { stepCode: "SAWT_VALIDATION" }, data: { title: "Save eAFS validation email" } });
    await renameSawtSteps(db);
    await renameSawtSteps(db);
    expect(await db.workflowStep.count({ where: { stepCode: "SAWT_ACK", title: { not: "Save SAWT acknowledgement email" } } })).toBe(0);
    expect(await db.workflowStep.count({ where: { stepCode: "SAWT_VALIDATION", title: { not: "Save SAWT validation email" } } })).toBe(0);
  });

  it("D95: no sample scenario files out of order; B's Annual is held by Q3, A's Q3 and E's Q3 are not held", async () => {
    const filings = await db.filing.findMany({ include: { workflowSteps: true, client: { include: { startingFigures: true } } } });
    const ctxFor = (f: (typeof filings)[number]): FilingOrderContext => ({
      taxableYear: f.taxableYear,
      period: f.period,
      siblings: filings
        .filter((x) => x.clientId === f.clientId && x.taxableYear === f.taxableYear)
        .map((x) => ({ period: x.period, filedOutsideApp: x.filedOutsideApp, fileReturnStatus: x.workflowSteps.find((s) => s.stepCode === "FILE_RETURN")?.status ?? null })),
      latestOutsideReturn: f.client.startingFigures.find((sf) => sf.taxableYear === f.taxableYear)?.latestOutsideReturn ?? "NONE",
    });
    for (const f of filings) {
      if (f.workflowSteps.find((s) => s.stepCode === "FILE_RETURN")?.status !== "DONE") continue;
      expect(filingOrderBlockReason(ctxFor(f)), `${f.client.code} ${f.period} is filed but an earlier return isn't`).toBeNull();
    }
    const at = (code: string, period: string) => filings.find((f) => f.client.code === code && f.period === period)!;
    expect(filingOrderBlockReason(ctxFor(at("pangilinan-a", "ANNUAL")))).toBe("File Q3 2026 first.");
    expect(filingOrderBlockReason(ctxFor(at("villamor-e", "Q3")))).toBeNull();
    expect(filingOrderBlockReason(ctxFor(at("garcia-r", "Q3")))).toBeNull();
  });
});
