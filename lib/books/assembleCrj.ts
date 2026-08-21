import { prisma } from "@/lib/prisma";
import { periodStartDate, periodEndDate } from "@/lib/tax/periods";
import { buildCashReceiptsJournal, type CashReceiptsJournal } from "./crj";
import type { Period } from "@/lib/tax/types";

/** I/O boundary: assembles a CashReceiptsJournal from the database for one client+year+period. */
export async function assembleCrj(clientId: string, taxableYear: number, period: Period): Promise<CashReceiptsJournal> {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });

  const transactions = await prisma.salesTransaction.findMany({
    where: {
      clientId,
      transactionDate: { gte: periodStartDate(taxableYear, period), lte: periodEndDate(taxableYear, period) },
      deletedAt: null,
    },
    orderBy: { transactionDate: "asc" },
  });

  return buildCashReceiptsJournal({
    clientName: client.registeredName,
    clientTin: client.tin,
    taxableYear,
    period,
    transactions: transactions.map((t) => ({
      transactionDate: t.transactionDate,
      orNumber: t.orNumber,
      payorName: t.payorName,
      particulars: t.description,
      grossAmountCents: t.grossAmountCents,
      withholdingTaxCents: t.withholdingTaxCents,
      cashReceivedCents: t.netReceivedCents,
    })),
  });
}
