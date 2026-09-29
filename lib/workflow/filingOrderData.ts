import { prisma } from "@/lib/prisma";
import type { LatestOutsideReturn } from "@/lib/tax/types";
import { filingOrderBlockReason, type FilingOrderContext } from "./filingOrder";

/**
 * D95 (brief #5q) — reads what the filing-order guard needs for one filing:
 * the client-year's other (non-deleted) filings with their step 5 status, and
 * the starting figures' latestOutsideReturn.
 */
export async function loadFilingOrderContext(filing: {
  clientId: string;
  taxableYear: number;
  period: string;
}): Promise<FilingOrderContext> {
  const [rows, starting] = await Promise.all([
    prisma.filing.findMany({
      where: { clientId: filing.clientId, taxableYear: filing.taxableYear, deletedAt: null },
      select: {
        id: true,
        period: true,
        filedOutsideApp: true,
        workflowSteps: { where: { stepCode: "FILE_RETURN" }, select: { status: true } },
      },
    }),
    prisma.startingFigures.findUnique({
      where: { clientId_taxableYear: { clientId: filing.clientId, taxableYear: filing.taxableYear } },
      select: { latestOutsideReturn: true },
    }),
  ]);
  return {
    taxableYear: filing.taxableYear,
    period: filing.period,
    siblings: rows.map((r) => ({
      id: r.id,
      period: r.period,
      filedOutsideApp: r.filedOutsideApp,
      fileReturnStatus: r.workflowSteps[0]?.status ?? null,
    })),
    latestOutsideReturn: (starting?.latestOutsideReturn ?? "NONE") as LatestOutsideReturn,
  };
}

export async function loadFilingOrderBlockReason(filing: {
  clientId: string;
  taxableYear: number;
  period: string;
}): Promise<string | null> {
  return filingOrderBlockReason(await loadFilingOrderContext(filing));
}
