import { prisma } from "@/lib/prisma";
import {
  resolveCertificateCutoffForFilingPeriod,
  getAllCertificatesThisYear,
  selectUnbatchedClaimableCertificates,
} from "./eligibleCertificates";
import { buildKeyingWorksheet, type KeyingWorksheet } from "./keyingWorksheet";
import type { Period } from "@/lib/tax/types";

/**
 * I/O boundary: assembles the keying worksheet from certificates
 * currently eligible-but-unbatched through `period` — the same set
 * lib/reconciliation.ts's check 3 reports as the variance, and what
 * lib/actions/sawt.ts's generateSawtBatch would assign to the batch if
 * run now. Viewing/exporting the worksheet never writes anything;
 * generating the batch is a separate, explicit action.
 */
export async function assembleKeyingWorksheet(
  clientId: string,
  taxableYear: number,
  period: Period,
): Promise<KeyingWorksheet> {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  const cutoffDate = await resolveCertificateCutoffForFilingPeriod(clientId, taxableYear, period);
  const allCertificates = await getAllCertificatesThisYear(clientId, taxableYear);
  const eligible = selectUnbatchedClaimableCertificates(allCertificates, period, cutoffDate);

  const atcCodes = await prisma.atcCode.findMany({
    where: { code: { in: [...new Set(eligible.map((c) => c.atcCode))] } },
  });
  const descriptionByCode = new Map(atcCodes.map((a) => [a.code, a.description]));

  return buildKeyingWorksheet({
    clientName: client.registeredName,
    clientTin: client.tin,
    taxableYear,
    period,
    certificates: eligible.map((c) => ({
      id: c.id,
      payorTin: c.payorTin,
      payorName: c.payorName,
      payorAddress: c.payorAddress,
      atcCode: c.atcCode,
      atcDescription: descriptionByCode.get(c.atcCode) ?? "",
      incomePaymentCents: c.incomePaymentCents,
      taxWithheldCents: c.taxWithheldCents,
      dateReceived: c.dateReceived,
    })),
  });
}
