import { prisma } from "@/lib/prisma";

/**
 * Rework brief §5.2 — of the three reconciliation panels this file used
 * to expose, two presupposed the certificate-to-income conversion that
 * D26 removed ("transactions with no linked certificate" and
 * "certificates not yet converted" — there is no conversion anymore, so
 * there is nothing left to reconcile there) and a third compared against
 * a SAWT-batch figure the bookkeeper couldn't follow. This file now
 * exposes exactly one check, the one that survived: certificates for a
 * taxable year should never total more than the client's own declared
 * gross sales for that year.
 *
 * This runs over the whole taxable year, never per quarter — the CWT
 * cutoff rule (lib/tax/cwt.ts) deliberately shifts a certificate's
 * credit into whichever period is open when it arrives, so a per-quarter
 * comparison would show a "variance" on nearly every filing and be
 * learned-ignored. Annual comparison is the only form of this check that
 * carries signal.
 */
export interface AnnualCertificatesVsSalesReconciliation {
  taxableYear: number;
  certificatesTotalCents: number;
  declaredSalesTotalCents: number;
  varianceCents: number;
  /** Amber only when certificates exceed declared sales — never the reverse. */
  hasVariance: boolean;
}

export async function getAnnualCertificatesVsSalesReconciliation(
  clientId: string,
  taxableYear: number,
): Promise<AnnualCertificatesVsSalesReconciliation> {
  const [certificates, salesRows] = await Promise.all([
    prisma.form2307.findMany({ where: { clientId, taxableYear, deletedAt: null } }),
    prisma.quarterlySales.findMany({ where: { clientId, taxableYear } }),
  ]);

  const certificatesTotalCents = certificates.reduce((sum, c) => sum + c.incomePaymentCents, 0);
  const declaredSalesTotalCents = salesRows.reduce((sum, r) => sum + r.grossSalesCents, 0);
  const varianceCents = certificatesTotalCents - declaredSalesTotalCents;

  return {
    taxableYear,
    certificatesTotalCents,
    declaredSalesTotalCents,
    varianceCents,
    hasVariance: varianceCents > 0,
  };
}
