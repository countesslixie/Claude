"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";

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
