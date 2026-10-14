import { describe, it, expect, afterAll, vi } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { generateFilingsForClientYear, recomputeRequiresSawt } from "@/lib/workflow/filingGeneration";
import { uploadDocument, deleteDocument } from "@/lib/actions/documents";
import { recomputeFileGroupDocStepStatus } from "@/lib/actions/workflowSteps";
import { loadValidationMonths } from "@/lib/workflow/validationMonthsData";
import { summarizeGroup, WORKFLOW_GROUPS } from "@/lib/workflow/groups";
import { validationSlotDefs } from "@/lib/workflow/validationMonths";
import { testStorageRoot } from "@/tests/helpers/testEnv";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/** D200 — step 11 with real certificates: months from the periods, completion, and filings that predate the change. Fictitious data. */
describe("step 11 — one validation file per month (D200)", () => {
  const clientIds: string[] = [];
  const codes: string[] = [];
  let n = 0;

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.form2307.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.workflowStep.deleteMany({ where: { filing: { clientId: { in: clientIds } } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    for (const c of codes) await rm(path.join(testStorageRoot(), c), { recursive: true, force: true });
  });

  async function setup(certs: [string, string][]) {
    const code = `s11-test-${Date.now()}-${n++}`;
    codes.push(code);
    const client = await prisma.client.create({
      data: {
        code, registeredName: "Sample Person", tin: "123456789", branchCode: "000", rdoCode: "050", registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED", booksType: "MANUAL", defaultWithholdingRateBps: 500,
      },
    });
    clientIds.push(client.id);
    await generateFilingsForClientYear(client.id, 2026);
    const filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q3" } },
    });
    for (const [from, to] of certs) {
      await prisma.form2307.create({
        data: {
          clientId: client.id, taxableYear: 2026, payorName: "Fixture Payor", payorTin: "111222333",
          periodFrom: new Date(`${from}T00:00:00.000Z`), periodTo: new Date(`${to}T00:00:00.000Z`), quarterCovered: 3, atcCode: "WI010",
          incomePaymentCents: 1_000_000, taxWithheldCents: 50_000, withholdingRateBps: 500, status: "RECORDED", claimedOnFilingId: filing.id,
        },
      });
    }
    await recomputeRequiresSawt(client.id, 2026, "Q3");
    await prisma.workflowStep.updateMany({
      where: { filingId: filing.id, stepCode: { in: ["FILE_RETURN", "SAVE_SUBMISSION_SS", "SAVE_FORM_COPY", "MAKE_PAYMENT", "SAVE_PROOF_PAYMENT"] } },
      data: { status: "DONE", completedAt: new Date() },
    });
    return { client, filing };
  }
  const step = (filingId: string) => prisma.workflowStep.findFirstOrThrow({ where: { filingId, stepCode: "ALPHALIST_ENTRY" } });
  async function upload(filingId: string, slot: string, name = `${slot}.pdf`) {
    const fd = new FormData();
    fd.set("file", new File([`${slot}-${name}`], name));
    fd.set("workflowStepId", (await step(filingId)).id);
    fd.set("docSlotCode", slot);
    return uploadDocument(fd);
  }
  /** A file saved the way step 11 worked before D200 (straight into the database). */
  async function legacyDoc(clientId: string, filingId: string, slot: "generated_report" | "dat_file") {
    const s = await step(filingId);
    return prisma.document.create({
      data: {
        clientId, filingId, workflowStepId: s.id, docSlotCode: slot, category: slot === "dat_file" ? "DAT_FILE" : "ALPHALIST_REPORT",
        originalFilename: `old-${slot}`, storedPath: `legacy-test/${slot}`, mimeType: "application/pdf", sizeBytes: 1, sha256: `legacy-${slot}-${filingId}`,
        documentDate: new Date(),
      },
    });
  }

  it("loads the months from the certificates saved on the filing (July + September -> no August)", async () => {
    const { filing } = await setup([["2026-07-01", "2026-07-31"], ["2026-09-01", "2026-09-30"]]);
    const r = await loadValidationMonths(filing.id);
    expect(r.months.map((m) => m.month)).toEqual([7, 9]);
  });

  it("completes only when both of two months are saved, and removing one reopens it", async () => {
    const { filing } = await setup([["2026-07-01", "2026-07-31"], ["2026-09-01", "2026-09-30"]]);
    expect((await upload(filing.id, "validation_2026-08")).ok).toBe(false); // August isn't needed
    expect((await upload(filing.id, "validation_2026-07")).ok).toBe(true);
    expect((await step(filing.id)).status).not.toBe("DONE");
    expect((await upload(filing.id, "validation_2026-09")).ok).toBe(true);
    expect((await step(filing.id)).status).toBe("DONE");
    const sep = await prisma.document.findFirstOrThrow({ where: { filingId: filing.id, docSlotCode: "validation_2026-09", deletedAt: null } });
    await deleteDocument(sep.id, "wrong file");
    expect((await step(filing.id)).status).toBe("PENDING");
  });

  it("a filing whose certificates touch no month of its period asks for every month", async () => {
    const { filing } = await setup([["2026-01-01", "2026-03-31"]]);
    const r = await loadValidationMonths(filing.id);
    expect(r.fellBack).toBe(true);
    expect(r.months).toHaveLength(3);
  });

  it("an older step 11 that is Done with a report and a DAT file stays Done, takes no new upload, and a re-check leaves it alone", async () => {
    const { client, filing } = await setup([["2026-07-01", "2026-09-30"]]);
    await legacyDoc(client.id, filing.id, "generated_report");
    await legacyDoc(client.id, filing.id, "dat_file");
    await prisma.workflowStep.update({ where: { id: (await step(filing.id)).id }, data: { status: "DONE", completedAt: new Date() } });
    await recomputeFileGroupDocStepStatus((await step(filing.id)).id);
    expect((await step(filing.id)).status).toBe("DONE");
    expect((await upload(filing.id, "validation_2026-07")).ok).toBe(false);
    expect(await prisma.document.count({ where: { filingId: filing.id, deletedAt: null } })).toBe(2);
  });

  it("an older open step 11 keeps its report, still needs every month, and names them by month", async () => {
    const { client, filing } = await setup([["2026-07-01", "2026-09-30"]]);
    const old = await legacyDoc(client.id, filing.id, "generated_report");
    await recomputeFileGroupDocStepStatus((await step(filing.id)).id);
    expect((await step(filing.id)).status).not.toBe("DONE");
    expect(await prisma.document.count({ where: { id: old.id, deletedAt: null } })).toBe(1);

    // the group header names the missing months, with no "DAT"
    const s = await step(filing.id);
    const months = (await loadValidationMonths(filing.id)).months;
    const docs = await prisma.document.findMany({ where: { workflowStepId: s.id, deletedAt: null } });
    const eafs = WORKFLOW_GROUPS.find((g) => g.code === "EAFS")!;
    const summary = summarizeGroup(eafs, [
      { stepCode: "ALPHALIST_ENTRY", status: "PENDING", requiredDocSlots: validationSlotDefs(months), documents: docs },
    ]);
    expect(summary.blockReason).toContain("validation for July 2026");
    expect(summary.blockReason).toContain("validation for September 2026");
    expect(summary.blockReason).not.toMatch(/\bDAT\b/i);

    for (const slot of ["validation_2026-07", "validation_2026-08", "validation_2026-09"]) await upload(filing.id, slot);
    expect((await step(filing.id)).status).toBe("DONE");
    // the earlier report is still there until she removes it
    expect(await prisma.document.count({ where: { id: old.id, deletedAt: null } })).toBe(1);
    await deleteDocument(old.id, "earlier upload");
    expect((await step(filing.id)).status).toBe("DONE");
  });
});
