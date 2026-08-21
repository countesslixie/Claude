import { prisma } from "@/lib/prisma";
import { sumCwtThroughPeriod } from "@/lib/tax/cwt";
import { periodToQuarters } from "@/lib/tax/periods";
import {
  resolveCertificateCutoffForFilingPeriod,
  getAllCertificatesThisYear,
  selectUnbatchedClaimableCertificates,
  selectBatchedCwtCentsThroughPeriod,
} from "@/lib/sawt/eligibleCertificates";
import type { Period } from "@/lib/tax/types";

/**
 * SPEC.md section 10 reconciliation, revised for the 2307-driven entry
 * workflow (the 2307 is now the source document for a transaction, not
 * an independent check on it — so "transaction CWT vs certificate CWT"
 * is no longer a meaningful comparison; one derives from the other).
 *
 * Three checks:
 *   1. Transactions with no linked Form2307 — the real gap: receipts
 *      that might be missing a certificate, or genuinely have none.
 *   2. Certificates received for the period not yet converted into a
 *      transaction.
 *   3. Total CWT claimed on the filing vs. sum of certificates in the
 *      SAWT batch — kept, still a genuine cross-check against what
 *      actually gets filed, since the SAWT batch is an independent
 *      downstream artifact, not derived from the same entry action as
 *      the transaction. See lib/sawt/eligibleCertificates.ts for why
 *      this must be cumulative through `period`, and use the SAME
 *      certificate cutoff as the actual filing computation.
 *
 * When the two disagree, the certificates actually responsible are the
 * ones already counted in cumulativeCwtCentsOnFiling (claimable,
 * received on or before the cutoff) that have NOT been assigned to any
 * batch through this period yet — that's the actionable, nameable gap
 * (SPEC.md 7.1's "name exactly which" standard, same as
 * checkSendClientPackageReadiness).
 */
export interface UnbatchedCertificate {
  id: string;
  payorName: string;
  atcCode: string;
  taxWithheldCents: number;
  dateReceived: Date | null;
}

export interface PeriodReconciliation {
  transactionsWithoutForm2307: Awaited<ReturnType<typeof prisma.salesTransaction.findMany>>;
  transactionsWithoutForm2307TotalCents: number;

  certificatesNotYetConverted: Awaited<ReturnType<typeof prisma.form2307.findMany>>;
  certificatesNotYetConvertedTotalCents: number;

  cumulativeCwtCentsOnFiling: number;
  sawtBatchCwtCents: number;
  varianceCents: number;
  hasVariance: boolean;
  unbatchedCertificates: UnbatchedCertificate[];
}

export async function getPeriodReconciliation(
  clientId: string,
  taxableYear: number,
  period: Period,
): Promise<PeriodReconciliation> {
  const quarters = periodToQuarters(period);

  const [certificatesThisPeriod, transactionsThisPeriod] = await Promise.all([
    prisma.form2307.findMany({
      where: { clientId, taxableYear, quarterCovered: { in: [...quarters] }, deletedAt: null },
      orderBy: { dateReceived: "asc" },
    }),
    prisma.salesTransaction.findMany({
      where: { clientId, taxableYear, quarter: { in: [...quarters] }, deletedAt: null },
      orderBy: { transactionDate: "asc" },
    }),
  ]);

  // Check 1
  const transactionsWithoutForm2307 = transactionsThisPeriod.filter((t) => !t.form2307Id);
  const transactionsWithoutForm2307TotalCents = transactionsWithoutForm2307.reduce(
    (sum, t) => sum + t.grossAmountCents,
    0,
  );

  // Check 2
  const convertedCertificateIds = new Set(
    transactionsThisPeriod.filter((t) => t.form2307Id).map((t) => t.form2307Id as string),
  );
  const certificatesNotYetConverted = certificatesThisPeriod.filter((c) => !convertedCertificateIds.has(c.id));
  const certificatesNotYetConvertedTotalCents = certificatesNotYetConverted.reduce(
    (sum, c) => sum + c.taxWithheldCents,
    0,
  );

  // Check 3
  const cutoffDate = await resolveCertificateCutoffForFilingPeriod(clientId, taxableYear, period);
  const allCertificatesThisYear = await getAllCertificatesThisYear(clientId, taxableYear);

  const cumulativeCwtCentsOnFiling = sumCwtThroughPeriod(
    allCertificatesThisYear.map((c) => ({
      id: c.id,
      taxWithheldCents: c.taxWithheldCents,
      dateReceived: c.dateReceived,
      status: c.status,
      claimedOnFilingId: c.claimedOnFilingId,
    })),
    cutoffDate,
  );

  const sawtBatchCwtCents = selectBatchedCwtCentsThroughPeriod(allCertificatesThisYear, period);
  const varianceCents = cumulativeCwtCentsOnFiling - sawtBatchCwtCents;

  const unbatchedCertificates: UnbatchedCertificate[] = selectUnbatchedClaimableCertificates(
    allCertificatesThisYear,
    period,
    cutoffDate,
  ).map((c) => ({
    id: c.id,
    payorName: c.payorName,
    atcCode: c.atcCode,
    taxWithheldCents: c.taxWithheldCents,
    dateReceived: c.dateReceived,
  }));

  return {
    transactionsWithoutForm2307,
    transactionsWithoutForm2307TotalCents,
    certificatesNotYetConverted,
    certificatesNotYetConvertedTotalCents,
    cumulativeCwtCentsOnFiling,
    sawtBatchCwtCents,
    varianceCents,
    hasVariance: varianceCents !== 0,
    unbatchedCertificates,
  };
}
