import { describe, it, expect, afterAll, vi } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { uploadDocument } from "@/lib/actions/documents";
import { markStepDone } from "@/lib/actions/workflowSteps";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";
import { manilaCalendarDay, nowManila } from "@/lib/dates";
import { markEarlierQuartersFiled, resolvePrepare } from "../helpers/filedEarlier";
import { testStorageRoot } from "@/tests/helpers/testEnv";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/** D119 — the upload boxes have no date field; the document is dated the day it is uploaded, in Manila. */
describe("uploadDocument without a date", () => {
  const clientCode = `d119-upload-date-${Date.now()}`;
  let clientId = "";

  afterAll(async () => {
    if (!clientId) return;
    await prisma.document.deleteMany({ where: { clientId } });
    await prisma.quarterlySales.deleteMany({ where: { clientId } });
    await prisma.workflowStep.deleteMany({ where: { filing: { clientId } } });
    await prisma.filing.deleteMany({ where: { clientId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await rm(path.join(testStorageRoot(), clientCode), { recursive: true, force: true });
  });

  it("stores today's Manila date when no documentDate is supplied", async () => {
    const client = await prisma.client.create({
      data: {
        code: clientCode,
        registeredName: "Upload Date Test Client",
        tin: "777888998",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
        defaultWithholdingRateBps: 500,
      },
    });
    clientId = client.id;
    await generateFilingsForClientYear(client.id, 2026);
    await markEarlierQuartersFiled(client.id, 2026, "Q2");
    const filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q2" } },
    });
    await prisma.quarterlySales.create({
      data: { clientId: client.id, taxableYear: 2026, quarter: "Q2", grossSalesCents: 500_000_00, finalizedAt: new Date() },
    });
    const fileReturnStep = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "FILE_RETURN" },
    });
    await resolvePrepare(filing.id);
    await markStepDone(fileReturnStep.id);

    const step = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "SAVE_SUBMISSION_SS" },
    });
    const fd = new FormData();
    fd.set("file", new File(["bytes"], "SAMPLE_submission.pdf", { type: "application/pdf" }));
    fd.set("workflowStepId", step.id);
    fd.set("docSlotCode", "submission_screenshot");

    const result = await uploadDocument(fd);
    expect(result.ok).toBe(true);

    const doc = await prisma.document.findFirstOrThrow({ where: { workflowStepId: step.id } });
    expect(manilaCalendarDay(doc.documentDate)).toBe(nowManila().toFormat("yyyy-MM-dd"));
    const today = nowManila().toFormat("yyyyMMdd");
    expect(doc.storedPath).toContain(`__${today}__`);
  });
});
