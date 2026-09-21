import { prisma } from "@/lib/prisma";
import { CLAIMABLE_STATUSES } from "@/lib/tax/cwt";
import { priorPeriodsOf } from "@/lib/tax/periods";
import type { Period } from "@/lib/tax/types";

/**
 * Shared I/O-boundary helpers for "which certificates belong in this
 * period's SAWT batch" — used by the batch-generation action
 * (lib/actions/sawt.ts).
 */

export interface CertificateWithBatch {
  id: string;
  payorName: string;
  payorTin: string | null;
  payorAddress: string | null;
  periodFrom: Date;
  periodTo: Date;
  quarterCovered: number;
  atcCode: string;
  incomePaymentCents: number;
  taxWithheldCents: number;
  withholdingRateBps: number;
  dateReceived: Date | null;
  status: string;
  claimedOnFilingId: string | null;
  /** D34 (brief #4b) — the period of the filing this certificate was entered under. */
  claimedOnFilingPeriod: Period | null;
  sawtBatch: { id: string; period: Period } | null;
}

export async function getAllCertificatesThisYear(
  clientId: string,
  taxableYear: number,
): Promise<CertificateWithBatch[]> {
  const rows = await prisma.form2307.findMany({
    where: { clientId, taxableYear, deletedAt: null },
    include: { sawtBatch: { select: { id: true, period: true } }, claimedOnFiling: { select: { period: true } } },
    orderBy: { dateReceived: "asc" },
  });
  return rows.map((r) => ({ ...r, claimedOnFilingPeriod: r.claimedOnFiling?.period ?? null }));
}

/**
 * Certificates that count toward cumulativeCwtCents through `period`
 * (claimable status, claimed on a filing whose period is `period` or
 * earlier — D34, brief #4b) but have NOT been assigned to any SawtBatch
 * through this period yet. A certificate belongs to exactly one batch
 * (Form2307.sawtBatchId is a single FK), so "through this period" means
 * the batch it's in, if any, has period Q1 through the current one —
 * not just an exact match on this period alone (SPEC.md 10: the
 * Alphalist is cumulative year-to-date).
 */
export function selectUnbatchedClaimableCertificates(
  certificates: CertificateWithBatch[],
  period: Period,
): CertificateWithBatch[] {
  const periodsThroughThis = new Set<Period>([...priorPeriodsOf(period), period]);
  return certificates.filter(
    (c) =>
      CLAIMABLE_STATUSES.has(c.status) &&
      c.claimedOnFilingPeriod != null &&
      periodsThroughThis.has(c.claimedOnFilingPeriod) &&
      !(c.sawtBatch && periodsThroughThis.has(c.sawtBatch.period)),
  );
}
