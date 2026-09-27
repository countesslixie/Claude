import { describe, it, expect, afterAll, vi } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { saveStartingFigures } from "@/lib/actions/startingFigures";
import { markStepDone, skipStep } from "@/lib/actions/workflowSteps";
import { saveQuarterlySales } from "@/lib/actions/quarterlySales";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * Brief #5f §8 — starting figures for a client joining mid-year. Editable
 * until the year's first in-app return is filed (step 5, FILE_RETURN,
 * DONE), enforced server-side. A saved change reopens any unfiled filing
 * of the year whose own step 3 is Done.
 */
describe("saveStartingFigures", () => {
  const createdClientIds: string[] = [];
  const clientCodes: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.document.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.startingFigures.deleteMany({ where: { clientId: { in: createdClientIds } } });
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

  function startingFiguresFormData(overrides: Record<string, string> = {}): FormData {
    const fd = new FormData();
    fd.set("latestOutsideReturn", "Q2");
    fd.set("priorYearExcessCredit", "5000");
    fd.set("cumulativeIncome", "500000");
    fd.set("withholdingPreviousQuarters", "10000");
    fd.set("withholdingThisQuarter", "15000");
    fd.set("paymentsPreviousQuarters", "2000");
    fd.set("amountPaidThisReturn", "8000");
    fd.set("otherCredits", "0");
    fd.set("otherCreditsDescription", "");
    fd.set("nonOperatingIncome", "0");
    for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
    return fd;
  }

  async function makeClientWithYear(codePrefix: string) {
    const code = `${codePrefix}-${Date.now()}`;
    clientCodes.push(code);
    const client = await prisma.client.create({
      data: {
        code,
        registeredName: "Starting Figures Action Test Client",
        tin: "111222333",
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
    return client;
  }

  it("saves starting figures and writes item 55 through to ClientTaxYear", async () => {
    const client = await makeClientWithYear("sfa-save");

    const result = await saveStartingFigures(client.id, 2026, {}, startingFiguresFormData());
    expect(result.saved).toBe(true);

    const saved = await prisma.startingFigures.findUniqueOrThrow({
      where: { clientId_taxableYear: { clientId: client.id, taxableYear: 2026 } },
    });
    expect(saved.latestOutsideReturn).toBe("Q2");
    expect(saved.cumulativeIncomeCents).toBe(500_000_00);

    const taxYear = await prisma.clientTaxYear.findUniqueOrThrow({
      where: { clientId_taxableYear: { clientId: client.id, taxableYear: 2026 } },
    });
    expect(taxYear.priorYearExcessCreditCents).toBe(5_000_00);
  });

  it("refuses non-operating income above cumulative income", async () => {
    const client = await makeClientWithYear("sfa-nonop-refused");

    const result = await saveStartingFigures(
      client.id,
      2026,
      {},
      startingFiguresFormData({ cumulativeIncome: "100000", nonOperatingIncome: "200000" }),
    );
    expect(result.fieldErrors?.nonOperatingIncome).toBeTruthy();

    const saved = await prisma.startingFigures.findUnique({
      where: { clientId_taxableYear: { clientId: client.id, taxableYear: 2026 } },
    });
    expect(saved).toBeNull();
  });

  it("requires a description once other credits is above zero", async () => {
    const client = await makeClientWithYear("sfa-desc-required");

    const result = await saveStartingFigures(
      client.id,
      2026,
      {},
      startingFiguresFormData({ otherCredits: "500", otherCreditsDescription: "" }),
    );
    expect(result.fieldErrors?.otherCreditsDescription).toBeTruthy();
  });

  it("skips the not-None fields' validation entirely when latestOutsideReturn is NONE", async () => {
    const client = await makeClientWithYear("sfa-none");

    const result = await saveStartingFigures(
      client.id,
      2026,
      {},
      startingFiguresFormData({ latestOutsideReturn: "NONE", nonOperatingIncome: "999999", otherCredits: "500", otherCreditsDescription: "" }),
    );
    expect(result.saved).toBe(true);
  });

  it("a saved change reopens a prepared, unfiled filing of the year", async () => {
    const client = await makeClientWithYear("sfa-reopen");
    await saveStartingFigures(client.id, 2026, {}, startingFiguresFormData());
    await generateFilingsForClientYear(client.id, 2026);

    const q3 = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q3" } },
    });
    await saveQuarterlySales(client.id, 2026, "Q3", {}, (() => {
      const fd = new FormData();
      fd.set("intent", "final");
      fd.append("customerName", "Client A");
      fd.append("amount", "100000");
      return fd;
    })());
    await skipStep(
      (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: q3.id, stepCode: "RECEIVE_2307" } })).id,
      "No 2307s expected.",
    );
    const step3 = await prisma.workflowStep.findFirstOrThrow({ where: { filingId: q3.id, stepCode: "PREPARE_RETURN" } });
    await markStepDone(step3.id);
    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step3.id } })).status).toBe("DONE");

    // Change a starting figure — this is a figure change like any other.
    await saveStartingFigures(client.id, 2026, {}, startingFiguresFormData({ cumulativeIncome: "600000" }));

    expect((await prisma.workflowStep.findUniqueOrThrow({ where: { id: step3.id } })).status).toBe("PENDING");
  });

  it("is locked once the year's first in-app return is filed, enforced server-side", async () => {
    const client = await makeClientWithYear("sfa-locked");
    await saveStartingFigures(client.id, 2026, {}, startingFiguresFormData());
    await generateFilingsForClientYear(client.id, 2026);

    const q3 = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q3" } },
    });
    await skipStep(
      (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: q3.id, stepCode: "RECEIVE_2307" } })).id,
      "No 2307s expected.",
    );
    await markStepDone(
      (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: q3.id, stepCode: "PREPARE_RETURN" } })).id,
    );
    await markStepDone(
      (await prisma.workflowStep.findFirstOrThrow({ where: { filingId: q3.id, stepCode: "FILE_RETURN" } })).id,
    );

    const result = await saveStartingFigures(client.id, 2026, {}, startingFiguresFormData({ cumulativeIncome: "700000" }));
    expect(result.error).toMatch(/locked/i);

    const saved = await prisma.startingFigures.findUniqueOrThrow({
      where: { clientId_taxableYear: { clientId: client.id, taxableYear: 2026 } },
    });
    expect(saved.cumulativeIncomeCents).toBe(500_000_00); // unchanged
  });
});
