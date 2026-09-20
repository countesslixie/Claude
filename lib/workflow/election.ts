import type { Period } from "@/lib/tax/types";

/**
 * Rework brief §7 — the one genuine hard block left in the system once
 * §5.1 removed document gating everywhere else (D27's single exception).
 * It guards a wrong tax rate, not a missing file: a Q1 filing computes
 * and is prepared to be filed at the 8% rate, but the client's election
 * for the year is what makes that rate valid at all (SPEC.md 3.1). A
 * client who has not validly elected defaults to graduated rates, so a
 * Q1 filing built on an unconfirmed election may be entirely the wrong
 * number.
 *
 * Only Q1 is blocked — the election is made (or lapses) via the Q1
 * return; Q2/Q3/ANNUAL simply compute cumulatively off whatever Q1
 * already established, so blocking them too would just repeat the same
 * check for no added protection once Q1 itself is resolved.
 */
export function isElectionBlocked(period: Period, electionStatus: string | null | undefined): boolean {
  return period === "Q1" && electionStatus !== "ELECTED";
}
