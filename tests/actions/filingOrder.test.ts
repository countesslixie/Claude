import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";
import { markStepDone, markStepInProgress, skipStep } from "@/lib/actions/workflowSteps";
import { stepLockReason } from "@/lib/workflow/groups";
import { loadFilingOrderBlockReason } from "@/lib/workflow/filingOrderData";

import { resolvePrepare } from "../helpers/filedEarlier";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/** D95 (brief #5q) — step 5 refused while an earlier return of the same client-year is unfiled; D98 — steps 1 and 4 can't be skipped or started. */
describe("filing order guard (D95) and steps 1/4 (D98)", () => {
  const clientIds: string[] = [];
  let n = 0;

  afterAll(async () => {
    await prisma.startingFigures.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.workflowStep.deleteMany({ where: { filing: { clientId: { in: clientIds } } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.clientTaxYear.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  });

  async function makeClient(latestOutsideReturn?: "Q1" | "Q2" | "Q3", electionStatus: "ELECTED" | "NOT_YET_ELECTED" = "ELECTED") {
    const client = await prisma.client.create({
      data: {
        code: `order-${Date.now()}-${n++}`,
        registeredName: "Filing Order Test Client",
        tin: "111222333",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    clientIds.push(client.id);
    const taxYear = await prisma.clientTaxYear.create({
      data: { clientId: client.id, taxableYear: 2026, regime: "RATE_8_PERCENT", electionStatus },
    });
    if (latestOutsideReturn) {
      await prisma.startingFigures.create({
        data: { clientId: client.id, taxableYear: 2026, clientTaxYearId: taxYear.id, latestOutsideReturn },
      });
    }
    await generateFilingsForClientYear(client.id, 2026);
    return client;
  }
  const filingOf = (clientId: string, period: "Q1" | "Q2" | "Q3" | "ANNUAL") =>
    prisma.filing.findUniqueOrThrow({ where: { clientId_taxableYear_period: { clientId, taxableYear: 2026, period } } });
  const step5 = async (filingId: string) => {
    await resolvePrepare(filingId); // D100: step 5 also waits for Prepare; these tests are about the filing-order guard
    return prisma.workflowStep.findFirstOrThrow({ where: { filingId, stepCode: "FILE_RETURN" } });
  };
  const stepOf = (filingId: string, stepCode: string) => prisma.workflowStep.findFirstOrThrow({ where: { filingId, stepCode } });

  it("Q2 is refused while Q1 is unfiled — and the refused call writes nothing", async () => {
    const client = await makeClient();
    const q2 = await filingOf(client.id, "Q2");
    const before = await step5(q2.id);
    const result = await markStepDone(before.id);
    expect(result).toEqual({ ok: false, error: "File Q1 2026 first." });
    const after = await step5(q2.id);
    expect(after.status).toBe(before.status);
    expect(after.completedAt).toBeNull();
    const filing = await filingOf(client.id, "Q2");
    expect(filing.computationSnapshot).toBeNull();
    expect(filing.filedAt).toBeNull();
  });

  it("D136: Q1 step 5 is not refused for an election, even on a legacy NOT_YET_ELECTED row", async () => {
    const client = await makeClient(undefined, "NOT_YET_ELECTED");
    const q1 = await filingOf(client.id, "Q1");
    const result = await markStepDone((await step5(q1.id)).id);
    expect(result.ok, result.error).toBe(true);
  });

  it("Q2 is allowed once Q1 is filed", async () => {
    const client = await makeClient();
    const q1 = await filingOf(client.id, "Q1");
    expect((await markStepDone((await step5(q1.id)).id)).ok).toBe(true);
    const q2 = await filingOf(client.id, "Q2");
    const result = await markStepDone((await step5(q2.id)).id);
    expect(result.ok, result.error).toBe(true);
    expect((await filingOf(client.id, "Q2")).filedAt).not.toBeNull();
  });

  it("Q2 is allowed when Q1 has no Filing row because the starting figures name it as filed outside the app", async () => {
    const client = await makeClient("Q1");
    expect(await prisma.filing.findUnique({ where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q1" } } })).toBeNull();
    const q2 = await filingOf(client.id, "Q2");
    const result = await markStepDone((await step5(q2.id)).id);
    expect(result.ok, result.error).toBe(true);
  });

  it("Q2 is allowed when Q1's row has filedOutsideApp: true", async () => {
    const client = await makeClient();
    await prisma.filing.update({ where: { id: (await filingOf(client.id, "Q1")).id }, data: { filedOutsideApp: true } });
    const q2 = await filingOf(client.id, "Q2");
    const result = await markStepDone((await step5(q2.id)).id);
    expect(result.ok, result.error).toBe(true);
  });

  it("Annual is refused while Q3 is unfiled, with a message naming Q3", async () => {
    const client = await makeClient();
    await prisma.filing.updateMany({ where: { clientId: client.id, period: { in: ["Q1", "Q2"] } }, data: { filedOutsideApp: true } });
    const annual = await filingOf(client.id, "ANNUAL");
    const result = await markStepDone((await step5(annual.id)).id);
    expect(result).toEqual({ ok: false, error: "File Q3 2026 first." });
    expect((await filingOf(client.id, "ANNUAL")).computationSnapshot).toBeNull();
  });

  it("stepLockReason, fed the guard's reason for a real filing, returns the message", async () => {
    const client = await makeClient();
    const q3 = await filingOf(client.id, "Q3");
    const reason = await loadFilingOrderBlockReason(q3);
    expect(reason).toBe("File Q1 and Q2 2026 first.");
    await resolvePrepare(q3.id); // D100: with Prepare unfinished, that reason would win instead
    const steps = await prisma.workflowStep.findMany({ where: { filingId: q3.id } });
    expect(stepLockReason("FILE_RETURN", steps, reason)).toBe("File Q1 and Q2 2026 first.");
  });

  it("D98: skipStep refuses steps 1 and 4 server-side; markStepInProgress refuses both too", async () => {
    const client = await makeClient();
    const q1 = await filingOf(client.id, "Q1");
    for (const code of ["RECORD_SALES", "ADVISE_CLIENT"]) {
      const step = await stepOf(q1.id, code);
      const skip = await skipStep(step.id, "just because");
      expect(skip.ok).toBe(false);
      expect(skip.error).toMatch(/can't be skipped/i);
      const start = await markStepInProgress(step.id);
      expect(start.ok).toBe(false);
      expect(start.error).toMatch(/can't be started/i);
      expect((await stepOf(q1.id, code)).status).toBe(step.status);
    }
  });
});
