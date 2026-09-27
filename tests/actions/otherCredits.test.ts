import { describe, it, expect, afterAll, vi } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { updateFilingOtherCredits } from "@/lib/actions/filings";
import { saveQuarterlySales } from "@/lib/actions/quarterlySales";
import { markStepDone, skipStep } from "@/lib/actions/workflowSteps";
import { assembleAndComputeFiling, effectiveOtherCreditsFor } from "@/lib/filingComputation";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * Brief #5f §3 — item 61 (1701Q) / item 63 (1701A), now one figure PER
 * RETURN (Filing.otherCreditsCents), replacing brief #5e's year-level
 * ClientTaxYear.otherCreditsCents. Until a filing's own value is saved
 * (null), it inherits the value of the return before it in the same
 * taxable year (or the starting figures, or 0). Locked once THIS filing's
 * own step 5 (FILE_RETURN) is Done. A saved change reopens this filing's
 * own steps 3/4 and propagates forward to any later filing that still
 * inherits (its own value is still null), stopping at the first one with
 * its own saved value.
 */
describe("updateFilingOtherCredits", () => {
  const createdClientIds: string[] = [];
  const clientCodes: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.document.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.quarterlySalesCustomer.deleteMany({ where: { quarterlySales: { clientId: { in: createdClientIds } } } });
    await prisma.quarterlySales.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.workflowStep.deleteMany({ where: { filing: { clientId: { in: createdClientIds } } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.clientTaxYear.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
    for (const code of clientCodes) {
      await rm(path.join(process.cwd(), "storage", code), { recursive: true, force: true });
    }
  });

  function salesFormData(intent: "draft" | "final", amount: string, customerName = "Client A"): FormData {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.append("customerName", customerName);
    fd.append("amount", amount);
    return fd;
  }

  function creditsFormData(otherCredits: string, description = ""): FormData {
    const fd = new FormData();
    fd.set("otherCredits", otherCredits);
    fd.set("otherCreditsDescription", description);
    return fd;
  }

  async function makeClientWithYear(codePrefix: string) {
    const code = `${codePrefix}-${Date.now()}`;
    clientCodes.push(code);
    const client = await prisma.client.create({
      data: {
        code,
        registeredName: "Other Credits Test Client",
        tin: "444555667",
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

  it("with nothing saved anywhere, a filing's own item 61 is inherited as 0 and included in item 62", async () => {
    const client = await makeClientWithYear("oc-default-zero");
    const q1 = await assembleAndComputeFiling(client.id, 2026, "Q1");
    if (!("item61OtherCreditsCents" in q1)) throw new Error("expected 1701Q result");
    expect(q1.item61OtherCreditsCents).toBe(0);

    const inherited = await effectiveOtherCreditsFor(client.id, 2026, "Q1");
    expect(inherited.isInherited).toBe(true);
    expect(inherited.sourceLabel).toBeNull(); // nothing to inherit from — the year's own first return
  });

  it("a saved value overrides the inherited one and appears in item 62", async () => {
    const client = await makeClientWithYear("oc-save-overrides");
    const q1Filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q1" } },
    });

    const saveResult = await updateFilingOtherCredits(q1Filing.id, {}, creditsFormData("1000", "test credit"));
    expect(saveResult.saved).toBe(true);

    const q1 = await assembleAndComputeFiling(client.id, 2026, "Q1");
    if (!("item61OtherCreditsCents" in q1)) throw new Error("expected 1701Q result");
    expect(q1.item61OtherCreditsCents).toBe(100_000); // ₱1,000.00
    expect(q1.item62TotalCreditsCents).toBeGreaterThanOrEqual(100_000);
  });

  it("Q2 inherits Q1's saved figure until Q2 saves its own; the Annual then inherits Q3's", async () => {
    const client = await makeClientWithYear("oc-inheritance-chain");
    const q1Filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q1" } },
    });
    await updateFilingOtherCredits(q1Filing.id, {}, creditsFormData("1000", "from Q1"));

    const q2Inherited = await effectiveOtherCreditsFor(client.id, 2026, "Q2");
    expect(q2Inherited.effectiveCents).toBe(100_000);
    expect(q2Inherited.isInherited).toBe(true);
    expect(q2Inherited.sourceLabel).toBe("Q1");

    const q3Filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q3" } },
    });
    await updateFilingOtherCredits(q3Filing.id, {}, creditsFormData("2000", "from Q3"));

    const annualInherited = await effectiveOtherCreditsFor(client.id, 2026, "ANNUAL");
    expect(annualInherited.effectiveCents).toBe(200_000);
    expect(annualInherited.sourceLabel).toBe("Q3"); // the nearest EXISTING saved value, not Q2 (still null)
  });

  it("is locked once this filing's own step 5 (FILE_RETURN) is Done, enforced server-side", async () => {
    const client = await makeClientWithYear("oc-locked-after-filed");
    const q1Filing = await prepareFiling(client.id, "Q1", "300000");
    await markStepDone(
      (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: q1Filing.id, stepCode: "FILE_RETURN" } })).id,
    );

    const result = await updateFilingOtherCredits(q1Filing.id, {}, creditsFormData("500", "test"));
    expect(result.error).toMatch(/filed|locked/i);

    const after = await prisma.filing.findUniqueOrThrow({ where: { id: q1Filing.id } });
    expect(after.otherCreditsCents).toBeNull(); // unchanged
  });

  it("a saved change reopens this filing's own steps 3/4 when they're Done", async () => {
    const client = await makeClientWithYear("oc-reopen-self");
    const q1Filing = await prepareFiling(client.id, "Q1", "300000");
    await markStepDone(
      (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: q1Filing.id, stepCode: "ADVISE_CLIENT" } })).id,
    );

    await updateFilingOtherCredits(q1Filing.id, {}, creditsFormData("500", "test"));

    const step3 = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: q1Filing.id, stepCode: "PREPARE_RETURN" } });
    const step4 = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: q1Filing.id, stepCode: "ADVISE_CLIENT" } });
    expect(step3.status).toBe("PENDING");
    expect(step4.status).toBe("PENDING");
  });

  it("a saved change propagates forward to later filings that still inherit, stopping at the first with its own saved value", async () => {
    const client = await makeClientWithYear("oc-reopen-propagate");
    const q1Filing = await prepareFiling(client.id, "Q1", "300000");
    const q2Filing = await prepareFiling(client.id, "Q2", "300000");
    const q3Filing = await prepareFiling(client.id, "Q3", "300000");

    // Q3 saves its OWN value first (this reopens Q3's own steps 3/4, per
    // this filing's own reopening rule — re-prepare it so the next part of
    // this test isolates whether Q1's later change propagates past it).
    await updateFilingOtherCredits(q3Filing.id, {}, creditsFormData("999", "own figure"));
    await markStepDone(
      (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: q3Filing.id, stepCode: "PREPARE_RETURN" } })).id,
    );

    await updateFilingOtherCredits(q1Filing.id, {}, creditsFormData("100", "own figure"));

    const q2Step3 = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: q2Filing.id, stepCode: "PREPARE_RETURN" } });
    expect(q2Step3.status).toBe("PENDING"); // Q2 still inherited from Q1 — reopened

    const q3Step3After = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: q3Filing.id, stepCode: "PREPARE_RETURN" } });
    expect(q3Step3After.status).toBe("DONE"); // Q3 has its own saved value — chain broken, untouched
  });

  it("validates with Zod: rejects a malformed amount, and requires a description once the amount is above zero", async () => {
    const client = await makeClientWithYear("oc-invalid");
    const q1Filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q1" } },
    });

    const malformed = await updateFilingOtherCredits(q1Filing.id, {}, creditsFormData("not-a-number"));
    expect(malformed.fieldErrors?.otherCredits).toBeTruthy();

    const missingDescription = await updateFilingOtherCredits(q1Filing.id, {}, creditsFormData("500", ""));
    expect(missingDescription.fieldErrors?.otherCreditsDescription).toBeTruthy();
  });
});
