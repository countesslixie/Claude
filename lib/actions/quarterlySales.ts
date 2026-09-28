"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { quarterlySalesSchema } from "@/lib/validation/quarterlySales";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import { pesosToCents, centsToPesos } from "@/lib/money";
import { formatManilaDate } from "@/lib/dates";
import { checkAndRecordAmendments } from "@/lib/filingComputation";
import { salesQuarterEndDate, filingPeriodForSalesQuarter, outsideSalesQuartersFor } from "@/lib/tax/periods";
import { getStartingFigures } from "@/lib/startingFigures";
import { markStepDone, markStepWaitingExternal, reopenPreparedFiling, reopenSkippedReceive2307 } from "@/lib/actions/workflowSteps";
import type { SalesQuarter } from "@/lib/tax/types";

export type QuarterlySalesFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: {
    customers: { customerName: string; amount: string }[];
    nonOperatingIncome: string;
    notes: string;
    noSalesThisQuarter: boolean;
  };
  saved?: boolean;
  /** True once this save leaves step 1 (RECORD_SALES) Done; false if it left it (or reverted it to) open. */
  finalized?: boolean;
  /** Manila-formatted date of this save, for the "Draft saved .../Saved ..." label (brief #4d). */
  savedAt?: string;
};

function rowsFromFormData(formData: FormData): { customerName: string; amount: string }[] {
  const names = formData.getAll("customerName").map((v) => String(v));
  const amounts = formData.getAll("amount").map((v) => String(v));
  return names
    .map((customerName, i) => ({ customerName, amount: amounts[i] ?? "" }))
    .filter((r) => r.customerName.trim() !== "" || r.amount.trim() !== "");
}

/**
 * Brief #4b (D33) — declares (creates or edits) one quarter's gross
 * sales for a client's taxable year as the sum of per-customer rows.
 * This is the only place income enters the system; a Form 2307 never
 * contributes to it (D26). `intent` is "draft" (stores the rows, leaves
 * step 1 not done) or "final" (stores the rows and marks step 1 done —
 * see lib/workflow/groups.ts's RECORD_SALES self-completion).
 *
 * Brief #4d — a quarter that's already final and is then edited and
 * saved as a draft goes back to open: step 1 reverts to
 * WAITING_EXTERNAL and finalizedAt is cleared. This supersedes brief
 * #4b's original "once done, further edits never undo it" — the
 * bookkeeper's walkthrough asked for a real Edit/Cancel flow on the
 * income page, and a draft save has to mean draft. The quarter itself
 * stays editable either way until its own return is filed (step 5,
 * FILE_RETURN, DONE), which this rejects outright.
 */
