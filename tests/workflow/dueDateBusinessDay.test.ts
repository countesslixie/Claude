import { describe, it, expect, afterAll } from "vitest";
import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";
import { stepDueDate } from "@/lib/workflow/dueDate";
import { formatManilaDate, MANILA_ZONE } from "@/lib/dates";

/**
 * Decision (this session): for quarterly returns, internalFilingTarget is
 * the ADJUSTED (business-day-shifted) due date itself -- no internal
 * buffer by design, the bookkeeper works to the normal deadline for
 * quarterlies (SPEC.md 3.6). ANNUAL keeps a real buffer (Mar 31 target
 * ahead of the Apr 15 deadline) and is exempt from these assertions.
 */
describe("stepDueDate business-day invariant (SPEC.md 3.6)", () => {
  const createdClientIds: string[] = [];

  afterAll(async () => {
    if (createdClientIds.length === 0) return;
    await prisma.workflowStep.deleteMany({ where: { filing: { clientId: { in: createdClientIds } } } });
    await prisma.filing.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  });

  async function seedTestFilings() {
    const client = await prisma.client.create({
      data: {
        code: `dd-bizday-test-${Date.now()}`,
        registeredName: "Due Date Business Day Test Client",
        tin: "555666777",
        rdoCode: "999",
        registeredAddress: "N/A",
        taxpayerType: "PURELY_SELF_EMPLOYED",
        booksType: "MANUAL",
        defaultWithholdingRateBps: 500,
      },
    });
    createdClientIds.push(client.id);
    await generateFilingsForClientYear(client.id, 2026);
    return prisma.filing.findMany({
      where: { clientId: client.id },
      include: { workflowSteps: true },
    });
  }

  it("Q2 2026's prep step due date renders Aug 17 -- the adjusted due date, not Aug 15 (Sat), the raw statutory date", async () => {
    const filings = await seedTestFilings();
    const q2 = filings.find((f) => f.period === "Q2")!;
    const prepStep = q2.workflowSteps.find((s) => s.stepCode === "RECORD_CRJ")!;
    expect(prepStep.status).toBe("PENDING"); // not a waiting-state clock

    const due = stepDueDate({
      stepCode: prepStep.stepCode,
      status: prepStep.status,
      waitingSince: prepStep.waitingSince,
      expectedResponseDays: prepStep.expectedResponseDays,
      certificatesExpectedBy: q2.certificatesExpectedBy,
      internalFilingTarget: q2.internalFilingTarget,
      adjustedDueDate: q2.adjustedDueDate,
    });
    expect(formatManilaDate(due)).toBe("Aug 17, 2026");
  });

  it("no step's due date falls on a weekend or a seeded holiday, unless it came from a waiting-state clock", async () => {
    const filings = await seedTestFilings();
    const holidays = await prisma.holiday.findMany();
    const holidayManilaDays = new Set(
      holidays.map((h) => DateTime.fromJSDate(h.date).setZone(MANILA_ZONE).toFormat("yyyy-MM-dd")),
    );

    const violations: string[] = [];
    for (const filing of filings) {
      // ANNUAL keeps a real buffer (internalFilingTarget Mar 31, not
      // business-day-shifted) and is exempt by design -- see SPEC.md 3.6.
      if (filing.period === "ANNUAL") continue;

      for (const step of filing.workflowSteps) {
        if (step.status === "NA" || step.status === "SKIPPED") continue;

        const due = stepDueDate({
          stepCode: step.stepCode,
          status: step.status,
          waitingSince: step.waitingSince,
          expectedResponseDays: step.expectedResponseDays,
          certificatesExpectedBy: filing.certificatesExpectedBy,
          internalFilingTarget: filing.internalFilingTarget,
          adjustedDueDate: filing.adjustedDueDate,
        });

        // A waiting-state clock (waitingSince + expectedResponseDays, or
        // RECEIVE_2307's certificatesExpectedBy-anchored equivalent) can
        // legitimately land on any day -- certificate/response arrival
        // isn't a statutory deadline and is never business-day shifted.
        if (step.status === "WAITING_EXTERNAL") continue;

        const manila = DateTime.fromJSDate(due).setZone(MANILA_ZONE);
        const isWeekend = manila.weekday === 6 || manila.weekday === 7; // Luxon: 6=Sat, 7=Sun
        const isHoliday = holidayManilaDays.has(manila.toFormat("yyyy-MM-dd"));
        if (isWeekend || isHoliday) {
          violations.push(
            `${filing.period}/${step.stepCode}: ${formatManilaDate(due)} (${isWeekend ? "weekend" : "holiday"})`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
