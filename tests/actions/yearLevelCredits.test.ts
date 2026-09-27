import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { updateYearLevelCredits } from "@/lib/actions/clientTaxYears";
import { saveQuarterlySales } from "@/lib/actions/quarterlySales";
import { markStepDone, skipStep } from "@/lib/actions/workflowSteps";
import { assembleAndComputeFiling } from "@/lib/filingComputation";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * Brief #5e §8 — items 55/57 (prior-year excess credit) and 61/63 (other
 * tax credits/payments) are single client-year figures (ClientTaxYear),
 * the same full amount on every return of the year, included in the
 * rounded item 62/64 total. Editable from a filing's sheet only while
 * that filing's own step 3 isn't Done; a change reopens every OTHER
 * unfiled filing of the year whose step 3 is already Done. Filed filings
 * keep their frozen snapshot untouched.
 */
describe("updateYearLevelCredits", () => {
  const createdClientIds: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.document.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.quarterlySalesCustomer.deleteMany({ where: { quarterlySales: { clientId: { in: createdClientIds } } } });
    await prisma.quarterlySales.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.workflowStep.deleteMany({ where: { filing: { clientId: { in: createdClientIds } } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.clientTaxYear.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  });

  function salesFormData(intent: "draft" | "final", amount: string, customerName = "Client A"): FormData {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.append("customerName", customerName);
    fd.append("amount", amount);
    return fd;
  }

  function creditsFormData(priorYearExcessCredit: string, otherCredits: string, description = ""): FormData {
    const fd = new FormData();
    fd.set("priorYearExcessCredit", priorYearExcessCredit);
    fd.set("otherCredits", otherCredits);
    fd.set("otherCreditsDescription", description);
    return fd;
  }

  async function makeClientWithYear(codePrefix: string) {
    const client = await prisma.client.create({
      data: {
        code: `${codePrefix}-${Date.now()}`,
        registeredName: "Year Level Credits Test Client",
        tin: "444555666",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    createdClientIds.push(client.id);
    await prisma.clientTaxYear.create({
      data: { clientId: client.id, taxableYear: 2026, regime: "RATE_8_PERCENT", electionStatus: "ELECTED" },
    });
    await generateFilingsForClientYear(client.id, 2026);
    return client;
  }

  async function prepareFiling(clientId: string, period: "Q1" | "Q2" | "Q3", amount: string) {
    const filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId, taxableYear: 2026, period } },
    });
    await saveQuarterlySales(clientId, 2026, period, {}, salesFormData("final", amount));
    await skipStep(
      (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECEIVE_2307" } })).id,
      "No 2307s expected.",
    );
    await markStepDone(
      (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "PREPARE_RETURN" } })).id,
    );
    return filing;
  }

  it("entered once, appears in full on every return of the year and is included in item 62", async () => {
    const client = await makeClientWithYear("ylc-full-amount");
    const q1Filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q1" } },
    });
    const saveResult = await updateYearLevelCredits(client.id, 2026, q1Filing.id, {}, creditsFormData("5000", "1000", "test credit"));
    expect(saveResult.saved).toBe(true);

    const q1 = await assembleAndComputeFiling(client.id, 2026, "Q1");
    const q2 = await assembleAndComputeFiling(client.id, 2026, "Q2");
    if (!("item55PriorYearExcessCreditCents" in q1) || !("item55PriorYearExcessCreditCents" in q2)) {
      throw new Error("expected 1701Q results");
    }
    expect(q1.item55PriorYearExcessCreditCents).toBe(500_000); // ₱5,000.00
    expect(q1.item61OtherCreditsCents).toBe(100_000); // ₱1,000.00
    expect(q2.item55PriorYearExcessCreditCents).toBe(500_000); // same full figure, not lowered
    expect(q2.item61OtherCreditsCents).toBe(100_000);
    expect(q1.item62TotalCreditsCents).toBeGreaterThanOrEqual(600_000); // included in the total
  });

  it("is read-only once step 3 is Done for the filing named, enforced server-side", async () => {
    const client = await makeClientWithYear("ylc-readonly");
    const q1Filing = await prepareFiling(client.id, "Q1", "300000");

    const result = await updateYearLevelCredits(client.id, 2026, q1Filing.id, {}, creditsFormData("2000", "500"));
    expect(result.error).toMatch(/already prepared|step 3/i);

    const taxYear = await prisma.clientTaxYear.findUniqueOrThrow({
      where: { clientId_taxableYear: { clientId: client.id, taxableYear: 2026 } },
    });
    expect(taxYear.priorYearExcessCreditCents).toBe(0); // unchanged
  });

  it("editable again once step 3 reopens", async () => {
    const client = await makeClientWithYear("ylc-reopen-editable");
    const q1Filing = await prepareFiling(client.id, "Q1", "300000");

    const blocked = await updateYearLevelCredits(client.id, 2026, q1Filing.id, {}, creditsFormData("2000", "0"));
    expect(blocked.error).toBeTruthy();

    // Reopen step 3 by changing the sales figure (brief #5d §6).
    await saveQuarterlySales(client.id, 2026, "Q1", {}, salesFormData("final", "400000"));
    const step3 = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: q1Filing.id, stepCode: "PREPARE_RETURN" } });
    expect(step3.status).not.toBe("DONE");

    const allowed = await updateYearLevelCredits(client.id, 2026, q1Filing.id, {}, creditsFormData("2000", "0"));
    expect(allowed.saved).toBe(true);
  });

  it("changing either figure reopens every other unfiled filing of the year whose step 3 is Done", async () => {
    const client = await makeClientWithYear("ylc-reopen-others");
    await prepareFiling(client.id, "Q1", "300000");
    const q2Filing = await prepareFiling(client.id, "Q2", "300000");
    const q3Filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q3" } },
    });
    // Q3 is left unprepared (step 3 still PENDING) -- editing from there passes the guard.

    const result = await updateYearLevelCredits(client.id, 2026, q3Filing.id, {}, creditsFormData("1000", "0"));
    expect(result.saved).toBe(true);

    const q1Step3 = await prisma.workflowStep.findFirstOrThrow({
      where: { filing: { clientId: client.id, taxableYear: 2026, period: "Q1" }, stepCode: "PREPARE_RETURN" },
    });
    const q2Step3 = await prisma.workflowStep.findUniqueOrThrow({
      where: { id: (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: q2Filing.id, stepCode: "PREPARE_RETURN" } })).id },
    });
    expect(q1Step3.status).toBe("PENDING"); // reopened
    expect(q2Step3.status).toBe("PENDING"); // reopened
  });

  it("a credit entered after Q1 is filed leaves Q1's frozen snapshot unchanged", async () => {
    const client = await makeClientWithYear("ylc-frozen-untouched");

    await prisma.quarterlySales.create({
      data: { clientId: client.id, taxableYear: 2026, quarter: "Q1", grossSalesCents: 300_000_00 },
    });
    const snapshot = await assembleAndComputeFiling(client.id, 2026, "Q1");
    const snapshotJson = JSON.stringify(snapshot);
    const q1Filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q1" } },
    });
    await prisma.filing.update({
      where: { id: q1Filing.id },
      data: { computationSnapshot: snapshotJson, filedAt: new Date("2026-05-15T00:00:00.000Z") },
    });
    // Mark FILE_RETURN Done so the "filed filing" guard applies structurally too.
    await prisma.workflowStep.updateMany({
      where: { filingId: q1Filing.id, stepCode: "FILE_RETURN" },
      data: { status: "DONE" },
    });

    const q2Filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q2" } },
    });
    const result = await updateYearLevelCredits(client.id, 2026, q2Filing.id, {}, creditsFormData("5000", "0"));
    expect(result.saved).toBe(true);

    const q1After = await prisma.filing.findUniqueOrThrow({ where: { id: q1Filing.id } });
    expect(q1After.computationSnapshot).toBe(snapshotJson); // byte-identical, never rewritten
  });

  it("validates amounts server-side with Zod and rejects a malformed figure", async () => {
    const client = await makeClientWithYear("ylc-invalid");
    const result = await updateYearLevelCredits(client.id, 2026, "no-such-filing", {}, creditsFormData("not-a-number", "0"));
    expect(result.fieldErrors?.priorYearExcessCredit).toBeTruthy();
  });
});