export async function saveQuarterlySales(
  clientId: string,
  taxableYear: number,
  quarter: SalesQuarter,
  _prevState: QuarterlySalesFormState,
  formData: FormData,
): Promise<QuarterlySalesFormState> {
  const intentRaw = formData.get("intent");
  const intent: "draft" | "final" = intentRaw === "final" ? "final" : "draft";
  const noSalesThisQuarter = formData.get("noSalesThisQuarter") === "on";
  const rows = rowsFromFormData(formData);
  const nonOperatingIncome = String(formData.get("nonOperatingIncome") ?? "");
  const notes = String(formData.get("notes") ?? "");

  const values = {
    customers: rows.length > 0 ? rows : [{ customerName: "", amount: "" }],
    nonOperatingIncome,
    notes,
    noSalesThisQuarter,
  };

  const parsed = quarterlySalesSchema.safeParse({
    intent,
    noSalesThisQuarter,
    customers: rows,
    nonOperatingIncome,
    notes,
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  }
  if (intent === "final" && !parsed.data.noSalesThisQuarter && parsed.data.customers.length === 0) {
    return {
      fieldErrors: { customers: ["Add at least one customer row, or check \"No sales this quarter.\""] },
      values,
    };
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return { error: "Client not found." };

  // Brief #5f §8 — a quarter "filed outside the app" (starting figures)
  // can never have sales entered for it in the app; the starting figures
  // replace it in every computation instead.
  const startingFigures = await getStartingFigures(clientId, taxableYear);
  const outsideQuarters = outsideSalesQuartersFor(startingFigures?.latestOutsideReturn ?? "NONE");
  if (outsideQuarters.includes(quarter)) {
    return { error: `${quarter} ${taxableYear} was filed outside the app — sales can't be entered for it here.`, values };
  }

  // A quarter is read-only once its own return is filed (step 5,
  // FILE_RETURN, DONE) — a filing for a later quarter/year that's already
  // filed is irrelevant; only the filing whose OWN quarter this is matters.
  const filingPeriod = filingPeriodForSalesQuarter(quarter);
  const filing = await prisma.filing.findUnique({
    where: { clientId_taxableYear_period: { clientId, taxableYear, period: filingPeriod } },
  });
  if (filing) {
    const fileReturnStep = await prisma.workflowStep.findFirst({
      where: { filingId: filing.id, stepCode: "FILE_RETURN" },
    });
    if (fileReturnStep?.status === "DONE") {
      return { error: "This quarter is locked — its return has already been filed.", values };
    }
  }

  const grossSalesCents = parsed.data.noSalesThisQuarter
    ? 0
    : parsed.data.customers.reduce((sum, r) => sum + pesosToCents(r.amount), 0);
  const nonOperatingIncomeCents = pesosToCents(parsed.data.nonOperatingIncome);

  const existing = await prisma.quarterlySales.findUnique({
    where: { clientId_taxableYear_quarter: { clientId, taxableYear, quarter } },
  });
  const existingCustomers = existing
    ? await prisma.quarterlySalesCustomer.findMany({ where: { quarterlySalesId: existing.id } })
    : [];

  // Brief #5d §6 — a FINAL save only reopens steps 3/4 if the figures
  // behind the computation actually changed: any payor row (name or
  // amount), the non-operating income figure, or the no-sales flag. Notes
  // aren't part of the computation, so a notes-only edit doesn't count.
  const signature = (customers: { customerName: string; amountCents: number }[], nonOpCents: number, noSales: boolean) =>
    JSON.stringify({
      customers: customers.map((c) => `${c.customerName.trim()}::${c.amountCents}`).sort(),
      nonOpCents,
      noSales,
    });
  const oldSignature = existing
    ? signature(existingCustomers, existing.nonOperatingIncomeCents, existing.noSalesThisQuarter)
    : null;
  const newSignature = signature(
    parsed.data.noSalesThisQuarter ? [] : parsed.data.customers.map((c) => ({ customerName: c.customerName, amountCents: pesosToCents(c.amount) })),
    nonOperatingIncomeCents,
    parsed.data.noSalesThisQuarter,
  );
  const figuresChanged = oldSignature !== newSignature;

  const actorId = await getActorId();
  const now = new Date();
  // Brief #4d — finalizedAt mirrors intent on every save: a draft save
  // clears it even if the quarter was final before, since that's the
  // whole point of the revert-to-draft flow below.
  const finalizedAt = intent === "final" ? (existing?.finalizedAt ?? now) : null;

  const saved = await prisma.$transaction(async (tx) => {
    const row = await tx.quarterlySales.upsert({
      where: { clientId_taxableYear_quarter: { clientId, taxableYear, quarter } },
      create: {
        clientId,
        taxableYear,
        quarter,
        grossSalesCents,
        nonOperatingIncomeCents,
        noSalesThisQuarter: parsed.data.noSalesThisQuarter,
        finalizedAt,
        notes: parsed.data.notes ?? null,
        actorId,
      },
      update: {
        grossSalesCents,
        nonOperatingIncomeCents,
        noSalesThisQuarter: parsed.data.noSalesThisQuarter,
        finalizedAt,
        notes: parsed.data.notes ?? null,
        actorId,
      },
    });

    await tx.quarterlySalesCustomer.deleteMany({ where: { quarterlySalesId: row.id } });
    if (!parsed.data.noSalesThisQuarter && parsed.data.customers.length > 0) {
      await tx.quarterlySalesCustomer.createMany({
        data: parsed.data.customers.map((c) => ({
          quarterlySalesId: row.id,
          customerName: c.customerName,
          amountCents: pesosToCents(c.amount),
        })),
      });
    }

    return row;
  });

  await logActivity({
    entityType: "QuarterlySales",
    entityId: saved.id,
    action: existing ? "UPDATE" : "CREATE",
    before: existing ?? undefined,
    after: saved,
    actorId,
  });

  // Integrity rule (SPEC.md 5): if this quarter feeds an already-filed
  // period's cumulative window, raise an AmendmentAlert rather than
  // silently leaving that filing's frozen snapshot out of sync.
  const affectedDate = salesQuarterEndDate(taxableYear, quarter);
  await checkAndRecordAmendments(
    clientId,
    taxableYear,
    affectedDate,
    `Declared sales for ${quarter} ${taxableYear} ${existing ? "edited" : "entered"}: gross ${centsToPesos(
      grossSalesCents,
      { withSymbol: true },
    )}, non-operating ${centsToPesos(nonOperatingIncomeCents, { withSymbol: true })}.`,
  );

  let finalizedStep1 = false;
  if (filing) {
    const step = await prisma.workflowStep.findFirst({ where: { filingId: filing.id, stepCode: "RECORD_SALES" } });
    if (step) {
      if (intent === "final") {
        if (step.status !== "DONE") {
          const result = await markStepDone(step.id);
          if (!result.ok) {
            return { error: result.error, saved: true, values };
          }
        }
        finalizedStep1 = true;
        // Brief #5d §6 — a final save that actually changed the figures
        // behind the computation reopens steps 3/4 if step 3 was already
        // Done (a no-op re-save doesn't).
        if (figuresChanged) {
          await reopenPreparedFiling(filing.id);
          // Brief #5i §2 — her decision: a Skipped step 2 reopens on the
          // same trigger, since a different income figure may mean a
          // certificate she didn't expect.
          await reopenSkippedReceive2307(filing.id, actorId, "Step 2 reopened: sales changed.");
        }
      } else if (step.status === "DONE") {
        // Brief #4d — saving as draft after Edit reverts a previously-
        // final quarter: step 1 goes back to "waiting on client" the
        // same way it reads before it's ever been saved final.
        await markStepWaitingExternal(step.id);
        // Brief #5d §6 — a draft save already reopens step 1 (above); it
        // now reopens steps 3/4 too, unconditionally (same as step 1).
        await reopenPreparedFiling(filing.id);
        // Brief #5i §2 — same trigger as the final-save branch above.
        await reopenSkippedReceive2307(filing.id, actorId, "Step 2 reopened: sales changed.");
      }
    }
  }

  revalidatePath(`/clients/${clientId}/income`);
  if (filing) revalidatePath(`/clients/${clientId}/filings/${filing.id}`);

  return { saved: true, finalized: finalizedStep1, values, savedAt: formatManilaDate(saved.updatedAt) };
}
