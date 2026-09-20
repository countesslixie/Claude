"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { quarterlySalesSchema } from "@/lib/validation/quarterlySales";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import { pesosToCents, centsToPesos } from "@/lib/money";
import { checkAndRecordAmendments } from "@/lib/filingComputation";
import { salesQuarterEndDate } from "@/lib/tax/periods";
import type { SalesQuarter } from "@/lib/tax/types";

export type QuarterlySalesFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: Record<string, string>;
  saved?: boolean;
};

const FIELDS = ["grossSales", "nonOperatingIncome", "sourceNote", "notes"] as const;

function rawFromFormData(formData: FormData) {
  const values: Record<string, string> = {};
  for (const key of FIELDS) {
    const v = formData.get(key);
    values[key] = typeof v === "string" ? v : "";
  }
  return values;
}

/**
 * D26/§5.5 — declares (creates or edits) one quarter's gross sales for a
 * client's taxable year. This is the only place income enters the
 * system; a Form 2307 never contributes to it (D26).
 */
export async function upsertQuarterlySales(
  clientId: string,
  taxableYear: number,
  quarter: SalesQuarter,
  _prevState: QuarterlySalesFormState,
  formData: FormData,
): Promise<QuarterlySalesFormState> {
  const values = rawFromFormData(formData);
  const parsed = quarterlySalesSchema.safeParse(values);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return { error: "Client not found." };

  const grossSalesCents = pesosToCents(parsed.data.grossSales);
  const nonOperatingIncomeCents = pesosToCents(parsed.data.nonOperatingIncome);

  const existing = await prisma.quarterlySales.findUnique({
    where: { clientId_taxableYear_quarter: { clientId, taxableYear, quarter } },
  });

  const actorId = await getActorId();
  const saved = await prisma.quarterlySales.upsert({
    where: { clientId_taxableYear_quarter: { clientId, taxableYear, quarter } },
    create: {
      clientId,
      taxableYear,
      quarter,
      grossSalesCents,
      nonOperatingIncomeCents,
      sourceNote: parsed.data.sourceNote ?? null,
      notes: parsed.data.notes ?? null,
      actorId,
    },
    update: {
      grossSalesCents,
      nonOperatingIncomeCents,
      sourceNote: parsed.data.sourceNote ?? null,
      notes: parsed.data.notes ?? null,
      actorId,
    },
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

  revalidatePath(`/clients/${clientId}/income`);

  return { saved: true, values };
}
