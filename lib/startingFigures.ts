import { prisma } from "@/lib/prisma";
import { ALL_PERIODS, outsidePeriodsFor } from "@/lib/tax/periods";
import type { LatestOutsideReturn } from "@/lib/tax/types";

/**
 * Brief #5f §8 — data access for a client-year's starting figures (the
 * handful of numbers a mid-year client brings in from her own
 * outside-the-app filing). Not a "use server" file — like
 * lib/filingComputation.ts, this is read directly from server components
 * (the client page, the starting figures page) as well as from the
 * mutating action in lib/actions/startingFigures.ts.
 */
export async function getStartingFigures(clientId: string, taxableYear: number) {
  return prisma.startingFigures.findUnique({ where: { clientId_taxableYear: { clientId, taxableYear } } });
}

/**
 * Whether starting figures are locked for good (§8: "Editing is allowed
 * until the year's first in-app return is filed. After that it's
 * locked."). Derived, never stored — the year's first IN-APP return is
 * the earliest period (by ALL_PERIODS order) that isn't one of the
 * outside periods and has a Filing row; if that filing's own step 5
 * (FILE_RETURN) is DONE, editing is locked.
 */
export async function isStartingFiguresLocked(
  clientId: string,
  taxableYear: number,
  latestOutsideReturn: LatestOutsideReturn,
): Promise<boolean> {
  const outsidePeriods = new Set(outsidePeriodsFor(latestOutsideReturn));
  const inAppPeriods = ALL_PERIODS.filter((p) => !outsidePeriods.has(p));
  if (inAppPeriods.length === 0) return false;

  const filings = await prisma.filing.findMany({
    where: { clientId, taxableYear, period: { in: [...inAppPeriods] }, deletedAt: null },
    include: { workflowSteps: { where: { stepCode: "FILE_RETURN" }, select: { status: true } } },
  });
  const firstInAppFiling = inAppPeriods
    .map((p) => filings.find((f) => f.period === p))
    .find((f) => f != null);
  if (!firstInAppFiling) return false;

  return firstInAppFiling.workflowSteps.some((s) => s.status === "DONE");
}
