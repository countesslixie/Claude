"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import { manilaDateInputToJsDate } from "@/lib/dates";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";

export type GenerateFilingsResult =
  | { ok: true; createdCount: number; skippedCount: number }
  | { ok: false; error: string };

/**
 * UI trigger for filing generation (Phase 3). Iterates ALL_PERIODS
 * (lib/workflow/filingGeneration.ts) — never a hand-typed period list —
 * and is safe to call more than once for the same client/year: periods
 * that already have a Filing are left untouched.
 */
export async function generateFilingsAction(clientId: string, taxableYear: number): Promise<GenerateFilingsResult> {
  if (!Number.isInteger(taxableYear) || taxableYear < 2000 || taxableYear > 2100) {
    return { ok: false, error: "Enter a valid taxable year." };
  }

  try {
    const { createdPeriods, skippedPeriods } = await generateFilingsForClientYear(clientId, taxableYear);
    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/filings");
    return { ok: true, createdCount: createdPeriods.length, skippedCount: skippedPeriods.length };
  } catch (err) {
    if (err instanceof Error && err.message.includes("TaxRuleSet")) {
      return { ok: false, error: `No TaxRuleSet exists for taxable year ${taxableYear}. Add one in Settings first.` };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Could not generate filings." };
  }
}

/**
 * PREPARE_RETURN step prompt (SPEC.md WORKFLOW CHANGE item 4): "Have you
 * confirmed with the client that all receipts for this quarter are
 * accounted for, including any without a 2307?" Recorded once, with a
 * timestamp.
 */
export async function acknowledgeReceiptsComplete(filingId: string, note: string): Promise<void> {
  const before = await prisma.filing.findUnique({ where: { id: filingId } });
  if (!before) return;

  const actorId = await getActorId();
  const updated = await prisma.filing.update({
    where: { id: filingId },
    data: { receiptsAcknowledgedAt: new Date(), receiptsAcknowledgedNote: note || null, actorId },
  });

  await logActivity({
    entityType: "Filing",
    entityId: filingId,
    action: "UPDATE",
    before,
    after: updated,
    actorId,
  });

  revalidatePath(`/clients/${before.clientId}/filings/${filingId}`);
}

/**
 * Acknowledges an AmendmentAlert (SPEC.md 5) — records that the
 * bookkeeper has seen the delta and decided what to do about it. Never
 * touches the filing's frozen computationSnapshot or resolves the alert
 * automatically; acknowledgement is just a record of "I've seen this."
 */
export async function acknowledgeAmendmentAlert(alertId: string, note: string): Promise<void> {
  const before = await prisma.amendmentAlert.findUnique({ where: { id: alertId }, include: { filing: true } });
  if (!before) return;

  const actorId = await getActorId();
  const updated = await prisma.amendmentAlert.update({
    where: { id: alertId },
    data: { acknowledgedAt: new Date(), acknowledgedNote: note || null },
  });

  await logActivity({
    entityType: "AmendmentAlert",
    entityId: alertId,
    action: "UPDATE",
    before,
    after: updated,
    actorId,
  });

  revalidatePath(`/clients/${before.filing.clientId}/filings/${before.filingId}`);
}

/**
 * Sets or clears the manual certificate-cutoff override (SPEC.md 3.5,
 * Phase 2b P5). Always editable — this is a correction to which
 * certificates the filing claims, not part of the frozen
 * computationSnapshot, so it can be changed even after filing. Pass an
 * empty string to clear the override and fall back to the resolver's
 * filedAt/today rule.
 */
export async function setCertificateCutoffOverride(filingId: string, dateInput: string): Promise<void> {
  const before = await prisma.filing.findUnique({ where: { id: filingId } });
  if (!before) return;

  const override = dateInput ? manilaDateInputToJsDate(dateInput) : null;

  const actorId = await getActorId();
  const updated = await prisma.filing.update({
    where: { id: filingId },
    data: { certificateCutoffOverride: override, actorId },
  });

  await logActivity({
    entityType: "Filing",
    entityId: filingId,
    action: "UPDATE",
    before,
    after: updated,
    actorId,
  });

  revalidatePath(`/clients/${before.clientId}/filings/${filingId}`);
}
