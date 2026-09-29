"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { startingFiguresSchema } from "@/lib/validation/startingFigures";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import { pesosToCents } from "@/lib/money";
import { getStartingFigures, isStartingFiguresLocked } from "@/lib/startingFigures";
import { ALL_PERIODS, outsidePeriodsFor } from "@/lib/tax/periods";
import { checkAndRecordAmendments } from "@/lib/filingComputation";
import { reopenPreparedFiling } from "@/lib/actions/workflowSteps";

export type StartingFiguresFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: Record<string, string>;
  saved?: boolean;
};

const FIELDS = [
  "latestOutsideReturn",
  "priorYearExcessCredit",
  "cumulativeIncome",
  "withholdingPreviousQuarters",
  "withholdingThisQuarter",
  "paymentsPreviousQuarters",
  "amountPaidThisReturn",
  "otherCredits",
  "otherCreditsDescription",
  "nonOperatingIncome",
] as const;

function rawFromFormData(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of FIELDS) {
    const v = formData.get(key);
    values[key] = typeof v === "string" ? v : "";
  }
  return values;
}

/**
 * Brief #5f §8 — create or edit a client-year's starting figures. Editable
 * until the year's first in-app return is filed (step 5, FILE_RETURN,
 * DONE) — enforced here, not just by the page hiding the Edit button.
 *
 * Saving retroactively flags/clears Filing.filedOutsideApp on whatever
 * Filing rows already exist for this client-year (the ordinary case is
 * simpler: generateFilingsForClientYear, run after starting figures are
 * saved, never creates a row for an outside period in the first place —
 * this only matters for a Filing generated before starting figures named
 * its period outside).
 *
 * A saved change is a figure change (§8's own reopening rule, same shape
 * as #5d §6 and #5f §3): every unfiled filing of the year whose own step 3
 * is Done gets reopened — reopenPreparedFiling already no-ops for a filed
 * filing or one whose step 3 isn't Done, so calling it for every filing of
 * the year is both correct and simple.
 */
export async function saveStartingFigures(
  clientId: string,
  taxableYear: number,
  _prevState: StartingFiguresFormState,
  formData: FormData,
): Promise<StartingFiguresFormState> {
  const values = rawFromFormData(formData);
  const parsed = startingFiguresSchema.safeParse(values);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  }

  const clientTaxYear = await prisma.clientTaxYear.findUnique({
    where: { clientId_taxableYear: { clientId, taxableYear } },
  });
  if (!clientTaxYear) {
    return { error: "No tax-year record exists yet for this client and year — add one first.", values };
  }

  const existing = await getStartingFigures(clientId, taxableYear);
  const lockedAgainst = existing?.latestOutsideReturn ?? "NONE";
  if (await isStartingFiguresLocked(clientId, taxableYear, lockedAgainst)) {
    return { error: "This year's first in-app return has already been filed — starting figures are locked.", values };
  }

  const data = {
    latestOutsideReturn: parsed.data.latestOutsideReturn,
    priorYearExcessCreditCents: pesosToCents(parsed.data.priorYearExcessCredit),
    cumulativeIncomeCents: pesosToCents(parsed.data.cumulativeIncome),
    withholdingPreviousQuartersCents: pesosToCents(parsed.data.withholdingPreviousQuarters),
    withholdingThisQuarterCents: pesosToCents(parsed.data.withholdingThisQuarter),
    paymentsPreviousQuartersCents: pesosToCents(parsed.data.paymentsPreviousQuarters),
    amountPaidThisReturnCents: pesosToCents(parsed.data.amountPaidThisReturn),
    otherCreditsCents: pesosToCents(parsed.data.otherCredits),
    otherCreditsDescription: parsed.data.otherCreditsDescription || null,
    nonOperatingIncomeCents: pesosToCents(parsed.data.nonOperatingIncome),
  };

  const actorId = await getActorId();

  const saved = await prisma.$transaction(async (tx) => {
    const row = await tx.startingFigures.upsert({
      where: { clientId_taxableYear: { clientId, taxableYear } },
      create: { clientId, taxableYear, clientTaxYearId: clientTaxYear.id, actorId, ...data },
      update: { actorId, ...data },
    });

    // Item 55 is stored on ClientTaxYear permanently (brief #5f §4) —
    // starting figures is the only place it's entered, but the tax engine
    // still reads it straight off ClientTaxYear, unaffected by latestOutsideReturn.
    await tx.clientTaxYear.update({
      where: { id: clientTaxYear.id },
      data: { priorYearExcessCreditCents: data.priorYearExcessCreditCents, actorId },
    });

    return row;
  });

  await logActivity({
    entityType: "StartingFigures",
    entityId: saved.id,
    action: existing ? "UPDATE" : "CREATE",
    before: existing ?? undefined,
    after: saved,
    actorId,
  });

  const outsidePeriods = outsidePeriodsFor(data.latestOutsideReturn);
  await prisma.filing.updateMany({
    where: { clientId, taxableYear, period: { in: [...outsidePeriods] } },
    data: { filedOutsideApp: true },
  });
  const inAppPeriodsToClear = ALL_PERIODS.filter((p) => !outsidePeriods.includes(p));
  await prisma.filing.updateMany({
    where: { clientId, taxableYear, period: { in: [...inAppPeriodsToClear] } },
    data: { filedOutsideApp: false },
  });

  const filings = await prisma.filing.findMany({ where: { clientId, taxableYear, deletedAt: null } });
  for (const f of filings) {
    await reopenPreparedFiling(f.id);
  }

  await checkAndRecordAmendments(clientId, taxableYear, null, `The starting figures for ${taxableYear} changed.`);

  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/clients/${clientId}/tax-years/${clientTaxYear.id}/starting-figures`);
  return { saved: true, values };
}
