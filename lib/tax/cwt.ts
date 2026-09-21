/**
 * Cumulative creditable withholding tax assembly — the piece of
 * SPEC.md 3.2's formula that comes from Form2307 certificates rather
 * than the transaction ledger. Pure functions, plain object in, plain
 * object out (SPEC.md section 4, 6).
 *
 * D34 (brief #4b, supersedes D10) — a certificate's credit period is no
 * longer decided by `dateReceived` against a cutoff date. It is decided
 * by which filing's step 2 the certificate was entered under
 * (`claimedOnFilingPeriod`, set once at entry and never reassigned — see
 * Form2307.claimedOnFilingId in the schema). A certificate counts toward
 * a period's cumulative CWT if its own claimed period is that period or
 * an earlier one in the same taxable year (Q1 <= Q2 <= Q3 <= ANNUAL).
 *
 * Double-counting is prevented structurally, not just by test coverage:
 *
 * 1. sumCwtThroughPeriod takes the FULL certificate history and
 *    recomputes the sum from scratch every call. There is no running
 *    total for a caller to (mis)accumulate onto. Because claimedOnFilingPeriod
 *    is a fixed historical fact (set once, at entry, never reassigned —
 *    D11 means a filed period is never reopened to move it), this filter
 *    is deterministic regardless of when the function runs: a
 *    certificate entered under Q2's step 2 is excluded from every
 *    recomputation of Q1 and included in every recomputation of Q2/Q3/
 *    ANNUAL exactly once.
 * 2. Certificates are deduplicated by `id` within a single call, so even
 *    a caller bug that includes the same certificate twice in the input
 *    array cannot double its contribution.
 * 3. assertCertificateClaimable enforces, before any code links a
 *    certificate to a filing, that a certificate already claimed on a
 *    DIFFERENT filing cannot be silently claimed onto a second one. This
 *    mirrors the schema itself — Form2307.claimedOnFilingId is a single
 *    nullable foreign key, not a list, so a certificate can only ever
 *    point to one filing at the database level too.
 */

import { priorPeriodsOf } from "./periods";
import type { Period } from "./types";

// Exported so callers computing the SAME cumulative-CWT-eligible set
// outside sumCwtThroughPeriod (e.g. lib/sawt/eligibleCertificates.ts) use
// one shared definition of "claimable," not a
// second hand-copied list that can drift from this one.
export const CLAIMABLE_STATUSES = new Set(["RECORDED", "CLAIMED_ON_RETURN"]);

export interface CertificateForCwt {
  id: string;
  taxWithheldCents: number;
  status: string;
  /** The period of the filing whose step 2 this certificate was entered under (D34); null if not yet assigned to any filing. */
  claimedOnFilingPeriod: Period | null;
}

/**
 * Sums taxWithheldCents for certificates whose claimed period (D34) is
 * `period` or an earlier period in the same taxable year, status
 * Recorded or ClaimedOnReturn (SPEC.md 3.2). Deduplicates by certificate
 * id.
 */
export function sumCwtThroughPeriod(certificates: CertificateForCwt[], period: Period): number {
  const periodsThroughThis = new Set<Period>([...priorPeriodsOf(period), period]);
  const seen = new Set<string>();
  let total = 0;

  for (const cert of certificates) {
    if (seen.has(cert.id)) continue; // structural guard against duplicate array entries
    if (!CLAIMABLE_STATUSES.has(cert.status)) continue;
    if (!cert.claimedOnFilingPeriod) continue;
    if (!periodsThroughThis.has(cert.claimedOnFilingPeriod)) continue;

    seen.add(cert.id);
    total += cert.taxWithheldCents;
  }

  return total;
}

export class CertificateAlreadyClaimedError extends Error {
  constructor(certificateId: string, existingFilingId: string, targetFilingId: string) {
    super(
      `Certificate ${certificateId} is already claimed on filing ${existingFilingId} and cannot also be claimed on filing ${targetFilingId}.`,
    );
    this.name = "CertificateAlreadyClaimedError";
  }
}

/**
 * Throws if `certificate` is already claimed on a filing other than
 * `targetFilingId`. Call this before writing claimedOnFilingId anywhere.
 * A certificate not yet claimed by anyone (claimedOnFilingId is
 * null/undefined) is always claimable. Claiming it again onto the SAME
 * filing it's already on is a no-op, not an error.
 */
export function assertCertificateClaimable(
  certificate: { id: string; claimedOnFilingId?: string | null },
  targetFilingId: string,
): void {
  if (!certificate.claimedOnFilingId) return;
  if (certificate.claimedOnFilingId === targetFilingId) return;
  throw new CertificateAlreadyClaimedError(certificate.id, certificate.claimedOnFilingId, targetFilingId);
}
