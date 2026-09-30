import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";
import { buildClientPackageEmailForFiling } from "@/lib/workflow/clientPackageEmailData";
import { backfillClientDocsDue } from "@/prisma/backfills";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/** D106 (brief #5s) — the client's document deadline: the 20th of the month after each period ends, from a setting. */
describe("client documents due (D106)", () => {
  const clientIds: string[] = [];
  let n = 0;
  let originalDay = 20;

  afterAll(async () => {
    await prisma.taxRuleSet.update({ where: { taxableYear: 2026 }, data: { clientDocsDueDay: originalDay } });
    await prisma.workflowStep.deleteMany({ where: { filing: { clientId: { in: clientIds } } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.clientTaxYear.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  });

  async function makeClient() {
    const client = await prisma.client.create({
      data: {
        code: `docs-due-${Date.now()}-${n++}`,
        registeredName: "Docs Due Test Client",
        tin: "777888999",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
      },
    });
    clientIds.push(client.id);
    await prisma.clientTaxYear.create({ data: { clientId: client.id, taxableYear: 2026, regime: "RATE_8_PERCENT", electionStatus: "ELECTED" } });
    await generateFilingsForClientYear(client.id, 2026);
    return client;
  }
  const day = (d: Date | null) => d?.toISOString().slice(0, 10);
  const filingOf = (clientId: string, period: "Q1" | "Q2" | "Q3" | "ANNUAL") =>
    prisma.filing.findUniqueOrThrow({ where: { clientId_taxableYear_period: { clientId, taxableYear: 2026, period } } });

  it("the working calendar's date is Apr 20 / Jul 20 / Oct 20 / Jan 20 (next year), with the filing target unchanged", async () => {
    const original = await prisma.taxRuleSet.findUniqueOrThrow({ where: { taxableYear: 2026 } });
    originalDay = original.clientDocsDueDay;
    expect(originalDay).toBe(20); // the migration's default carried onto the seeded rule set
    const client = await makeClient();
    expect(day((await filingOf(client.id, "Q1")).certificatesExpectedBy)).toBe("2026-04-20");
    expect(day((await filingOf(client.id, "Q2")).certificatesExpectedBy)).toBe("2026-07-20");
    expect(day((await filingOf(client.id, "Q3")).certificatesExpectedBy)).toBe("2026-10-20");
    const annual = await filingOf(client.id, "ANNUAL");
    expect(day(annual.certificatesExpectedBy)).toBe("2027-01-20");
    expect(day(annual.internalFilingTarget)).toBe("2027-03-31");
  });

  it("changing the setting moves the dates for newly generated filings and the email's line", async () => {
    await prisma.taxRuleSet.update({ where: { taxableYear: 2026 }, data: { clientDocsDueDay: 18 } });
    const client = await makeClient();
    expect(day((await filingOf(client.id, "Q3")).certificatesExpectedBy)).toBe("2026-10-18");
    expect(day((await filingOf(client.id, "ANNUAL")).certificatesExpectedBy)).toBe("2027-01-18");
    const q3 = await filingOf(client.id, "Q3");
    const email = await buildClientPackageEmailForFiling(q3.id);
    expect(email!.body).toContain("Please send required documents by Jan 18, 2027.");
    await prisma.taxRuleSet.update({ where: { taxableYear: 2026 }, data: { clientDocsDueDay: 20 } });
    const again = await buildClientPackageEmailForFiling(q3.id);
    expect(again!.body).toMatch(/Next filing: Annual ITR \(1701A\), due [A-Z][a-z]{2} \d+, 2027\. Please send required documents by Jan 20, 2027\./);
  });

  it("a quarterly filing's email ends with the same sentence (Q2 -> next is Q3, docs due Oct 20)", async () => {
    const client = await makeClient();
    const q2 = await filingOf(client.id, "Q2");
    const email = await buildClientPackageEmailForFiling(q2.id);
    expect(email!.body).toMatch(/Next filing: 1701Q for Q3 2026, due Nov 1\d, 2026\. Please send required documents by Oct 20, 2026\./);
  });

  it("backfill: an unfiled filing still holding an old date is moved, a filed one is left alone, and a second run changes nothing", async () => {
    const client = await makeClient();
    const q1 = await filingOf(client.id, "Q1");
    const q2 = await filingOf(client.id, "Q2");
    const old = new Date("2026-05-05T00:00:00.000Z");
    await prisma.filing.update({ where: { id: q1.id }, data: { certificatesExpectedBy: old } });
    await prisma.filing.update({ where: { id: q2.id }, data: { certificatesExpectedBy: old } });
    await prisma.workflowStep.updateMany({ where: { filingId: q2.id, stepCode: "FILE_RETURN" }, data: { status: "DONE" } });
    await backfillClientDocsDue(prisma);
    expect(day((await filingOf(client.id, "Q1")).certificatesExpectedBy)).toBe("2026-04-20");
    expect(day((await filingOf(client.id, "Q2")).certificatesExpectedBy)).toBe("2026-05-05");
    await backfillClientDocsDue(prisma);
    expect(day((await filingOf(client.id, "Q1")).certificatesExpectedBy)).toBe("2026-04-20");
  });
});
