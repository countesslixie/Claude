"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import { pesosToCents, centsToPesos } from "@/lib/money";
import { generateFilingsForClientYear } from "@/lib/workflow/filingGeneration";
import { MidYearGuardError } from "@/lib/workflow/midYearGuard";
import { recomputeReceive2307Status, reopenPreparedFiling, markStepDone } from "@/lib/actions/workflowSteps";
import { payGroupBlockReason } from "@/lib/workflow/groups";
import { otherCreditsSchema } from "@/lib/validation/otherCredits";
import { paymentSchema } from "@/lib/validation/payment";
import { ALL_PERIODS } from "@/lib/tax/periods";
import { manilaDateInputToJsDate } from "@/lib/dates";
import { isPaymentLocked } from "@/lib/filingComputation";
import type { Period } from "@/lib/tax/types";

export type GenerateFilingsResult =
  | { ok: true; createdCount: number; skippedCount: number; outsideCount: number }
  | { ok: false; error: string; startingFiguresHref?: string };

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
    if (err instanceof MidYearGuardError) {
      // D78 — link straight to that year's starting figures; if the tax-year row
      // doesn't exist yet, that screen can't open, so link to adding it instead.
      const taxYear = await prisma.clientTaxYear.findUnique({
        where: { clientId_taxableYear: { clientId, taxableYear } },
      });
      return {
        ok: false,
        error: err.message,
        startingFiguresHref: taxYear
          ? `/clients/${clientId}/tax-years/${taxYear.id}/starting-figures`
          : `/clients/${clientId}/tax-years/new`,
      };
    }
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

export type SavePaymentFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: Record<string, string>;
  saved?: boolean;
};

/**
 * D75 (brief #5m §3.2) — step 8 (MAKE_PAYMENT): amount paid, date of
 * payment, and the bank/channel paid through, saved to the filing's own
 * long-standing payment fields (amountPaidCents/paymentDate/
 * paymentChannel — SPEC.md already named these; nothing writes them from
 * inside the app until now). Marks step 8 Done via the ordinary
 * markStepDone (so the File-done gate — payGroupBlockReason — and the
 * election hard-blocker both still apply, the same reasoning every other
 * step's own action already follows).
 *
 * Editable afterwards (an Edit/Save/Cancel round-trip, same pattern as
 * D40/D55) until isPaymentLocked (lib/filingComputation.ts) says the next
 * filing of the same taxable year has already filed with this figure
 * baked into its own item 56/58.
 *
 * A saved change — the first save, or any later edit that actually
 * changes the amount/date/channel — reopens every later, still-unfiled
 * filing of the same taxable year that already has step 3
 * (PREPARE_RETURN) Done (reopenPreparedFiling itself no-ops otherwise),
 * since item 56/58 on each of them is read live off
 * Filing.amountPaidCents for every earlier filed period
 * (priorPeriodPaymentsCentsThrough) — unlike item 61's inheritance chain,
 * there is no "chain break": every later filing's own item 56/58 always
 * depends on this filing's own actual paid amount, so every later
 * unfiled filing is reopened, not just up to some break point.
 */
export async function savePayment(
  filingId: string,
  _prevState: SavePaymentFormState,
  formData: FormData,
): Promise<SavePaymentFormState> {
  const values = {
    amountPaid: String(formData.get("amountPaid") ?? ""),
    paymentDate: String(formData.get("paymentDate") ?? ""),
    paymentChannel: String(formData.get("paymentChannel") ?? ""),
  };
  const parsed = paymentSchema.safeParse(values);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  }

  const filing = await prisma.filing.findUnique({
    where: { id: filingId },
    include: {
      workflowSteps: {
        where: { stepCode: { in: ["MAKE_PAYMENT", "FILE_RETURN", "SAVE_SUBMISSION_SS", "SAVE_FORM_COPY"] } },
      },
    },
  });
  if (!filing) return { error: "Filing not found.", values };

  const step = filing.workflowSteps.find((s) => s.stepCode === "MAKE_PAYMENT");
  if (!step) return { error: "This filing has no Make payment step.", values };

  // D75 (brief #5m §3.1) — refused here, not just by the UI hiding the
  // card, so it can't be bypassed by calling this action directly.
  const fileBlockReason = payGroupBlockReason(filing.workflowSteps);
  if (fileBlockReason) return { error: fileBlockReason, values };

  if (await isPaymentLocked(filing.clientId, filing.taxableYear, filing.period as Period)) {
    return { error: "This return's payment is locked — the next return has already been filed with this figure.", values };
  }

  const amountPaidCents = pesosToCents(parsed.data.amountPaid);
  const paymentDate = manilaDateInputToJsDate(parsed.data.paymentDate);
  const paymentChannel = parsed.data.paymentChannel;
  const changed =
    filing.amountPaidCents !== amountPaidCents ||
    filing.paymentDate?.getTime() !== paymentDate.getTime() ||
    filing.paymentChannel !== paymentChannel;

  const actorId = await getActorId();
  const updated = await prisma.filing.update({
    where: { id: filingId },
    data: { amountPaidCents, paymentDate, paymentChannel, actorId },
  });

  await logActivity({ entityType: "Filing", entityId: filingId, action: "UPDATE", before: filing, after: updated, actorId });

  if (step.status !== "DONE") {
    const result = await markStepDone(step.id);
    if (!result.ok) return { error: result.error, values };
  }

  if (changed) {
    const yearFilings = await prisma.filing.findMany({
      where: { clientId: filing.clientId, taxableYear: filing.taxableYear, deletedAt: null, filedOutsideApp: false },
    });
    const ordered = ALL_PERIODS.map((p) => yearFilings.find((f) => f.period === p)).filter(
      (f): f is NonNullable<typeof f> => f != null,
    );
    const startIndex = ordered.findIndex((f) => f.id === filingId);
    for (let i = startIndex + 1; i < ordered.length; i++) {
      await reopenPreparedFiling(ordered[i].id);
    }
  }

  revalidatePath(`/clients/${filing.clientId}/filings/${filingId}`);
  return { saved: true, values: { ...values, amountPaid: centsToPesos(amountPaidCents) } };
}
