import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";
import { generateFilingsAction } from "@/lib/actions/filings";
import { quartersEndedBeforeEngagement } from "@/lib/workflow/midYearGuard";

/**
 * Brief #5n §1 (D78) — Generate refuses for a client engaged mid-year
 * with no starting figures; starting figures stay the only thing that
 * names a quarter as filed outside the app.
 */
describe("quartersEndedBeforeEngagement (pure)", () => {
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
  it("July 1 → Q1 and Q2", () => expect(quartersEndedBeforeEngagement(2026, d("2026-07-01"))).toEqual(["Q1", "Q2"]));
  it("Oct 1 → Q1, Q2 and Q3", () => expect(quartersEndedBeforeEngagement(2026, d("2026-10-01"))).toEqual(["Q1", "Q2", "Q3"]));
  it("April 1 → Q1 only", () => expect(quartersEndedBeforeEngagement(2026, d("2026-04-01"))).toEqual(["Q1"]));
  it("March 31 → nothing (Q1 had not ended yet)", () => expect(quartersEndedBeforeEngagement(2026, d("2026-03-31"))).toEqual([]));
  it("February 10 → nothing (no quarter had ended)", () => expect(quartersEndedBeforeEngagement(2026, d("2026-02-10"))).toEqual([]));
  it("January 1 → nothing", () => expect(quartersEndedBeforeEngagement(2026, d("2026-01-01"))).toEqual([]));
  it("no engagedSince → nothing", () => expect(quartersEndedBeforeEngagement(2026, null)).toEqual([]));
  it("engaged in a different year → nothing", () => {
    expect(quartersEndedBeforeEngagement(2026, d("2025-07-01"))).toEqual([]);
    expect(quartersEndedBeforeEngagement(2026, d("2027-07-01"))).toEqual([]);
  });
});

describe("generate filings — mid-year guard (D78)", () => {
  const ids: string[] = [];
  let n = 0;

  async function makeClient(engagedSince: string | null, name = "Testa Guard") {
    const client = await prisma.client.create({
      data: {
        code: `guard-test-${Date.now()}-${n++}`,
        registeredName: name,
        tin: "222333444",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
        engagedSince: engagedSince ? new Date(`${engagedSince}T00:00:00.000Z`) : null,
      },
    });
    ids.push(client.id);
    return client;
  }
  async function saveFigures(clientId: string, latestOutsideReturn: "NONE" | "Q1" | "Q2" | "Q3") {
    const ty =
      (await prisma.clientTaxYear.findUnique({ where: { clientId_taxableYear: { clientId, taxableYear: 2026 } } })) ??
      (await prisma.clientTaxYear.create({
        data: { clientId, taxableYear: 2026, regime: "RATE_8_PERCENT", electionStatus: "ELECTED", yearEndCreditElection: "CARRY_OVER" },
      }));
    await prisma.startingFigures.create({ data: { clientId, taxableYear: 2026, clientTaxYearId: ty.id, latestOutsideReturn } });
  }

  afterAll(async () => {
    await prisma.workflowStep.deleteMany({ where: { filing: { clientId: { in: ids } } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: ids } } });
    await prisma.startingFigures.deleteMany({ where: { clientId: { in: ids } } });
    await prisma.clientTaxYear.deleteMany({ where: { clientId: { in: ids } } });
    await prisma.client.deleteMany({ where: { id: { in: ids } } });
  });

  it("refuses for a July 1 client with no starting figures, names the quarters, creates nothing", async () => {
    const client = await makeClient("2026-07-01", "Testa Guard");
    await expect(generateFilingsForClientYear(client.id, 2026)).rejects.toThrow(
      "Testa started July 1, 2026. Enter Testa's starting figures first, so Q1 and Q2 aren't created as work.",
    );
    expect(await prisma.filing.count({ where: { clientId: client.id } })).toBe(0);
  });

  it("the action refuses too, and links to add the tax year when none exists yet", async () => {
    const client = await makeClient("2026-07-01");
    const result = await generateFilingsAction(client.id, 2026);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Q1 and Q2");
    expect(result.startingFiguresHref).toBe(`/clients/${client.id}/tax-years/new`);

    const ty = await prisma.clientTaxYear.create({
      data: { clientId: client.id, taxableYear: 2026, regime: "RATE_8_PERCENT", electionStatus: "ELECTED", yearEndCreditElection: "CARRY_OVER" },
    });
    const again = await generateFilingsAction(client.id, 2026);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.startingFiguresHref).toBe(`/clients/${client.id}/tax-years/${ty.id}/starting-figures`);
  });

  it("allowed once starting figures are saved — outside Q2 means only Q3 and Annual", async () => {
    const client = await makeClient("2026-07-01");
    await saveFigures(client.id, "Q2");
    const result = await generateFilingsForClientYear(client.id, 2026);
    expect(result.createdPeriods.sort()).toEqual(["ANNUAL", "Q3"]);
    expect(result.outsidePeriods.sort()).toEqual(["Q1", "Q2"]);
  });

  it("allowed with 'none' — all four are created", async () => {
    const client = await makeClient("2026-07-01");
    await saveFigures(client.id, "NONE");
    const result = await generateFilingsForClientYear(client.id, 2026);
    expect(result.createdPeriods.sort()).toEqual(["ANNUAL", "Q1", "Q2", "Q3"]);
  });

  it("engagedSince alone never excludes a quarter (starting figures 'none' + July 1 still makes Q1)", async () => {
    const client = await makeClient("2026-07-01");
    await saveFigures(client.id, "NONE");
    const result = await generateFilingsForClientYear(client.id, 2026);
    expect(result.outsidePeriods).toEqual([]);
  });

  it("unaffected for a January 1 client, a February 10 client and a client with no engagedSince", async () => {
    for (const engaged of ["2026-01-01", "2026-02-10", null]) {
      const client = await makeClient(engaged);
      const result = await generateFilingsForClientYear(client.id, 2026);
      expect(result.createdPeriods.sort()).toEqual(["ANNUAL", "Q1", "Q2", "Q3"]);
    }
  });
});
