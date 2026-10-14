import { prisma } from "@/lib/prisma";
import { manilaCalendarDay } from "@/lib/dates";
import { validationMonthsForFiling, type ValidationMonthsResult } from "./validationMonths";

/** D200 — the months step 11 needs a file for, from the Form 2307s saved on the filing (I/O wrapper around the pure rule). */
export async function loadValidationMonths(filingId: string): Promise<ValidationMonthsResult> {
  const filing = await prisma.filing.findUnique({ where: { id: filingId }, select: { period: true, taxableYear: true } });
  if (!filing) return { months: [], fellBack: false };
  const certs = await prisma.form2307.findMany({
    where: { claimedOnFilingId: filingId, deletedAt: null },
    select: { periodFrom: true, periodTo: true },
  });
  return validationMonthsForFiling({
    period: filing.period,
    taxableYear: filing.taxableYear,
    certificates: certs.map((c) => ({ periodFromDay: manilaCalendarDay(c.periodFrom), periodToDay: manilaCalendarDay(c.periodTo) })),
  });
}
