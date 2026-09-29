import { describe, it, expect, afterAll, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { rm } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { saveQuarterlySales } from "@/lib/actions/quarterlySales";
import { updateFilingOtherCredits, savePayment } from "@/lib/actions/filings";
import { uploadDocument } from "@/lib/actions/documents";
import { markStepDone, skipStep } from "@/lib/actions/workflowSteps";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";
import { getFilingSheet, checkAndRecordAmendments, assembleAndComputeFiling } from "@/lib/filingComputation";
import { ensureComputationSheetSaved } from "@/lib/documents/computationSheet";
import { buildLiveAdviceMessageForFiling } from "@/lib/workflow/adviceMessage";
import { changedItems } from "@/lib/tax/amendment";
import type { FilingComputationResult } from "@/lib/tax/types";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * D83 (brief #5o) — locked rule #3 / D6, finally implemented: marking step 5
 * (FILE_RETURN) Done writes the full computation to Filing.computationSnapshot,
 * every reader of a filing's own figures uses it, it is never rewritten, and a
 * later change that would make a live recomputation differ raises an
 * AmendmentAlert. Later returns still read REAL data (item 56 from earlier
 * filings' actual payments), never earlier snapshots.
 */
describe("frozen filed returns (D83)", () => {
  const clientIds: string[] = [];
  const codes: string[] = [];
  let n = 0;

  afterAll(async () => {
    await prisma.amendmentAlert.deleteMany({ where: { filing: { clientId: { in: clientIds } } } });
    await prisma.document.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.quarterlySalesCustomer.deleteMany({ where: { quarterlySales: { clientId: { in: clientIds } } } });
    await prisma.quarterlySales.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.startingFigures.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.workflowStep.deleteMany({ where: { filing: { clientId: { in: clientIds } } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.clientTaxYear.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    for (const c of codes) await rm(path.join(process.cwd(), "storage", c), { recursive: true, force: true });
  });

  async function makeClient() {
    const code = `frozen-test-${Date.now()}-${n++}`;
    codes.push(code);
    const client = await prisma.client.create({
      data: { code, registeredName: "Frozen Test Client", tin: "555000111", rdoCode: "999", registeredAddress: "N/A", taxpayerType: "PURELY_SELF_EMPLOYED", booksType: "MANUAL" },
    });
    clientIds.push(client.id);
    await prisma.clientTaxYear.create({ data: { clientId: client.id, taxableYear: 2026, regime: "RATE_8_PERCENT", electionStatus: "ELECTED" } });
    await generateFilingsForClientYear(client.id, 2026);
    return client;
  }
  const filingOf = (clientId: string, period: "Q1" | "Q2" | "Q3") =>
    prisma.filing.findUniqueOrThrow({ where: { clientId_taxableYear_period: { clientId, taxableYear: 2026, period } }, include: { workflowSteps: true } });
  const stepId = async (filingId: string, code: string) => (await prisma.workflowStep.findFirstOrThrow({ where: { filingId, stepCode: code } })).id;
  const done = async (filingId: string, code: string) => {
    const r = await markStepDone(await stepId(filingId, code));
    expect(r.ok, `${code}: ${r.error}`).toBe(true);
  };
  const fd = (o: Record<string, string | File | string[]>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) Array.isArray(v) ? v.forEach((x) => f.append(k, x)) : f.append(k, v);
    return f;
  };
  async function sales(clientId: string, q: "Q1" | "Q2" | "Q3", amount: string) {
    const r = await saveQuarterlySales(clientId, 2026, q, {}, fd({ intent: "final", customerName: ["Someone"], amount: [amount], nonOperatingIncome: "0", notes: "" }));
    expect(r.saved, r.error).toBe(true);
    const f = await filingOf(clientId, q);
    await skipStep(await stepId(f.id, "RECEIVE_2307"), "No certificates.");
  }
  async function fileReturn(clientId: string, q: "Q1" | "Q2" | "Q3") {
    const f = await filingOf(clientId, q);
    await done(f.id, "PREPARE_RETURN");
    await done(f.id, "ADVISE_CLIENT");
    await done(f.id, "FILE_RETURN");
    return prisma.filing.findUniqueOrThrow({ where: { id: f.id } });
  }
  const parse = (f: { computationSnapshot: unknown }) => JSON.parse(f.computationSnapshot as string) as FilingComputationResult;

  it("filing (step 5 Done) writes the full computation as the snapshot, with filedAt", async () => {
    const c = await makeClient();
    await sales(c.id, "Q1", "400000");
    const before = await assembleAndComputeFiling(c.id, 2026, "Q1");
    const filed = await fileReturn(c.id, "Q1");
    expect(filed.computationSnapshot).not.toBeNull();
    expect(filed.filedAt).not.toBeNull();
    const snap = parse(filed) as FilingComputationResult & { breakdown: unknown[] };
    expect(snap).toEqual(JSON.parse(JSON.stringify(before)));
    expect(snap.breakdown.length).toBeGreaterThan(10);
  });

  it("an earlier quarter's sales edited after a later one is filed leaves the filed figures alone and raises an alert with the right difference", async () => {
    const c = await makeClient();
    await sales(c.id, "Q1", "300000");
    await sales(c.id, "Q2", "300000");
    const q2 = await fileReturn(c.id, "Q2"); // filed out of order on purpose: Q1 is still open
    const frozen = parse(q2);
    await sales(c.id, "Q1", "500000"); // +200,000 -> item 50 (and 51, 53, 54) move on a live Q2
    const after = await prisma.filing.findUniqueOrThrow({ where: { id: q2.id } });
    expect(after.computationSnapshot).toBe(q2.computationSnapshot); // byte-identical
    expect(await getFilingSheet(q2.id)).toEqual(frozen);
    const alerts = await prisma.amendmentAlert.findMany({ where: { filingId: q2.id } });
    expect(alerts).toHaveLength(1);
    const live = JSON.parse(alerts[0].recomputedJson as string) as FilingComputationResult;
    const items = changedItems(frozen, live);
    expect(items.find((i) => i.item === "50")).toMatchObject({ oldCents: 30_000_000, newCents: 50_000_000, diffCents: 20_000_000 });
    expect(alerts[0].deltaCents).toBe(1_600_000); // 8% of 200,000
  });

  it("item 61 changed on an earlier, still-open return alerts a later filed one", async () => {
    const c = await makeClient();
    await sales(c.id, "Q1", "300000");
    await sales(c.id, "Q2", "300000");
    const q2 = await fileReturn(c.id, "Q2");
    const q1 = await filingOf(c.id, "Q1");
    const res = await updateFilingOtherCredits(q1.id, {}, fd({ otherCredits: "1000", otherCreditsDescription: "Test credit" }));
    expect(res.saved, res.error).toBe(true);
    const alerts = await prisma.amendmentAlert.findMany({ where: { filingId: q2.id } });
    expect(alerts).toHaveLength(1);
    const items = changedItems(parse(q2), JSON.parse(alerts[0].recomputedJson as string));
    expect(items.map((i) => i.item)).toContain("61");
    expect(alerts[0].deltaCents).toBe(-100_000);
  });

  it("an earlier quarter's payment or the starting figures changing raises an alert on a filed return (the recheck every such action runs)", async () => {
    const c = await makeClient();
    await sales(c.id, "Q1", "400000");
    await sales(c.id, "Q2", "300000");
    const q1 = await fileReturn(c.id, "Q1");
    await prisma.filing.update({ where: { id: q1.id }, data: { amountPaidCents: 1_200_000 } });
    const q2 = await fileReturn(c.id, "Q2");
    const frozen = parse(q2);
    expect(frozen.breakdown.find((l) => l.label.startsWith("56."))!.amountCents).toBe(1_200_000);
    // Q1's payment is corrected afterwards (the D75 lock stops the screen from doing this once Q2 is filed,
    // so this exercises the recheck directly, exactly as savePayment/saveStartingFigures call it)
    await prisma.filing.update({ where: { id: q1.id }, data: { amountPaidCents: 1_000_000 } });
    expect(await checkAndRecordAmendments(c.id, 2026, null, "A payment saved on Q1 2026 changed.")).toBe(1);
    const alert = await prisma.amendmentAlert.findFirstOrThrow({ where: { filingId: q2.id } });
    const item56 = changedItems(frozen, JSON.parse(alert.recomputedJson as string)).find((i) => i.item === "56")!;
    expect(item56).toMatchObject({ oldCents: 1_200_000, newCents: 1_000_000, diffCents: -200_000 });
    expect(alert.deltaCents).toBe(200_000);
    expect((await prisma.filing.findUniqueOrThrow({ where: { id: q2.id } })).computationSnapshot).toBe(q2.computationSnapshot);
    // the same change reported twice raises nothing new while the first is unread
    expect(await checkAndRecordAmendments(c.id, 2026, null, "again")).toBe(0);
    // starting-figures style change
    await prisma.clientTaxYear.updateMany({ where: { clientId: c.id }, data: { priorYearExcessCreditCents: 500_000 } });
    expect(await checkAndRecordAmendments(c.id, 2026, null, "The starting figures for 2026 changed.")).toBeGreaterThan(0);
  });

  it("a later return still reads REAL data: Q2's item 56 is Q1's actual payment, not Q1's snapshot", async () => {
    const c = await makeClient();
    await sales(c.id, "Q1", "400000");
    const q1 = await fileReturn(c.id, "Q1");
    await prisma.filing.update({ where: { id: q1.id }, data: { amountPaidCents: 777_000 } });
    await sales(c.id, "Q2", "300000");
    const live = await assembleAndComputeFiling(c.id, 2026, "Q2");
    expect(live.breakdown.find((l) => l.label.startsWith("56."))!.amountCents).toBe(777_000);
  });

  it("the saved computation-sheet HTML of a filed return never regenerates", async () => {
    const c = await makeClient();
    await sales(c.id, "Q1", "400000");
    const q1 = await filingOf(c.id, "Q1");
    await done(q1.id, "PREPARE_RETURN");
    await done(q1.id, "ADVISE_CLIENT");
    await done(q1.id, "FILE_RETURN");
    const docsBefore = await prisma.document.findMany({ where: { filingId: q1.id, docSlotCode: "draft_computation", deletedAt: null } });
    expect(docsBefore).toHaveLength(1);
    await sales(c.id, "Q1", "999999").catch(() => null); // locked: refused
    await prisma.quarterlySales.updateMany({ where: { clientId: c.id, quarter: "Q1" }, data: { grossSalesCents: 1 } });
    const again = await ensureComputationSheetSaved(q1.id);
    expect(again?.documentId).toBe(docsBefore[0].id);
    const docsAfter = await prisma.document.findMany({ where: { filingId: q1.id, docSlotCode: "draft_computation" } });
    expect(docsAfter).toHaveLength(1);
    expect(docsAfter[0].sha256).toBe(docsBefore[0].sha256);
  });

  it("step 4's message and Pay's default read the snapshot once filed, and step 5 done twice never rewrites it", async () => {
    const c = await makeClient();
    await sales(c.id, "Q1", "400000");
    const q1 = await fileReturn(c.id, "Q1");
    const frozen = parse(q1);
    await prisma.quarterlySales.updateMany({ where: { clientId: c.id, quarter: "Q1" }, data: { grossSalesCents: 100_000_00 } });
    expect((await getFilingSheet(q1.id)).taxPayableCents).toBe(frozen.taxPayableCents); // what Pay's default and D76 read
    const msg = await buildLiveAdviceMessageForFiling(q1.id);
    expect(msg!.body).toContain("12,000.00"); // 8% of (400,000 - 250,000), not of the tampered 100,000
    await done(q1.id, "FILE_RETURN");
    expect((await prisma.filing.findUniqueOrThrow({ where: { id: q1.id } })).computationSnapshot).toBe(q1.computationSnapshot);
  });

  it("no action anywhere writes computationSnapshot except markStepDone's step-5 freeze", () => {
    const writers: string[] = [];
    for (const file of readdirSync(path.join(process.cwd(), "lib", "actions"))) {
      const text = readFileSync(path.join(process.cwd(), "lib", "actions", file), "utf8");
      if (/computationSnapshot\s*:\s*(?!\{\s*(not|equals))/.test(text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""))) writers.push(file);
    }
    expect(writers).toEqual(["workflowSteps.ts"]);
  });
});
