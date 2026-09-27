"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import { pesosToCents } from "@/lib/money";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";
import { recomputeReceive2307Status, reopenPreparedFiling } from "@/lib/actions/workflowSteps";
import { otherCreditsSchema } from "@/lib/validation/otherCredits";
import { ALL_PERIODS } from "@/lib/tax/periods";

export type GenerateFilingsResult =
  | { ok: true; createdCount: number; skippedCount: number; outsideCount: number }
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
    const { createdPeriods, skippedPeriods, outsidePeriods } = await generateFilingsForClientYear(clientId, taxableYear);
    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/filings");
    return { ok: true, createdCount: createdPeriods.length, skippedCount: skippedPeriods.length, outsideCount: outsidePeriods.length };
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
  // Brief #5e §6 — supersedes brief #5d §6's "unticking reopens steps
  // 3/4": that was too eager. Unticking alone reopens nothing downstream
  // — it only reverts step 2 itself (recomputeReceive2307Status above).
  // Only actually adding or removing a certificate (lib/actions/form2307.ts)
  // changes the figures behind the computation, so only those call
  // reopenPreparedFiling.
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

export type OtherCreditsFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: Record<string, string>;
  saved?: boolean;
};

/**
 * Brief #5f §3 — item 61 (1701Q) / item 63 (1701A) is now one figure PER
 * RETURN (Filing.otherCreditsCents), replacing brief #5e's year-level
 * ClientTaxYear.otherCreditsCents. Locked once THIS filing's own step 5
 * (FILE_RETURN) is DONE, enforced here, not just by the form hiding its
 * Edit button.
 *
 * A saved change reopens this filing's own steps 3/4 (via
 * reopenPreparedFiling, a no-op if step 3 isn't Done or the filing is
 * filed) and propagates forward: every LATER filing of the same year that
 * still inherits (its own otherCreditsCents is still null) also reopens,
 * stopping at the first one with its own saved value — that one no longer
 * depends on this filing's figure, so nothing past it is affected.
 */
export async function updateFilingOtherCredits(
  filingId: string,
  _prevState: OtherCreditsFormState,
  formData: FormData,
): Promise<OtherCreditsFormState> {
  const values = {
    otherCredits: String(formData.get("otherCredits") ?? ""),
    otherCreditsDescription: String(formData.get("otherCreditsDescription") ?? ""),
  };
  const parsed = otherCreditsSchema.safeParse(values);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  }

  const filing = await prisma.filing.findUnique({
    where: { id: filingId },
    include: { workflowSteps: { where: { stepCode: "FILE_RETURN" } } },
  });
  if (!filing) return { error: "Filing not found.", values };
  if (filing.workflowSteps[0]?.status === "DONE") {
    return { error: "This return has already been filed — item 61 is locked.", values };
  }

  const otherCreditsCents = pesosToCents(parsed.data.otherCredits);
  const otherCreditsDescription = parsed.data.otherCreditsDescription || null;
  const changed = filing.otherCreditsCents !== otherCreditsCents || filing.otherCreditsDescription !== otherCreditsDescription;

  const actorId = await getActorId();
  const updated = await prisma.filing.update({
    where: { id: filingId },
    data: { otherCreditsCents, otherCreditsDescription, actorId },
  });

  await logActivity({ entityType: "Filing", entityId: filingId, action: "UPDATE", before: filing, after: updated, actorId });

  if (changed) {
    await reopenPreparedFiling(filingId);

    const yearFilings = await prisma.filing.findMany({
      where: { clientId: filing.clientId, taxableYear: filing.taxableYear, deletedAt: null, filedOutsideApp: false },
    });
    const ordered = ALL_PERIODS.map((p) => yearFilings.find((f) => f.period === p)).filter(
      (f): f is NonNullable<typeof f> => f != null,
    );
    const startIndex = ordered.findIndex((f) => f.id === filingId);
    for (let i = startIndex + 1; i < ordered.length; i++) {
      const later = ordered[i];
      if (later.otherCreditsCents != null) break; // chain broken — later filings no longer depend on this one
      await reopenPreparedFiling(later.id);
    }
  }

  revalidatePath(`/clients/${filing.clientId}/filings/${filingId}`);
  return { saved: true, values };
}
