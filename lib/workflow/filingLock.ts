import { prisma } from "@/lib/prisma";

/**
 * D153 — a Complete filing (every step resolved, the green "Complete"
 * pill) is read-only for good: no Unlock, no Reopen. Every server action
 * that changes a filing, its steps, its documents or its certificates
 * checks this first and refuses with this one plain message. The page
 * hides the controls too, but this is the lock — a stale form post or a
 * direct call stops here.
 */
export const FILING_LOCKED_MESSAGE = "This filing is complete and locked.";

/** Thrown by the actions that return nothing (they have no result to carry the message in). */
export class FilingLockedError extends Error {
  constructor() {
    super(FILING_LOCKED_MESSAGE);
    this.name = "FilingLockedError";
  }
}

/** The one definition of "Complete": the derived Filing.status the green pill reads (status.ts). */
export function isFilingComplete(filing: { status: string }): boolean {
  return filing.status === "COMPLETE";
}

/** The refusal message when this filing is Complete, otherwise null. A missing filing is not this check's concern. */
export async function filingLockedReason(filingId: string | null | undefined): Promise<string | null> {
  if (!filingId) return null;
  const filing = await prisma.filing.findUnique({ where: { id: filingId }, select: { status: true } });
  return filing && isFilingComplete(filing) ? FILING_LOCKED_MESSAGE : null;
}

/** For the actions that return nothing: throws FilingLockedError when the filing is Complete. */
export async function assertFilingNotComplete(filingId: string | null | undefined): Promise<void> {
  if (await filingLockedReason(filingId)) throw new FilingLockedError();
}
