"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import {
  resolveCertificateCutoffForFilingPeriod,
  getAllCertificatesThisYear,
  selectUnbatchedClaimableCertificates,
} from "@/lib/sawt/eligibleCertificates";
import type { Period } from "@/lib/tax/types";

export type GenerateSawtBatchResult = { ok: boolean; error?: string; batchedCount?: number };

/**
 * Assigns every certificate currently eligible-but-unbatched through
 * `period` (SPEC.md 10 — the same set lib/reconciliation.ts's check 3
 * reports as the variance) to this period's SawtBatch, creating it if
 * it doesn't exist yet. This is what "generating" the batch means: a
 * snapshot of which certificates this Alphalist submission covers. Idle
 * (batchedCount: 0) if there's nothing new to add — re-running it is
 * always safe.
 */
export async function generateSawtBatch(
  clientId: string,
  taxableYear: number,
  period: Period,
): Promise<GenerateSawtBatchResult> {
  const cutoffDate = await resolveCertificateCutoffForFilingPeriod(clientId, taxableYear, period);
  const allCertificates = await getAllCertificatesThisYear(clientId, taxableYear);
  const toBatch = selectUnbatchedClaimableCertificates(allCertificates, period, cutoffDate);

  const actorId = await getActorId();

  const batch = await prisma.sawtBatch.upsert({
    where: { clientId_taxableYear_period: { clientId, taxableYear, period } },
    create: { clientId, taxableYear, period, status: "GENERATED", generatedAt: new Date(), actorId },
    update: {},
  });

  if (toBatch.length > 0) {
    await prisma.form2307.updateMany({
      where: { id: { in: toBatch.map((c) => c.id) } },
      data: { sawtBatchId: batch.id },
    });
    await logActivity({
      entityType: "SawtBatch",
      entityId: batch.id,
      action: "UPDATE",
      before: { certificateCount: 0 },
      after: { addedCertificateIds: toBatch.map((c) => c.id) },
      actorId,
    });
  }

  revalidatePath(`/clients/${clientId}/form-2307`);
  revalidatePath(`/clients/${clientId}/sawt-worksheet`);

  return { ok: true, batchedCount: toBatch.length };
}
