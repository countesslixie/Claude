import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { generateFilingsForClientYear, recomputeRequiresSawt } from "@/lib/workflow/filingGeneration";

/**
 * Phase 3: filing generation iterates ALL_PERIODS (SPEC.md 3.6, §16 item
 * 6), computes correct statutory/adjusted due dates and working-calendar
 * targets via lib/tax/deadlines.ts, and instantiates the full 16-step
 * checklist per filing (SPEC.md 7.1) with the SAWT-conditional and
 * RECEIVE_2307 rules Phase 2 deliberately left unwired.
 */
describe("generateFilingsForClientYear", () => {
  const createdClientIds: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.workflowStep.deleteMany({ where: { filing: { clientId: { in: createdClientIds } } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.form2307.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  });

  it("generates exactly Q1/Q2/Q3/ANNUAL — never Q4 — with correct due dates and working calendar", async () => {
    const client = await prisma.client.create({
      data: {
        code: `p3-gen-test-${Date.now()}`,
        registeredName: "Phase 3 Filing Generation Test Client",
        tin: "222333444",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
        defaultWithholdingRateBps: 500, // expects Form 2307s
      },
    });
    createdClientIds.push(client.id);

    const result = await generateFilingsForClientYear(client.id, 2026);
    expect(result.createdPeriods.sort()).toEqual(["ANNUAL", "Q1", "Q2", "Q3"]);
    expect(result.skippedPeriods).toEqual([]);

    const filings = await prisma.filing.findMany({
      where: { clientId: client.id, taxableYear: 2026 },
      orderBy: { period: "asc" },
    });
    expect(filings).toHaveLength(4);
    expect(filings.map((f) => f.period).sort()).toEqual(["ANNUAL", "Q1", "Q2", "Q3"]);
    expect(filings.some((f) => (f.period as string) === "Q4")).toBe(false);

    const byPeriod = Object.fromEntries(filings.map((f) => [f.period, f]));

    expect(byPeriod.Q1.statutoryDueDate).toEqual(new Date("2026-05-15T00:00:00.000Z"));
    expect(byPeriod.Q1.adjustedDueDate).toEqual(new Date("2026-05-15T00:00:00.000Z")); // Friday, no shift

    expect(byPeriod.Q2.statutoryDueDate).toEqual(new Date("2026-08-15T00:00:00.000Z"));
    expect(byPeriod.Q2.adjustedDueDate).toEqual(new Date("2026-08-17T00:00:00.000Z")); // Saturday -> Monday

    expect(byPeriod.Q3.statutoryDueDate).toEqual(new Date("2026-11-15T00:00:00.000Z"));
    expect(byPeriod.Q3.adjustedDueDate).toEqual(new Date("2026-11-16T00:00:00.000Z")); // Sunday -> Monday

    expect(byPeriod.ANNUAL.statutoryDueDate).toEqual(new Date("2027-04-15T00:00:00.000Z")); // following year
    expect(byPeriod.ANNUAL.formType).toBe("F1701A"); // purely self-employed

    // Working calendar (Phase 2b P7 pattern, generalized). Quarterly
    // internalFilingTarget is the ADJUSTED due date (Aug 17, Mon) -- not
    // the statutory date (Aug 15, Sat) -- no internal buffer by design;
    // certificatesExpectedBy stays anchored to the statutory date.
    expect(byPeriod.Q2.certificatesExpectedBy).toEqual(new Date("2026-08-05T00:00:00.000Z"));
    expect(byPeriod.Q2.internalFilingTarget).toEqual(new Date("2026-08-17T00:00:00.000Z"));
    expect(byPeriod.ANNUAL.certificatesExpectedBy).toEqual(new Date("2027-02-15T00:00:00.000Z"));
    expect(byPeriod.ANNUAL.internalFilingTarget).toEqual(new Date("2027-03-31T00:00:00.000Z"));

    // requiresSawt starts false (zero certificates exist yet), not
    // assumed true just because the client generally expects them.
    expect(filings.every((f) => f.requiresSawt === false)).toBe(true);
  });

  it("re-running for the same client/year skips periods that already exist and creates nothing new", async () => {
    const client = await prisma.client.create({
      data: {
        code: `p3-gen-rerun-${Date.now()}`,
        registeredName: "Phase 3 Rerun Test Client",
        tin: "333444555",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "MIXED_INCOME",
        booksType: "MANUAL",
      },
    });
    createdClientIds.push(client.id);

    const first = await generateFilingsForClientYear(client.id, 2026);
    expect(first.createdPeriods).toHaveLength(4);

    const second = await generateFilingsForClientYear(client.id, 2026);
    expect(second.createdPeriods).toEqual([]);
    expect(second.skippedPeriods.sort()).toEqual(["ANNUAL", "Q1", "Q2", "Q3"]);

    const count = await prisma.filing.count({ where: { clientId: client.id, taxableYear: 2026 } });
    expect(count).toBe(4); // not 8
  });

  it("instantiates the full 16-step checklist per filing, with steps 11-14 NA and RECEIVE_2307 waiting from certificatesExpectedBy", async () => {
    const client = await prisma.client.create({
      data: {
        code: `p3-gen-steps-${Date.now()}`,
        registeredName: "Phase 3 Steps Test Client",
        tin: "444555666",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
        defaultWithholdingRateBps: 500,
      },
    });
    createdClientIds.push(client.id);

    await generateFilingsForClientYear(client.id, 2026);
    const q2 = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q2" } },
    });
    const steps = await prisma.workflowStep.findMany({ where: { filingId: q2.id }, orderBy: { sequence: "asc" } });

    expect(steps).toHaveLength(16);

    // §16 item 12: zero 2307s yet -> steps 11-14 auto-NA.
    const conditionalSteps = steps.filter((s) => s.isConditional);
    expect(conditionalSteps).toHaveLength(4);
    expect(conditionalSteps.every((s) => s.status === "NA")).toBe(true);

    // RECEIVE_2307's waiting clock starts from certificatesExpectedBy (SPEC.md 3.6).
    const receive2307 = steps.find((s) => s.stepCode === "RECEIVE_2307")!;
    expect(receive2307.status).toBe("WAITING_EXTERNAL");
    expect(receive2307.waitingOnLabel).toBe("Client");
    expect(receive2307.waitingSince).toEqual(q2.certificatesExpectedBy);
  });

  it("skips RECEIVE_2307 entirely for a client with no withholding relationship", async () => {
    const client = await prisma.client.create({
      data: {
        code: `p3-gen-no2307-${Date.now()}`,
        registeredName: "Phase 3 No-2307 Test Client",
        tin: "555666777",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
        // defaultWithholdingRateBps left null
      },
    });
    createdClientIds.push(client.id);

    await generateFilingsForClientYear(client.id, 2026);
    const q1 = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q1" } },
    });
    const receive2307 = await prisma.workflowStep.findFirstOrThrow({
      where: { filingId: q1.id, stepCode: "RECEIVE_2307" },
    });
    expect(receive2307.status).toBe("SKIPPED");
    expect(receive2307.skippedReason).toBeTruthy();
  });

  it("recomputeRequiresSawt flips requiresSawt true and un-NA's steps 11-14 once a certificate exists", async () => {
    const client = await prisma.client.create({
      data: {
        code: `p3-gen-recompute-${Date.now()}`,
        registeredName: "Phase 3 Recompute Test Client",
        tin: "666777888",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
        defaultWithholdingRateBps: 500,
      },
    });
    createdClientIds.push(client.id);

    await generateFilingsForClientYear(client.id, 2026);
    await prisma.form2307.create({
      data: {
        clientId: client.id,
        taxableYear: 2026,
        payorName: "Test Payor",
        payorTin: "111222333",
        periodFrom: new Date("2026-04-01T00:00:00.000Z"),
        periodTo: new Date("2026-06-30T00:00:00.000Z"),
        quarterCovered: 2,
        atcCode: "WI010",
        incomePaymentCents: 10_000_00,
        taxWithheldCents: 500_00,
        withholdingRateBps: 500,
        status: "RECORDED",
      },
    });

    await recomputeRequiresSawt(client.id, 2026, "Q2");

    const q2 = await prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q2" } },
    });
    expect(q2.requiresSawt).toBe(true);

    const steps = await prisma.workflowStep.findMany({ where: { filingId: q2.id, isConditional: true } });
    expect(steps.every((s) => s.status === "PENDING")).toBe(true);
  });
});
