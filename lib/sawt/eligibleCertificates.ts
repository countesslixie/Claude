import { prisma } from "@/lib/prisma";
import { resolveCertificateCutoffDate, CLAIMABLE_STATUSES } from "@/lib/tax/cwt";
import { priorPeriodsOf } from "@/lib/tax/periods";
import { nowManila } from "@/lib/dates";
import type { Period } from "@/lib/tax/types";

/**
 * Shared I/O-boundary helpers for "which certificates belong in this
 * period's SAWT batch" — used by both lib/reconciliation.ts's check 3
 * (report the gap) and the batch-generation action (close it), so the
 * two can never define "eligible" differently.
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
  sawtBatch: { id: string; period: Period } | null;
}

/**
 * The cutoff resolution lib/filingComputation.ts uses for the real
 * return (filedAt / manual override / today) — check 3 must use the
 * SAME basis as the actual filing computation, or it's comparing two
 * different things again (exactly the "meaningless comparison" problem
 * the original reconciliation revision fixed).
 */
export async function resolveCertificateCutoffForFilingPeriod(
  clientId: string,
  taxableYear: number,
  period: Period,
): Promise<Date> {
  const filing = await prisma.filing.findUnique({
    where: { clientId_taxableYear_period: { clientId, taxableYear, period } },
  });
  const resolution = resolveCertificateCutoffDate({
    filedAt: filing?.filedAt ?? null,
    manualOverride: filing?.certificateCutoffOverride ?? null,
    today: nowManila().startOf("day").toJSDate(),
  });
  return resolution.date;
}

export async function getAllCertificatesThisYear(
  clientId: string,
  taxableYear: number,
): Promise<CertificateWithBatch[]> {
  return prisma.form2307.findMany({
    where: { clientId, taxableYear, deletedAt: null },
    include: { sawtBatch: { select: { id: true, period: true } } },
    orderBy: { dateReceived: "asc" },
  });
}

/**
 * Certificates that count toward cumulativeCwtCents through `period`
 * (claimable status, received on or before cutoffDate) but have NOT
 * been assigned to any SawtBatch through this period yet. A certificate
 * belongs to exactly one batch (Form2307.sawtBatchId is a single FK), so
 * "through this period" means the batch it's in, if any, has period Q1
 * through the current one — not just an exact match on this period
 * alone (SPEC.md 10: the Alphalist is cumulative year-to-date).
 */
export function selectUnbatchedClaimableCertificates(
  certificates: CertificateWithBatch[],
  period: Period,
  cutoffDate: Date,
): CertificateWithBatch[] {
  const periodsThroughThis = new Set([...priorPeriodsOf(period), period]);
  return certificates.filter(
    (c) =>
      CLAIMABLE_STATUSES.has(c.status) &&
      c.dateReceived !== null &&
      c.dateReceived.getTime() <= cutoffDate.getTime() &&
      !(c.sawtBatch && periodsThroughThis.has(c.sawtBatch.period)),
  );
}

/** Sum of taxWithheldCents for certificates already batched through `period`. */
export function selectBatchedCwtCentsThroughPeriod(certificates: CertificateWithBatch[], period: Period): number {
  const periodsThroughThis = new Set([...priorPeriodsOf(period), period]);
  return certificates
    .filter((c) => c.sawtBatch && periodsThroughThis.has(c.sawtBatch.period))
    .reduce((sum, c) => sum + c.taxWithheldCents, 0);
}
