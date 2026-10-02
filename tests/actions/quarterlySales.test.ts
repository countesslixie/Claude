import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { saveQuarterlySales } from "@/lib/actions/quarterlySales";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";
import { markStepDone, skipStep } from "@/lib/actions/workflowSteps";
import { markEarlierQuartersFiled, resolvePrepare } from "../helpers/filedEarlier";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * Brief #4b (D33) — declared gross sales is now the sum of per-customer
 * rows, never itself typed; a quarter's own filing's step 1 (RECORD_SALES)
 * self-completes on a final Save and stays editable until that filing's
 * own return is filed.
 *
 * Brief #4d supersedes #4b's original "once done, further edits never
 * undo it": saving a final quarter as a draft afterward now reverts
 * step 1 back to open, matching the income page's new Edit/Cancel flow.
 */
describe("saveQuarterlySales", () => {
  const createdClientIds: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.quarterlySalesCustomer.deleteMany({ where: { quarterlySales: { clientId: { in: createdClientIds } } } });
    await prisma.quarterlySales.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.startingFigures.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.workflowStep.deleteMany({ where: { filing: { clientId: { in: createdClientIds } } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.clientTaxYear.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  });

  function formDataOf(
    fields: Record<string, string>,
    customers: { customerName: string; amount: string }[] = [],
  ): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    for (const row of customers) {
      fd.append("customerName", row.customerName);
      fd.append("amount", row.amount);
    }
    return fd;
  }

  async function makeClientWithQ2Filing(codePrefix: string) {
    const code = `${codePrefix}-${Date.now()}`;
    const client = await prisma.client.create({
      data: {
        code,
        registeredName: "Quarterly Sales Action Test Client",
        tin: "888777666",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    createdClientIds.push(client.id);
    await generateFilingsForClientYear(client.id, 2026);
    await markEarlierQuartersFiled(client.id, 2026, "Q2");
    const filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q2" } },
    });
    return { client, filing };
  }

  it("gross sales is the sum of the per-customer rows, never a typed total", async () => {
    const { client } = await makeClientWithQ2Filing("qs-sum");

    const result = await saveQuarterlySales(
      client.id,
      2026,
      "Q2",
      {},
      formDataOf({ intent: "draft" }, [
        { customerName: "Alpha Corp", amount: "10,000" },
        { customerName: "Beta Inc", amount: "5,500.50" },
      ]),
    );
    expect(result.saved).toBe(true);

    const row = await prisma.quarterlySales.findUniqueOrThrow({
      where: { clientId_taxableYear_quarter: { clientId: client.id, taxableYear: 2026, quarter: "Q2" } },
      include: { customers: true },
    });
    expect(row.grossSalesCents).toBe(1_550_050);
    expect(row.customers).toHaveLength(2);
  });

  it("Save as draft stores the rows and leaves step 1 not done", async () => {
    const { client, filing } = await makeClientWithQ2Filing("qs-draft");

    await saveQuarterlySales(
      client.id,
      2026,
      "Q2",
      {},
      formDataOf({ intent: "draft" }, [{ customerName: "Client A", amount: "1000" }]),
    );

    const step = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECORD_SALES" } });
    expect(step.status).not.toBe("DONE");
  });

  it("Save marks step 1 done automatically, and re-saving final afterward keeps it done", async () => {
    const { client, filing } = await makeClientWithQ2Filing("qs-final");

    const result = await saveQuarterlySales(
      client.id,
      2026,
      "Q2",
      {},
      formDataOf({ intent: "final" }, [{ customerName: "Client A", amount: "1000" }]),
    );
    expect(result.finalized).toBe(true);
    expect(result.savedAt).toBeTruthy();

    let step = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECORD_SALES" } });
    expect(step.status).toBe("DONE");

    // Re-saving final afterward keeps step 1 done.
    await saveQuarterlySales(
      client.id,
      2026,
      "Q2",
      {},
      formDataOf({ intent: "final" }, [{ customerName: "Client A", amount: "2000" }]),
    );
    step = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECORD_SALES" } });
    expect(step.status).toBe("DONE");
  });

  it("brief #4d: saving a final quarter as a draft afterward reverts step 1 to open", async () => {
    const { client, filing } = await makeClientWithQ2Filing("qs-revert-to-draft");

    const finalResult = await saveQuarterlySales(
      client.id,
      2026,
      "Q2",
      {},
      formDataOf({ intent: "final" }, [{ customerName: "Client A", amount: "1000" }]),
    );
    expect(finalResult.finalized).toBe(true);
    let step = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECORD_SALES" } });
    expect(step.status).toBe("DONE");

    const draftResult = await saveQuarterlySales(
      client.id,
      2026,
      "Q2",
      {},
      formDataOf({ intent: "draft" }, [{ customerName: "Client A", amount: "2000" }]),
    );
    expect(draftResult.finalized).toBe(false);

    step = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECORD_SALES" } });
    expect(step.status).toBe("WAITING_EXTERNAL");

    const row = await prisma.quarterlySales.findUniqueOrThrow({
      where: { clientId_taxableYear_quarter: { clientId: client.id, taxableYear: 2026, quarter: "Q2" } },
    });
    expect(row.finalizedAt).toBeNull();
  });

  it('"No sales this quarter" saves a deliberate ₱0, ignoring any typed rows', async () => {
    const { client } = await makeClientWithQ2Filing("qs-nosales");

    const fd = formDataOf({ intent: "final", noSalesThisQuarter: "on" }, [{ customerName: "Ignored", amount: "999" }]);
    const result = await saveQuarterlySales(client.id, 2026, "Q2", {}, fd);
    expect(result.saved).toBe(true);

    const row = await prisma.quarterlySales.findUniqueOrThrow({
      where: { clientId_taxableYear_quarter: { clientId: client.id, taxableYear: 2026, quarter: "Q2" } },
      include: { customers: true },
    });
    expect(row.grossSalesCents).toBe(0);
    expect(row.noSalesThisQuarter).toBe(true);
    expect(row.customers).toHaveLength(0);
  });

  it("a final Save with no rows and no 'no sales' flag is rejected", async () => {
    const { client } = await makeClientWithQ2Filing("qs-empty-final");

    const result = await saveQuarterlySales(client.id, 2026, "Q2", {}, formDataOf({ intent: "final" }, []));
    expect(result.saved).toBeUndefined();
    expect(result.fieldErrors?.customers).toBeTruthy();
  });

  it("a quarter is locked once its own filing's step 5 (FILE_RETURN) is done", async () => {
    const { client, filing } = await makeClientWithQ2Filing("qs-locked");

    const fileReturnStep = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: filing.id, stepCode: "FILE_RETURN" },
    });
    await resolvePrepare(fileReturnStep.filingId);
    await markStepDone(fileReturnStep.id);

    const result = await saveQuarterlySales(
      client.id,
      2026,
      "Q2",
      {},
      formDataOf({ intent: "final" }, [{ customerName: "Too late", amount: "1000" }]),
    );
    expect(result.error).toMatch(/locked/i);

    const row = await prisma.quarterlySales.findUnique({
      where: { clientId_taxableYear_quarter: { clientId: client.id, taxableYear: 2026, quarter: "Q2" } },
    });
    expect(row).toBeNull(); // nothing was written
  });

  describe("brief #5i §2: a figures-changing income save un-skips a Skipped step 2", () => {
    async function makeClientWithQ2SkippedStep2(codePrefix: string) {
      const { client, filing } = await makeClientWithQ2Filing(codePrefix);
      await saveQuarterlySales(
        client.id,
        2026,
        "Q2",
        {},
        formDataOf({ intent: "final" }, [{ customerName: "Client A", amount: "1000" }]),
      );
      const step2 = await prisma.workflowStep.findFirstOrThrow({
        where: { filingId: filing.id, stepCode: "RECEIVE_2307" },
      });
      await skipStep(step2.id, "No 2307s expected this quarter.");
      return { client, filing, step2 };
    }

    it("a figures-changing final save un-skips step 2 and keeps the reason in history", async () => {
      const { client, filing, step2 } = await makeClientWithQ2SkippedStep2("qs-unskip-final-changed");

      await saveQuarterlySales(
        client.id,
        2026,
        "Q2",
        {},
        formDataOf({ intent: "final" }, [{ customerName: "Client A", amount: "2000" }]),
      );

      const updated = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step2.id } });
      expect(updated.status).not.toBe("SKIPPED");

      const logEntry = await prisma.activityLog.findFirst({
        where: { entityType: "WorkflowStep", entityId: step2.id },
        orderBy: { at: "desc" },
      });
      const before = JSON.parse(logEntry?.beforeJson as string);
      expect(before).toMatchObject({ skippedReason: "No Form 2307 received from this client." });
    });

    it("a draft save of a previously-final step 1 also un-skips step 2", async () => {
      const { client, filing, step2 } = await makeClientWithQ2SkippedStep2("qs-unskip-draft-of-final");

      await saveQuarterlySales(
        client.id,
        2026,
        "Q2",
        {},
        formDataOf({ intent: "draft" }, [{ customerName: "Client A", amount: "1000" }]),
      );

      const updated = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step2.id } });
      expect(updated.status).not.toBe("SKIPPED");
      void filing;
    });

    it("a final save with no change to the figures does NOT un-skip step 2", async () => {
      const { client, step2 } = await makeClientWithQ2SkippedStep2("qs-unskip-no-change");

      // Same customer name and amount as setup -- no figures change.
      await saveQuarterlySales(
        client.id,
        2026,
        "Q2",
        {},
        formDataOf({ intent: "final" }, [{ customerName: "Client A", amount: "1000" }]),
      );

      const updated = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step2.id } });
      expect(updated.status).toBe("SKIPPED");
    });

    it("a filed filing (step 5 Done) is untouched -- the save itself is refused before any un-skip logic runs", async () => {
      const { client, filing, step2 } = await makeClientWithQ2SkippedStep2("qs-unskip-filed");

      await prisma.workflowStep.updateMany({
        where: { filingId: filing.id, stepCode: "FILE_RETURN" },
        data: { status: "DONE" },
      });

      const result = await saveQuarterlySales(
        client.id,
        2026,
        "Q2",
        {},
        formDataOf({ intent: "final" }, [{ customerName: "Client A", amount: "9999" }]),
      );
      expect(result.error).toMatch(/locked/i);

      const unchanged = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step2.id } });
      expect(unchanged.status).toBe("SKIPPED");
    });
  });

  it("brief #5f §8: sales can't be entered for a quarter filed outside the app", async () => {
    const client = await prisma.client.create({
      data: {
        code: `qs-outside-${Date.now()}`,
        registeredName: "Quarterly Sales Outside-The-App Test Client",
        tin: "555666778",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    createdClientIds.push(client.id);
    const taxYear = await prisma.clientTaxYear.create({
      data: { clientId: client.id, taxableYear: 2026, regime: "RATE_8_PERCENT", electionStatus: "ELECTED" },
    });
    await prisma.startingFigures.create({
      data: { clientId: client.id, taxableYear: 2026, clientTaxYearId: taxYear.id, latestOutsideReturn: "Q2" },
    });

    const result = await saveQuarterlySales(
      client.id,
      2026,
      "Q1",
      {},
      formDataOf({ intent: "final" }, [{ customerName: "Too early", amount: "1000" }]),
    );
    expect(result.error).toMatch(/outside the app/i);

    const row = await prisma.quarterlySales.findUnique({
      where: { clientId_taxableYear_quarter: { clientId: client.id, taxableYear: 2026, quarter: "Q1" } },
    });
    expect(row).toBeNull();
  });
});
