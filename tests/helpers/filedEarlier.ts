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
