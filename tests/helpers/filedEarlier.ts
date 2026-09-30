import { prisma } from "@/lib/prisma";
import { priorPeriodsOf } from "@/lib/tax/periods";
import type { Period } from "@/lib/tax/types";

/**
 * D95 (brief #5q) — a return can only be filed once every earlier return of
 * the same client and year is filed. Tests that file a later quarter use this
 * to put the earlier ones in the filed state the way the app leaves them
 * (step 5 Done), without running each one through the whole workflow.
 */
export async function markEarlierQuartersFiled(clientId: string, taxableYear: number, period: Period): Promise<void> {
  const earlier = priorPeriodsOf(period);
  if (earlier.length === 0) return;
  await prisma.workflowStep.updateMany({
    where: { stepCode: "FILE_RETURN", filing: { clientId, taxableYear, period: { in: [...earlier] } } },
    data: { status: "DONE", completedAt: new Date() },
  });
}

/**
 * D100 (brief #5r) — step 5 waits for all of Prepare. Tests that file a
 * return directly put steps 1-4 in their finished state the way the app
 * leaves them, without running each through its own screen.
 */
export async function resolvePrepare(filingId: string): Promise<void> {
  await prisma.workflowStep.updateMany({
    where: { filingId, stepCode: { in: ["RECORD_SALES", "PREPARE_RETURN", "ADVISE_CLIENT"] } },
    data: { status: "DONE", completedAt: new Date() },
  });
  await prisma.workflowStep.updateMany({
    where: { filingId, stepCode: "RECEIVE_2307", status: { notIn: ["DONE", "SKIPPED", "NA"] } },
    data: { status: "DONE", completedAt: new Date() },
  });
}
