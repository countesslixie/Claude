import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { saveQuarterlySales } from "@/lib/actions/quarterlySales";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";
import { markStepDone } from "@/lib/actions/workflowSteps";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * Brief #4b (D33) — declared gross sales is now the sum of per-customer
 * rows, never itself typed; a quarter's own filing's step 1 (RECORD_SALES)
 * self-completes on a final Save and stays editable (without un-doing
 * step 1) until that filing's own return is filed.
 */
describe("saveQuarterlySales", () => {
  const createdClientIds: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.quarterlySalesCustomer.deleteMany({ where: { quarterlySales: { clientId: { in: createdClientIds } } } });
    await prisma.quarterlySales.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.workflowStep.deleteMany({ where: { filing: { clientId: { in: createdClientIds } } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: createdClientIds } } });
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

  it("Save marks step 1 done automatically, and editing afterward keeps it done", async () => {
    const { client, filing } = await makeClientWithQ2Filing("qs-final");

    const result = await saveQuarterlySales(
      client.id,
      2026,
      "Q2",
      {},
      formDataOf({ intent: "final" }, [{ customerName: "Client A", amount: "1000" }]),
    );
    expect(result.finalized).toBe(true);

    let step = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECORD_SALES" } });
    expect(step.status).toBe("DONE");

    // Editing it (even as a draft save) afterward keeps step 1 done.
    await saveQuarterlySales(
      client.id,
      2026,
      "Q2",
      {},
      formDataOf({ intent: "draft" }, [{ customerName: "Client A", amount: "2000" }]),
    );
    step = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: filing.id, stepCode: "RECORD_SALES" } });
    expect(step.status).toBe("DONE");
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
});
