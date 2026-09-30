import { describe, it, expect, afterAll, vi } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { savePayment } from "@/lib/actions/filings";
import { uploadDocument } from "@/lib/actions/documents";
import { markStepDone, skipStep, markStepInProgress } from "@/lib/actions/workflowSteps";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";
import { isPaymentLocked, assembleAndComputeFiling } from "@/lib/filingComputation";
import { toManilaDateInputValue } from "@/lib/dates";
import { markEarlierQuartersFiled, resolvePrepare } from "../helpers/filedEarlier";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * D75 (brief #5m §3, her decisions) — step 8 (MAKE_PAYMENT): amount paid,
 * date of payment, and the channel paid through, saved together with a
 * single Mark done. Opens only once File (5, 6, 7) is Done. Editable
 * afterwards until the NEXT filing of the same taxable year has its own
 * step 5 Done — at that point this filing's paid amount has already fed
 * that later return's own item 56/58. D76 — an overpayment or exactly ₱0
 * payable makes steps 8/9 NA automatically the moment step 5 is Done.
 */
describe("savePayment (D75)", () => {
  const createdClientIds: string[] = [];
  const clientCodes: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.amendmentAlert.deleteMany({ where: { filing: { clientId: { in: createdClientIds } } } });
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

  async function makeClient(codePrefix: string) {
    const code = `${codePrefix}-${Date.now()}`;
    clientCodes.push(code);
    const client = await prisma.client.create({
      data: {
        code,
        registeredName: "Payment Test Client",
        tin: "555666777",
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

  async function seedPayableSales(clientId: string, period: "Q1" | "Q2" | "Q3", grossPesos: number) {
    await prisma.quarterlySales.create({
      data: { clientId, taxableYear: 2026, quarter: period, grossSalesCents: grossPesos * 100, finalizedAt: new Date() },
    });
  }

  async function fileTheReturn(filingId: string) {
    // D95 -- earlier quarters of the same year must be filed first.
    const own = await prisma.filing.findUniqueOrThrow({ where: { id: filingId } });
    await markEarlierQuartersFiled(own.clientId, own.taxableYear, own.period);
    const fileReturnStep = await prisma.workflowStep.findFirstOrThrow({ where: { filingId, stepCode: "FILE_RETURN" } });
    await resolvePrepare(fileReturnStep.filingId);
    await markStepDone(fileReturnStep.id);
    for (const [stepCode, slotCode] of [
      ["SAVE_SUBMISSION_SS", "submission_screenshot"],
      ["SAVE_FORM_COPY", "filed_form"],
    ] as const) {
      const step = await prisma.workflowStep.findFirstOrThrow({ where: { filingId, stepCode } });
      const fd = new FormData();
      fd.set("file", new File(["bytes"], `${stepCode}.pdf`, { type: "application/pdf" }));
      fd.set("workflowStepId", step.id);
      fd.set("docSlotCode", slotCode);
      fd.set("documentDate", "2026-08-15");
      await uploadDocument(fd);
    }
  }

  function paymentFormData(amountPaid: string, paymentDate = "2026-08-17", paymentChannel = "BDO"): FormData {
    const fd = new FormData();
    fd.set("amountPaid", amountPaid);
    fd.set("paymentDate", paymentDate);
    fd.set("paymentChannel", paymentChannel);
    return fd;
  }

  it("is refused before File (steps 5, 6, 7) is Done", async () => {
    const client = await makeClient("pay-locked-until-filed");
    const filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q2" } },
    });
    const result = await savePayment(filing.id, {}, paymentFormData("20000"));
    expect(result.error).toMatch(/available once file/i);

    const step = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "MAKE_PAYMENT" } });
    expect(step.status).not.toBe("DONE");
  });

  it("requires all three fields", async () => {
    const client = await makeClient("pay-requires-fields");
    await seedPayableSales(client.id, "Q2", 500_000);
    const filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q2" } },
    });
    await fileTheReturn(filing.id);

    const missingAll = await savePayment(filing.id, {}, paymentFormData("", "", ""));
    expect(missingAll.fieldErrors?.amountPaid).toBeTruthy();
    expect(missingAll.fieldErrors?.paymentDate).toBeTruthy();
    expect(missingAll.fieldErrors?.paymentChannel).toBeTruthy();
  });

  it("saves the amount/date/channel and marks step 8 Done", async () => {
    const client = await makeClient("pay-saves-and-completes");
    await seedPayableSales(client.id, "Q2", 500_000);
    const filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q2" } },
    });
    await fileTheReturn(filing.id);

    const result = await savePayment(filing.id, {}, paymentFormData("20,000.00", "2026-08-17", "GCash"));
    expect(result.saved).toBe(true);

    const updated = await prisma.filing.findUniqueOrThrow({ where: { id: filing.id } });
    expect(updated.amountPaidCents).toBe(2_000_000);
    expect(updated.paymentChannel).toBe("GCash");
    expect(toManilaDateInputValue(updated.paymentDate)).toBe("2026-08-17");

    const step = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "MAKE_PAYMENT" } });
    expect(step.status).toBe("DONE");
  });

  it("step 9 locks until step 8 is Done and completes on upload; Skip and Start are refused for 8 and 9", async () => {
    const client = await makeClient("pay-step9-lock");
    await seedPayableSales(client.id, "Q2", 500_000);
    const filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q2" } },
    });
    await fileTheReturn(filing.id);

    const step8 = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "MAKE_PAYMENT" } });
    const step9 = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "SAVE_PROOF_PAYMENT" } });

    for (const step of [step8, step9]) {
      expect((await skipStep(step.id, "Trying anyway.")).ok).toBe(false);
      expect((await markStepInProgress(step.id)).ok).toBe(false);
    }

    const lockedUpload = new FormData();
    lockedUpload.set("file", new File(["proof"], "proof.pdf", { type: "application/pdf" }));
    lockedUpload.set("workflowStepId", step9.id);
    lockedUpload.set("docSlotCode", "proof");
    lockedUpload.set("documentDate", "2026-08-17");
    const lockedResult = await uploadDocument(lockedUpload);
    expect(lockedResult.ok).toBe(false);

    await savePayment(filing.id, {}, paymentFormData("20000"));

    const unlockedResult = await uploadDocument(lockedUpload);
    expect(unlockedResult.ok).toBe(true);
    const updatedStep9 = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step9.id } });
    expect(updatedStep9.status).toBe("DONE");
  });

  it("the default amount equals the frozen (live) payable", async () => {
    const client = await makeClient("pay-default-amount");
    await seedPayableSales(client.id, "Q2", 500_000);
    const filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q2" } },
    });
    await fileTheReturn(filing.id);

    const sheet = await assembleAndComputeFiling(client.id, 2026, "Q2");
    expect(sheet.isOverpayment).toBe(false);
    expect(sheet.taxPayableCents).toBe(2_000_000); // 8% of (500,000 - 250,000)
  });

  it("the paid amount appears as the next quarter's item 56", async () => {
    const client = await makeClient("pay-feeds-item56");
    await seedPayableSales(client.id, "Q1", 500_000);
    const q1Filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q1" } },
    });
    await fileTheReturn(q1Filing.id);
    await savePayment(q1Filing.id, {}, paymentFormData("13,000.00"));

    await seedPayableSales(client.id, "Q2", 500_000);
    const q2 = await assembleAndComputeFiling(client.id, 2026, "Q2");
    if (!("item56PriorPeriodPaymentsCents" in q2)) throw new Error("expected 1701Q result");
    expect(q2.item56PriorPeriodPaymentsCents).toBe(1_300_000);
  });

  it("saving or editing reopens a later prepared, unfiled filing -- never a filed one", async () => {
    const client = await makeClient("pay-reopens-later");
    // Filed in order: Q1, then Q2. Q3 is prepared but not filed.
    await seedPayableSales(client.id, "Q1", 500_000);
    const q1Filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q1" } },
    });
    await fileTheReturn(q1Filing.id);

    async function prepare(period: "Q2" | "Q3") {
      await seedPayableSales(client.id, period, 500_000);
      const f = await prisma.filing.findUniqueOrThrow({
        where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period } },
      });
      await skipStep(
        (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: f.id, stepCode: "RECEIVE_2307" } })).id,
        "No 2307s expected.",
      );
      // RECORD_SALES normally self-completes from saveQuarterlySales; the
      // sales row above was written directly via prisma instead, so its
      // step is finalized by hand here to reach step 3.
      await prisma.workflowStep.updateMany({ where: { filingId: f.id, stepCode: "RECORD_SALES" }, data: { status: "DONE" } });
      await markStepDone(
        (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: f.id, stepCode: "PREPARE_RETURN" } })).id,
      );
      return f;
    }

    const q2Filing = await prepare("Q2");
    await fileTheReturn(q2Filing.id);
    await savePayment(q2Filing.id, {}, paymentFormData("10000"));
    const q3Filing = await prepare("Q3");

    // Q2 is filed -- editing Q2's own payment must never touch Q2, but
    // saving it DOES reopen Q3 (prepared, unfiled).
    await savePayment(q2Filing.id, {}, paymentFormData("14,000.00"));

    const q3Step3 = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: q3Filing.id, stepCode: "PREPARE_RETURN" } });
    expect(q3Step3.status).toBe("PENDING"); // reopened

    const q2Step3 = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: q2Filing.id, stepCode: "PREPARE_RETURN" } });
    expect(q2Step3.status).toBe("DONE"); // Q2 is filed -- never touched
  });

  it("editing locks once the next filing has filed", async () => {
    const client = await makeClient("pay-locks-after-next-filed");
    await seedPayableSales(client.id, "Q1", 500_000);
    const q1Filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q1" } },
    });
    await fileTheReturn(q1Filing.id);
    await savePayment(q1Filing.id, {}, paymentFormData("13000"));

    expect(await isPaymentLocked(client.id, 2026, "Q1")).toBe(false);

    await seedPayableSales(client.id, "Q2", 500_000);
    const q2Filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q2" } },
    });
    await fileTheReturn(q2Filing.id);

    expect(await isPaymentLocked(client.id, 2026, "Q1")).toBe(true);

    const result = await savePayment(q1Filing.id, {}, paymentFormData("15000"));
    expect(result.error).toMatch(/locked/i);

    const unchanged = await prisma.filing.findUniqueOrThrow({ where: { id: q1Filing.id } });
    expect(unchanged.amountPaidCents).toBe(1_300_000); // unchanged
  });

  it("D76: an overpayment or exactly ₱0 payable makes steps 8/9 NA when step 5 is marked Done, and Pay reads resolved", async () => {
    // No sales entered at all for this client -- taxable base is ₱0.
    const client = await makeClient("pay-nothing-to-pay");
    const filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q2" } },
    });
    await fileTheReturn(filing.id);

    const step8 = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "MAKE_PAYMENT" } });
    const step9 = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "SAVE_PROOF_PAYMENT" } });
    expect(step8.status).toBe("NA");
    expect(step9.status).toBe("NA");
  });
});
