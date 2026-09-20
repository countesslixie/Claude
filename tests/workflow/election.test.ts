import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { isElectionBlocked } from "@/lib/workflow/election";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";
import { markStepDone } from "@/lib/actions/workflowSteps";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * Rework brief §7 — the one genuine hard block left in the system
 * (D27's single exception to "nothing in the checklist blocks"). Guards
 * a wrong tax rate: a Q1 filing for a client whose election isn't
 * confirmed ELECTED cannot be marked DONE on any step.
 */
describe("isElectionBlocked (pure)", () => {
  it("blocks Q1 for every election status except ELECTED", () => {
    expect(isElectionBlocked("Q1", "NOT_YET_ELECTED")).toBe(true);
    expect(isElectionBlocked("Q1", "DEFAULTED_GRADUATED")).toBe(true);
    expect(isElectionBlocked("Q1", null)).toBe(true);
    expect(isElectionBlocked("Q1", undefined)).toBe(true);
  });

  it("never blocks Q1 once ELECTED", () => {
    expect(isElectionBlocked("Q1", "ELECTED")).toBe(false);
  });

  it("never blocks Q2, Q3, or ANNUAL regardless of election status", () => {
    for (const period of ["Q2", "Q3", "ANNUAL"] as const) {
      expect(isElectionBlocked(period, "NOT_YET_ELECTED")).toBe(false);
      expect(isElectionBlocked(period, null)).toBe(false);
    }
  });
});

describe("election hard-blocker wired into markStepDone", () => {
  const createdClientIds: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.workflowStep.deleteMany({ where: { filing: { clientId: { in: createdClientIds } } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.clientTaxYear.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  });

  it("blocks every step of a Q1 filing until the election is confirmed ELECTED, then allows it", async () => {
    const client = await prisma.client.create({
      data: {
        code: `election-block-${Date.now()}`,
        registeredName: "Election Blocker Test Client",
        tin: "222333444",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    createdClientIds.push(client.id);

    await prisma.clientTaxYear.create({
      data: { clientId: client.id, taxableYear: 2026, regime: "RATE_8_PERCENT", electionStatus: "NOT_YET_ELECTED" },
    });

    await generateFilingsForClientYear(client.id, 2026);
    const q1Filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q1" } },
    });
    const q1Step = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: q1Filing.id, stepCode: "RECORD_CRJ" },
    });

    const blocked = await markStepDone(q1Step.id);
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/election/i);

    const unchanged = await prisma.workflowStep.findUniqueOrThrow({ where: { id: q1Step.id } });
    expect(unchanged.status).not.toBe("DONE");

    await prisma.clientTaxYear.update({
      where: { clientId_taxableYear: { clientId: client.id, taxableYear: 2026 } },
      data: { electionStatus: "ELECTED" },
    });

    const allowed = await markStepDone(q1Step.id);
    expect(allowed.ok).toBe(true);
    const updated = await prisma.workflowStep.findUniqueOrThrow({ where: { id: q1Step.id } });
    expect(updated.status).toBe("DONE");
  });

  it("does not block Q2/Q3/ANNUAL for the same unconfirmed-election client", async () => {
    const client = await prisma.client.create({
      data: {
        code: `election-noblock-${Date.now()}`,
        registeredName: "Election Non-Q1 Test Client",
        tin: "555444333",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    createdClientIds.push(client.id);

    await prisma.clientTaxYear.create({
      data: { clientId: client.id, taxableYear: 2026, regime: "RATE_8_PERCENT", electionStatus: "NOT_YET_ELECTED" },
    });

    await generateFilingsForClientYear(client.id, 2026);
    const q2Filing = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q2" } },
    });
    const q2Step = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: q2Filing.id, stepCode: "RECORD_CRJ" },
    });

    const allowed = await markStepDone(q2Step.id);
    expect(allowed.ok).toBe(true);
  });
});
