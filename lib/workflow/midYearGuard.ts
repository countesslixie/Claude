import { prisma } from "@/lib/prisma";
import { manilaCalendarDay, formatManilaDateLong } from "@/lib/dates";
import { periodEndDate } from "@/lib/tax/periods";
import type { Period } from "@/lib/tax/types";

/** Brief #5n §1 (D78) — only the three quarterly returns can have "ended" before a client joined. */
const QUARTERLY_PERIODS: readonly Period[] = ["Q1", "Q2", "Q3"];

/**
 * The quarterly periods whose last day falls strictly before the day the
 * client was engaged — i.e. quarters that were over before the client
 * joined, so they can't have been worked inside this app. Empty when the
 * client was engaged on or before January 1 of the year, in a different
 * year, or has no engagedSince at all. Pure (compares Manila calendar
 * days, D20). A client engaged Feb 10 gets an empty list: Q1 hadn't
 * ended yet.
 */
export function quartersEndedBeforeEngagement(taxableYear: number, engagedSince: Date | null): Period[] {
  if (!engagedSince) return [];
  const engagedDay = manilaCalendarDay(engagedSince);
  if (engagedDay <= `${taxableYear}-01-01`) return [];
  if (engagedDay > `${taxableYear}-12-31`) return [];
  return QUARTERLY_PERIODS.filter((p) => manilaCalendarDay(periodEndDate(taxableYear, p)) < engagedDay);
}

export function midYearGuardMessage(firstName: string, engagedSince: Date, quarters: Period[]): string {
  const list =
    quarters.length === 1 ? quarters[0] : `${quarters.slice(0, -1).join(", ")} and ${quarters[quarters.length - 1]}`;
  return `${firstName} started ${formatManilaDateLong(engagedSince)}. Enter ${firstName}'s starting figures first, so ${list} aren't created as work.`;
}

export class MidYearGuardError extends Error {
  constructor(
    message: string,
    public readonly clientId: string,
    public readonly taxableYear: number,
    public readonly quarters: Period[],
  ) {
    super(message);
    this.name = "MidYearGuardError";
  }
}

/**
 * D78 — throws MidYearGuardError when a client engaged part-way through
 * the year has no StartingFigures row for it. Starting figures remain the
 * ONLY thing that names a quarter as filed outside the app; engagedSince
 * never excludes a quarter on its own (D56). Any saved row satisfies the
 * guard, including "latest outside return: none".
 */
export async function assertMidYearStartingFiguresEntered(clientId: string, taxableYear: number): Promise<void> {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  const quarters = quartersEndedBeforeEngagement(taxableYear, client.engagedSince);
  if (quarters.length === 0) return;
  const saved = await prisma.startingFigures.findUnique({ where: { clientId_taxableYear: { clientId, taxableYear } } });
  if (saved) return;
  const firstName = client.registeredName.trim().split(/\s+/)[0] ?? client.registeredName;
  throw new MidYearGuardError(
    midYearGuardMessage(firstName, client.engagedSince as Date, quarters),
    clientId,
    taxableYear,
    quarters,
  );
}
