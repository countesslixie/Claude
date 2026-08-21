import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createQuickTransaction } from "@/lib/actions/salesTransactions";
import { applyBps } from "@/lib/money";

// createQuickTransaction calls revalidatePath, which requires a Next.js
// request/render context that doesn't exist under Vitest — mock it out so
// only the persisted-data behavior under test is exercised.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * P1 regression (Phase 2b): components/transaction-quick-entry.tsx used to
 * fall back to a client-side JS-float WHT preview (`String(autoWhtNum)`)
 * whenever the operator left the WHT field blank, smuggling that float into
 * the "explicit override" path server-side. The fix sends the field exactly
 * as typed (empty when blank) so the server always runs its own
 * Decimal.js-based applyBps() for auto-compute. This test proves the
 * persisted value matches the independently-computed server-side figure,
 * using a rate/gross pair where naive JS float math and Decimal.js
 * half-up rounding would disagree if a float ever leaked into the payload.
 */
describe("createQuickTransaction — server-side auto-compute WHT (P1)", () => {
  const createdClientIds: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.salesTransaction.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  });

  it("persists taxWithheldCents from server-side applyBps, not a client-supplied float, when withholdingAmount is blank", async () => {
    const client = await prisma.client.create({
      data: {
        code: `p1-test-${Date.now()}`,
        registeredName: "P1 Regression Test Client",
        tin: "123456789",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
        defaultWithholdingRateBps: 733, // deliberately odd rate to expose float drift
      },
    });
    createdClientIds.push(client.id);

    const grossAmount = "10333.33";
    const rateBps = 733;

    const result = await createQuickTransaction(client.id, {
      transactionDate: "2026-02-10",
      orNumber: "",
      payorName: "Test Payor",
      payorTin: "",
      grossAmount,
      withholdingRateBps: String(rateBps),
      withholdingAmount: "", // blank — server must auto-compute
      netReceivedOverride: "",
      incomeType: "OPERATING",
      description: "",
    });

    expect(result.ok).toBe(true);
    expect(result.createdId).toBeDefined();

    const created = await prisma.salesTransaction.findUniqueOrThrow({
      where: { id: result.createdId! },
    });

    const expectedGrossCents = 1033333;
    const expectedWithheldCents = applyBps(expectedGrossCents, rateBps);

    expect(created.grossAmountCents).toBe(expectedGrossCents);
    expect(created.withholdingTaxCents).toBe(expectedWithheldCents);
  });
});

/**
 * UTC/Manila sweep (this session): transactionDate is
 * manilaDateInputToJsDate()'s output -- Manila midnight, which is always
 * UTC 16:00 the PREVIOUS day. deriveTaxableYearAndQuarter used to read
 * getUTCFullYear()/getUTCMonth() straight off that instant, which is
 * wrong exactly when the transaction date is the 1st of a month (the only
 * time Manila midnight crosses a UTC month/year boundary): a transaction
 * dated Apr 1 would misfile into Q1 instead of Q2, and one dated Jan 1
 * would misfile into Q4 of the PREVIOUS taxable year -- a period this app
 * has no filing type for (SPEC.md 3.6: no Q4 return).
 */
describe("createQuickTransaction — taxableYear/quarter derived from the Manila calendar date, not raw UTC", () => {
  const createdClientIds: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.salesTransaction.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  });

  async function createTestClient() {
    const client = await prisma.client.create({
      data: {
        code: `month-boundary-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        registeredName: "Month Boundary Test Client",
        tin: "111222333",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
        defaultWithholdingRateBps: 500,
      },
    });
    createdClientIds.push(client.id);
    return client;
  }

  it("a transaction dated Apr 1 (Manila) is filed under Q2, not Q1", async () => {
    const client = await createTestClient();
    const result = await createQuickTransaction(client.id, {
      transactionDate: "2026-04-01",
      orNumber: "",
      payorName: "Test Payor",
      payorTin: "",
      grossAmount: "10000",
      withholdingRateBps: "500",
      withholdingAmount: "",
      netReceivedOverride: "",
      incomeType: "OPERATING",
      description: "",
    });
    expect(result.ok).toBe(true);
    const created = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: result.createdId! } });
    expect(created.taxableYear).toBe(2026);
    expect(created.quarter).toBe(2);
  });

  it("a transaction dated Jan 1 (Manila) is filed under the correct taxable year's Q1, not Q4 of the previous year", async () => {
    const client = await createTestClient();
    const result = await createQuickTransaction(client.id, {
      transactionDate: "2027-01-01",
      orNumber: "",
      payorName: "Test Payor",
      payorTin: "",
      grossAmount: "10000",
      withholdingRateBps: "500",
      withholdingAmount: "",
      netReceivedOverride: "",
      incomeType: "OPERATING",
      description: "",
    });
    expect(result.ok).toBe(true);
    const created = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: result.createdId! } });
    expect(created.taxableYear).toBe(2027);
    expect(created.quarter).toBe(1);
  });
});
