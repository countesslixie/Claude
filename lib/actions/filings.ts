"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";
import { recomputeReceive2307Status, reopenPreparedFiling } from "@/lib/actions/workflowSteps";

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
 * Step 2's "All certificates received" checkbox (brief #4b, D34). Ticking
 * it is one half of what marks step 2 DONE (the other half is every
 * certificate row having its own scan — see
 * lib/actions/workflowSteps.ts's recomputeReceive2307Status). Unticking
 * reverts step 2 to not-done, so a certificate that arrives after ticking
 * but before this filing is filed can still be added: untick, add the
 * row and its scan, re-tick.
 */
export async function setAllCertificatesReceived(filingId: string, received: boolean): Promise<void> {
  const before = await prisma.filing.findUnique({ where: { id: filingId } });
  if (!before) return;

  const actorId = await getActorId();
  const updated = await prisma.filing.update({
    where: { id: filingId },
    data: { certificatesAllReceivedAt: received ? new Date() : null, actorId },
  });

  await logActivity({
    entityType: "Filing",
    entityId: filingId,
    action: "UPDATE",
    before,
    after: updated,
    actorId,
  });

  await recomputeReceive2307Status(filingId);
  // Brief #5d §6 — unticking "all received" reopens steps 3/4 if step 3
  // was already Done (ticking it does not).
  if (!received) await reopenPreparedFiling(filingId);
  revalidatePath(`/clients/${before.clientId}/filings/${filingId}`);
}

/**
 * Dismisses the filing's completeness note (§5.3) — informational only,
 * never a block. Dismissing hides it on this filing; it does not
 * reappear on its own.
 */
export async function dismissCompletenessNote(filingId: string): Promise<void> {
  const before = await prisma.filing.findUnique({ where: { id: filingId } });
  if (!before) return;

  const actorId = await getActorId();
  const updated = await prisma.filing.update({
    where: { id: filingId },
    data: { completenessNoteDismissedAt: new Date(), actorId },
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
