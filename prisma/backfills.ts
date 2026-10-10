import type { PrismaClient } from "@prisma/client";
import { deriveFilingStatus } from "../lib/workflow/status";
import { clientDocsDueDate } from "../lib/tax/deadlines";
import { parseDocSlots } from "../lib/workflow/types";

/**
 * Idempotent backfills the seed runs over an existing database (brief #5q).
 * They live here, taking the client as an argument, so tests can run them
 * without running the whole seed.
 */

/**
 * D96 -- steps 13 and 14 renamed. A WorkflowStep row keeps its own copy of
 * its title (the D66/D90/D92 class of bug), so the template change alone
 * would never reach an existing filing. Exact old titles only: a second run
 * matches nothing. Step 14's D92 title and its original one are both covered.
 */
export async function renameSawtSteps(prisma: PrismaClient): Promise<void> {
  await prisma.workflowStep.updateMany({
    where: { stepCode: "SAWT_VALIDATION", title: { in: ["Receive & save validation email", "Save eAFS validation email"] } },
    data: { title: "Save SAWT validation email" },
  });
  await prisma.workflowStep.updateMany({
    where: { stepCode: "SAWT_ACK", title: "Receive & save acknowledgement email" },
    data: { title: "Save SAWT acknowledgement email" },
  });
}

/**
 * D97 -- Filing.status is stored, and the rule for "Waiting on BIR" changed
 * (only when nothing of hers is left). Only rows currently reading Waiting on
 * BIR can change, so only those are recomputed, with the same function the app
 * uses; every other stored status is left exactly as the app last wrote it.
 */
export async function backfillFilingStatuses(prisma: PrismaClient): Promise<void> {
  const filings = await prisma.filing.findMany({ where: { status: "WAITING_BIR" }, include: { workflowSteps: true } });
  const now = new Date();
  for (const filing of filings) {
    const status = deriveFilingStatus({
      steps: filing.workflowSteps.map((s) => ({ stepCode: s.stepCode, status: s.status, waitingOnLabel: s.waitingOnLabel })),
      adjustedDueDate: filing.adjustedDueDate,
      now,
    });
    if (status !== filing.status) await prisma.filing.update({ where: { id: filing.id }, data: { status } });
  }
}

/**
 * D106 (brief #5s) -- Filing.certificatesExpectedBy is stored when a filing is
 * generated, so filings that already exist still hold the old "10 days before
 * the due date" (or Feb 15) value. Rewrite it to the engagement-letter date for
 * every filing not yet filed (step 5 not Done); filed ones keep the date they
 * were worked to. A waiting step 2 whose clock was stamped at the old date
 * moves with it. Idempotent: a second run finds nothing different.
 */
export async function backfillClientDocsDue(prisma: PrismaClient): Promise<void> {
  const filings = await prisma.filing.findMany({ include: { workflowSteps: true } });
  const ruleSets = new Map((await prisma.taxRuleSet.findMany()).map((r) => [r.taxableYear, r.clientDocsDueDay]));
  for (const filing of filings) {
    if (filing.workflowSteps.some((s) => s.stepCode === "FILE_RETURN" && s.status === "DONE")) continue;
    const next = clientDocsDueDate(filing.period, filing.taxableYear, ruleSets.get(filing.taxableYear) ?? 20);
    const old = filing.certificatesExpectedBy;
    if (old && old.getTime() === next.getTime()) continue;
    await prisma.filing.update({ where: { id: filing.id }, data: { certificatesExpectedBy: next } });
    const step2 = filing.workflowSteps.find((s) => s.stepCode === "RECEIVE_2307");
    if (step2 && step2.status === "WAITING_EXTERNAL" && old && step2.waitingSince?.getTime() === old.getTime()) {
      await prisma.workflowStep.update({ where: { id: step2.id }, data: { waitingSince: next } });
    }
  }
}

/**
 * D193 -- step 7 (SAVE_FORM_COPY) takes two files, "Page 1" and "Page 2" of the
 * filed form. The 1701Q/1701A are downloaded one page at a time. Page 1 keeps the
 * existing slot code `filed_form` (so a file already saved stays valid as page 1);
 * page 2 is the new `filed_form_page2`. One list, used by the seed's template and
 * by the backfill below.
 */
export const FILED_FORM_SLOTS = [
  { slotCode: "filed_form", label: "Page 1", required: true, acceptedTypes: ["pdf"] },
  { slotCode: "filed_form_page2", label: "Page 2", required: true, acceptedTypes: ["pdf"] },
];

/**
 * D193 -- a WorkflowStep row keeps its own copy of requiredDocSlots (the D66/D90
 * class of bug), so the template change alone never reaches a filing that
 * already exists. This adds the Page 2 slot to step 7 rows that are NOT Done, on
 * filings that are NOT Complete -- and changes nothing but `requiredDocSlots`:
 * no status, no document, no Done step, no Complete filing. A step 7 already Done
 * keeps its one file and stays Done. Idempotent: a row that already lists the
 * Page 2 slot (or has no `filed_form` slot to extend) is left alone.
 */
export async function addFiledFormPage2Slot(prisma: PrismaClient): Promise<number> {
  const steps = await prisma.workflowStep.findMany({
    where: { stepCode: "SAVE_FORM_COPY", status: { not: "DONE" }, filing: { status: { not: "COMPLETE" } } },
    select: { id: true, requiredDocSlots: true },
  });
  let changed = 0;
  for (const step of steps) {
    const slots = parseDocSlots(step.requiredDocSlots);
    if (!slots.some((s) => s.slotCode === "filed_form") || slots.some((s) => s.slotCode === "filed_form_page2")) continue;
    await prisma.workflowStep.update({ where: { id: step.id }, data: { requiredDocSlots: JSON.stringify(FILED_FORM_SLOTS) } });
    changed++;
  }
  return changed;
}
