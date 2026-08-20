"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { quickTransactionSchema } from "@/lib/validation/salesTransaction";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import { manilaDateInputToJsDate } from "@/lib/dates";
import { pesosToCents, applyBps } from "@/lib/money";

export type QuickTransactionResult = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  duplicateOrWarning?: string;
  netReceivedMismatchWarning?: string;
  createdId?: string;
};

function deriveTaxableYearAndQuarter(transactionDate: Date): { taxableYear: number; quarter: number } {
  const taxableYear = transactionDate.getUTCFullYear();
  const quarter = Math.ceil((transactionDate.getUTCMonth() + 1) / 3);
  return { taxableYear, quarter };
}

/**
 * Manual standalone entry — the exception path for receipts with no
 * Form 2307 (SPEC.md WORKFLOW CHANGE item 2). Fast, no modal, no
 * per-row save button: the caller (client component) invokes this
 * directly on Enter and starts a fresh row on success.
 */
export async function createQuickTransaction(
  clientId: string,
  raw: Record<string, string>,
): Promise<QuickTransactionResult> {
  const parsed = quickTransactionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return { ok: false, error: "Client not found." };

  const transactionDate = manilaDateInputToJsDate(parsed.data.transactionDate);
  const { taxableYear, quarter } = deriveTaxableYearAndQuarter(transactionDate);
  const grossAmountCents = pesosToCents(parsed.data.grossAmount);

  // Withholding auto-computes from gross x the client's default rate,
  // but stays editable — an explicit withholdingAmount always wins.
  const explicitWht =
    parsed.data.withholdingAmount && parsed.data.withholdingAmount !== "0"
      ? pesosToCents(parsed.data.withholdingAmount)
      : null;
  const withholdingRateBps = parsed.data.withholdingRateBps || client.defaultWithholdingRateBps || 0;
  const withholdingTaxCents = explicitWht ?? applyBps(grossAmountCents, withholdingRateBps);

  const derivedNetReceivedCents = grossAmountCents - withholdingTaxCents;
  let netReceivedCents = derivedNetReceivedCents;
  let netReceivedMismatchWarning: string | undefined;
  if (parsed.data.netReceivedOverride) {
    const overrideCents = pesosToCents(parsed.data.netReceivedOverride);
    if (overrideCents !== derivedNetReceivedCents) {
      netReceivedMismatchWarning = `Net received you entered doesn't match gross - withholding (expected ${(
        derivedNetReceivedCents / 100
      ).toFixed(2)}). Saved as entered — please recheck.`;
      netReceivedCents = overrideCents;
    }
  }

  // Duplicate OR number for this client warns, never blocks (SPEC.md
  // WORKFLOW CHANGE item 2).
  let duplicateOrWarning: string | undefined;
  if (parsed.data.orNumber) {
    const existing = await prisma.salesTransaction.findFirst({
      where: { clientId, orNumber: parsed.data.orNumber, deletedAt: null },
      orderBy: { transactionDate: "desc" },
    });
    if (existing) {
      duplicateOrWarning = `OR ${parsed.data.orNumber} was already used for this client on ${
        existing.transactionDate.toISOString().split("T")[0]
      }.`;
    }
  }

  const actorId = await getActorId();
  const created = await prisma.salesTransaction.create({
    data: {
      clientId,
      transactionDate,
      taxableYear,
      quarter,
      orNumber: parsed.data.orNumber ?? null,
      payorName: parsed.data.payorName,
      payorTin: parsed.data.payorTin ?? null,
      grossAmountCents,
      withholdingTaxCents,
      withholdingRateBps,
      netReceivedCents,
      incomeType: parsed.data.incomeType,
      description: parsed.data.description ?? null,
      actorId,
    },
  });

  await logActivity({
    entityType: "SalesTransaction",
    entityId: created.id,
    action: "CREATE",
    after: created,
    actorId,
  });

  revalidatePath(`/clients/${clientId}/transactions`);

  return { ok: true, createdId: created.id, duplicateOrWarning, netReceivedMismatchWarning };
}

/**
 * Creates a SalesTransaction from an existing Form2307, pre-filled from
 * the certificate (payor, TIN, gross from incomePayment, CWT from
 * taxWithheld, rate, period) and linked via form2307Id. This is the
 * primary entry path (SPEC.md WORKFLOW CHANGE item 1) — the 2307 is the
 * source document, not an independent check on the transaction.
 */
export async function createTransactionFromForm2307(
  form2307Id: string,
  transactionDateInput: string,
  description?: string,
): Promise<QuickTransactionResult> {
  const cert = await prisma.form2307.findUnique({ where: { id: form2307Id } });
  if (!cert) return { ok: false, error: "Form 2307 not found." };

  const transactionDate = manilaDateInputToJsDate(transactionDateInput);
  const { taxableYear, quarter } = deriveTaxableYearAndQuarter(transactionDate);

  const actorId = await getActorId();
  const created = await prisma.salesTransaction.create({
    data: {
      clientId: cert.clientId,
      transactionDate,
      taxableYear,
      quarter,
      payorName: cert.payorName,
      payorTin: cert.payorTin,
      grossAmountCents: cert.incomePaymentCents,
      withholdingTaxCents: cert.taxWithheldCents,
      withholdingRateBps: cert.withholdingRateBps,
      netReceivedCents: cert.incomePaymentCents - cert.taxWithheldCents,
      incomeType: "OPERATING",
      description: description || `From Form 2307 (${cert.atcCode})`,
      form2307Id: cert.id,
      actorId,
    },
  });

  if (cert.status === "RECEIVED") {
    await prisma.form2307.update({ where: { id: cert.id }, data: { status: "RECORDED", actorId } });
  }

  await logActivity({
    entityType: "SalesTransaction",
    entityId: created.id,
    action: "CREATE",
    after: created,
    actorId,
  });

  revalidatePath(`/clients/${cert.clientId}/transactions`);
  revalidatePath(`/clients/${cert.clientId}/form-2307`);

  return { ok: true, createdId: created.id };
}
