import { prisma } from "@/lib/prisma";
import { getStartingFigures } from "@/lib/startingFigures";

/**
 * Brief #5f §8 — the dashboard's 80%/95%/breach VAT threshold monitor must
 * include a mid-year client's starting cumulative income: she can already
 * be close to the ₱3,000,000 threshold before the app ever saw a peso of
 * hers. Extracted out of the dashboard page so it's directly testable.
 */
export async function cumulativeGrossForThreshold(clientId: string, taxableYear: number): Promise<number> {
  const [sum, startingFigures] = await Promise.all([
    prisma.quarterlySales.aggregate({
      where: { clientId, taxableYear },
      _sum: { grossSalesCents: true, nonOperatingIncomeCents: true },
    }),
    getStartingFigures(clientId, taxableYear),
  ]);
  const startingCumulativeCents =
    startingFigures && startingFigures.latestOutsideReturn !== "NONE" ? startingFigures.cumulativeIncomeCents : 0;
  return startingCumulativeCents + (sum._sum.grossSalesCents ?? 0) + (sum._sum.nonOperatingIncomeCents ?? 0);
}
