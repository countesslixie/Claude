"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { quarterlySalesSchema } from "@/lib/validation/quarterlySales";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import { pesosToCents, centsToPesos } from "@/lib/money";
import { checkAndRecordAmendments } from "@/lib/filingComputation";
import { salesQuarterEndDate, filingPeriodForSalesQuarter } from "@/lib/tax/periods";
import { markStepDone } from "@/lib/actions/workflowSteps";
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
  /** True once this save marked step 1 (RECORD_SALES) done. */
  finalized?: boolean;
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
 * see lib/workflow/groups.ts's RECORD_SALES self-completion). Once step
 * 1 has been finalized once, further edits (draft or final) keep it
 * done; the quarter itself stays editable until its own return is filed
 * (step 5, FILE_RETURN, DONE), which this rejects outright.
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

  const actorId = await getActorId();
  const now = new Date();
  const finalizedAt = intent === "final" ? (existing?.finalizedAt ?? now) : (existing?.finalizedAt ?? null);

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
  if (intent === "final" && filing) {
    const step = await prisma.workflowStep.findFirst({ where: { filingId: filing.id, stepCode: "RECORD_SALES" } });
    if (step) {
      if (step.status !== "DONE") {
        const result = await markStepDone(step.id);
        if (!result.ok) {
          return { error: result.error, saved: true, values };
        }
      }
      finalizedStep1 = true;
    }
  }

  revalidatePath(`/clients/${clientId}/income`);
  if (filing) revalidatePath(`/clients/${clientId}/filings/${filing.id}`);

  return { saved: true, finalized: finalizedStep1, values };
}
