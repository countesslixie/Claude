"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import { manilaDateInputToJsDate } from "@/lib/dates";

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
