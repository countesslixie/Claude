/**
 * Cumulative creditable withholding tax assembly — the piece of
 * SPEC.md 3.2's formula that comes from Form2307 certificates rather
 * than the transaction ledger. Pure functions, plain object in, plain
 * object out (SPEC.md section 4, 6).
 *
 * Double-counting is prevented structurally, not just by test coverage:
 *
 * 1. sumCwtThroughPeriod takes the FULL certificate history and a single
 *    cutoff date, and recomputes the sum from scratch every call. There
 *    is no running total for a caller to (mis)accumulate onto — the
 *    function is the only path to a cumulative figure, and it always
 *    derives that figure fresh from source. A certificate is included
 *    if and only if `dateReceived <= throughDate`. Because dateReceived
 *    is a fixed historical fact (the date the bookkeeper actually
 *    recorded it), this filter is deterministic regardless of when the
 *    function runs: a Q1-period certificate that doesn't arrive until
 *    August is excluded from every recomputation of Q1 (dateReceived is
 *    after Q1's cutoff) and included in Q3's cumulative exactly once
 *    (dateReceived is on-or-before Q3's cutoff) — it can never
 *    retroactively change a frozen Q1 snapshot, because recomputing Q1
 *    again, at any point in the future, with any certificate list,
 *    still excludes it.
 * 2. Certificates are deduplicated by `id` within a single call, so even
 *    a caller bug that includes the same certificate twice in the input
 *    array cannot double its contribution.
 * 3. assertCertificateClaimable enforces, before any code links a
 *    certificate to a filing, that a certificate already claimed on a
 *    DIFFERENT filing cannot be silently claimed onto a second one. This
 *    mirrors the schema itself — Form2307.claimedOnFilingId is a single
 *    nullable foreign key, not a list, so a certificate can only ever
 *    point to one filing at the database level too. Every future
 *    "claim this certificate" workflow action must call this guard
 *    before writing claimedOnFilingId.
 *
 * throughDate itself (the cutoff) is a separate concern, resolved by
 * resolveCertificateCutoffDate below — see its doc comment. It is NOT the
 * same as the period end date: certificates routinely arrive weeks after
 * the period they economically belong to closes.
 */

import { manilaCalendarDay } from "@/lib/dates";
import type { CertificateCutoffSource } from "./types";

// Exported so callers computing the SAME cumulative-CWT-eligible set
// outside sumCwtThroughPeriod (e.g. the SAWT reconciliation's check 3,
// lib/reconciliation.ts) use one shared definition of "claimable," not a
// second hand-copied list that can drift from this one.
export const CLAIMABLE_STATUSES = new Set(["RECORDED", "CLAIMED_ON_RETURN"]);

/**
 * The cutoff comparison below is calendar-day, not instant. Callers in
 * this codebase always construct dates via lib/dates.ts's
 * manilaDateInputToJsDate() (start-of-day Manila), so dateReceived and
 * throughDate are normally already midnight-aligned and a raw instant
 * comparison would happen to agree with this. But "received by Aug 15"
 * means "any time during Aug 15 Manila," not "before the exact instant
 * of Aug 15 00:00 Manila" — a certificate received at 11:59pm on the
 * cutoff date must still count. Comparing calendar days directly, using
 * the same UTC-instant -> Asia/Manila conversion lib/dates.ts uses for
 * display, makes that true regardless of what time-of-day either Date
 * happens to encode (SPEC.md 3.5, 3.6: all date arithmetic is
 * Asia/Manila, never the host's local timezone).
 */

export interface CertificateForCwt {
  id: string;
  taxWithheldCents: number;
  dateReceived: Date | null;
  status: string;
  /** The filing this certificate has already been claimed on, if any. */
  claimedOnFilingId?: string | null;
}

/**
 * Sums taxWithheldCents for certificates received on or before
 * `throughDate`, status Recorded or ClaimedOnReturn (SPEC.md 3.2).
 * "On or before" compares Asia/Manila calendar days, not raw instants —
 * a certificate received any time on the cutoff's own calendar day
 * counts, regardless of time-of-day (see manilaCalendarDay above).
 * Deduplicates by certificate id.
 */
export function sumCwtThroughPeriod(certificates: CertificateForCwt[], throughDate: Date): number {
  const seen = new Set<string>();
  let total = 0;

  for (const cert of certificates) {
    if (seen.has(cert.id)) continue; // structural guard against duplicate array entries
    if (!CLAIMABLE_STATUSES.has(cert.status)) continue;
    if (!cert.dateReceived) continue;
    if (manilaCalendarDay(cert.dateReceived) > manilaCalendarDay(throughDate)) continue;

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
  certificate: Pick<CertificateForCwt, "id" | "claimedOnFilingId">,
  targetFilingId: string,
): void {
  if (!certificate.claimedOnFilingId) return;
  if (certificate.claimedOnFilingId === targetFilingId) return;
  throw new CertificateAlreadyClaimedError(certificate.id, certificate.claimedOnFilingId, targetFilingId);
}

export interface CertificateCutoffResolution {
  date: Date;
  source: CertificateCutoffSource;
}

/**
 * Resolves the cutoff date used to decide which Form 2307 certificates a
 * filing claims (SPEC.md 3.5). This is deliberately NOT the period end
 * date — certificates routinely arrive weeks after the period they
 * economically belong to closes (e.g. a Q2 certificate arriving Aug 5,
 * after Jun 30), so using period end would push every certificate a
 * quarter late.
 *
 * Priority, highest first:
 *   1. manualOverride, if set — the bookkeeper's explicit correction.
 *      Always editable and always wins when present, even on a filed
 *      return; it does not itself freeze or unfreeze anything.
 *   2. filedAt, if the filing has been filed — the cutoff is pinned to
 *      the moment of filing, since a filed return cannot retroactively
 *      claim certificates that arrived after it was submitted.
 *   3. today — a live preview of an unfiled filing always reflects
 *      "certificates on hand as of right now." Caller supplies today as
 *      a plain Date (Asia/Manila, resolved at the I/O boundary) so this
 *      function stays pure.
 */
export function resolveCertificateCutoffDate(input: {
  filedAt: Date | null;
  manualOverride: Date | null;
  today: Date;
}): CertificateCutoffResolution {
  if (input.manualOverride) return { date: input.manualOverride, source: "MANUAL_OVERRIDE" };
  if (input.filedAt) return { date: input.filedAt, source: "FILED_AT" };
  return { date: input.today, source: "TODAY" };
}
