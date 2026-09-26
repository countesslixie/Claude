"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import { buildStorageRelativePath, saveDocumentFile } from "@/lib/documents/storage";
import { computeSha256 } from "@/lib/documents/storage";
import { manilaDateInputToJsDate, formatManilaDate } from "@/lib/dates";
import { recomputeReceive2307Status } from "@/lib/actions/workflowSteps";

export type UploadDocumentResult = {
  ok: boolean;
  error?: string;
  duplicateWarning?: string;
  documentId?: string;
};

/** SPEC.md §8: maps a workflow step's doc slotCode to a Document.category. */
const SLOT_CODE_TO_CATEGORY: Record<string, string> = {
  form2307_scan: "FORM_2307_SCAN",
  source_receipts: "SOURCE_RECEIPT",
  draft_computation: "COMPUTATION_SHEET",
  advisory_evidence: "ADVISORY_EVIDENCE",
  submission_screenshot: "SUBMISSION_SCREENSHOT",
  filed_form: "FILED_FORM",
  proof: "PAYMENT_CONFIRMATION",
  trrc: "TRRC",
  generated_report: "ALPHALIST_REPORT",
  dat_file: "DAT_FILE",
  sent_email: "SENT_EMAIL_EVIDENCE",
  acknowledgement: "ACKNOWLEDGEMENT",
  validation_email: "VALIDATION_EMAIL",
  eafs_confirmation: "EAFS_CONFIRMATION",
};

/**
 * Core of "attach a file to a workflow step's doc slot" (SPEC.md §8),
 * shared by `uploadDocument` (a <form action>, below) and
 * `addCertificate` (lib/actions/form2307.ts, brief #5a — the scan is now
 * part of saving the certificate, not a separate step afterward). Writes
 * the file to disk at the exact §8 path, records SHA-256 (§16 item 17),
 * and warns — never blocks — on a hash duplicate within the same client
 * (§16 item 18). Never auto-completes the step; the bookkeeper still
 * marks it DONE explicitly once satisfied (except step 2, which derives
 * its own status from `recomputeReceive2307Status` below).
 *
 * Brief #5a — "Replace scan": a certificate's own scan is one-for-one,
 * not accumulating. When `form2307Id` is set, any other non-deleted
 * document already attached to that same certificate is soft-deleted
 * right after this upload succeeds, so a bad or unreadable file can be
 * swapped without leaving stale copies on the row.
 */
export async function saveDocumentForStep(params: {
  workflowStepId: string;
  docSlotCode: string;
  file: File;
  documentDate: Date;
  notes?: string | null;
  form2307Id?: string | null;
}): Promise<UploadDocumentResult> {
  const step = await prisma.workflowStep.findUnique({
    where: { id: params.workflowStepId },
    include: { filing: { include: { client: true } } },
  });
  if (!step) return { ok: false, error: "Workflow step not found." };

  const { filing } = step;
  const { client } = filing;

  const buffer = Buffer.from(await params.file.arrayBuffer());
  const sha256 = computeSha256(buffer);

  const duplicate = await prisma.document.findFirst({
    where: { clientId: client.id, sha256, deletedAt: null },
  });
  // formatManilaDate, not toISOString().split("T")[0]: uploadedAt is a real
  // timestamp (not a clean midnight), so a raw UTC slice can show the
  // wrong calendar day for any upload in Manila's 00:00-07:59 window.
  const duplicateWarning = duplicate
    ? `This file's contents match an existing document already on file for this client: "${duplicate.originalFilename}" (uploaded ${formatManilaDate(
        duplicate.uploadedAt,
      )}). Saved anyway — please check you didn't mean to attach a different file.`
    : undefined;

  const ext = params.file.name.includes(".") ? (params.file.name.split(".").pop() as string) : "bin";
  const existingCount = await prisma.document.count({
    where: { filingId: filing.id, docSlotCode: params.docSlotCode, deletedAt: null },
  });

  const relativePath = buildStorageRelativePath({
    clientCode: client.code,
    taxableYear: filing.taxableYear,
    period: filing.period,
    stepCode: step.stepCode,
    slotCode: params.docSlotCode,
    documentDate: params.documentDate,
    seq: existingCount + 1,
    ext,
  });

  await saveDocumentFile(relativePath, buffer);

  const actorId = await getActorId();
  const created = await prisma.document.create({
    data: {
      clientId: client.id,
      filingId: filing.id,
      workflowStepId: step.id,
      docSlotCode: params.docSlotCode,
      form2307Id: params.form2307Id ?? null,
      category: (SLOT_CODE_TO_CATEGORY[params.docSlotCode] ?? "OTHER") as never,
      originalFilename: params.file.name,
      storedPath: relativePath,
      mimeType: params.file.type || "application/octet-stream",
      sizeBytes: buffer.byteLength,
      sha256,
      documentDate: params.documentDate,
      notes: params.notes ?? null,
      actorId,
    },
  });

  await logActivity({ entityType: "Document", entityId: created.id, action: "CREATE", after: created, actorId });

  if (params.form2307Id) {
    const siblings = await prisma.document.findMany({
      where: { form2307Id: params.form2307Id, id: { not: created.id }, deletedAt: null },
    });
    for (const sibling of siblings) {
      const updated = await prisma.document.update({
        where: { id: sibling.id },
        data: { deletedAt: new Date(), deletedReason: "Replaced by a newer scan.", actorId },
      });
      await logActivity({ entityType: "Document", entityId: sibling.id, action: "DELETE", before: sibling, after: updated, actorId });
    }
  }

  if (step.stepCode === "RECEIVE_2307") await recomputeReceive2307Status(filing.id);
  revalidatePath(`/clients/${client.id}/filings/${filing.id}`);

  return { ok: true, documentId: created.id, duplicateWarning };
}

/**
 * Uploads one document against a workflow step's doc slot — the
 * <form action> entry point (e.g. a saved certificate's "Replace scan").
 * See saveDocumentForStep above for what actually happens.
 */
export async function uploadDocument(formData: FormData): Promise<UploadDocumentResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to upload." };
  }

  const workflowStepId = String(formData.get("workflowStepId") ?? "");
  const docSlotCode = String(formData.get("docSlotCode") ?? "");
  const documentDateInput = String(formData.get("documentDate") ?? "");
  const notes = String(formData.get("notes") ?? "") || null;
  // Brief #4b — step 2's per-certificate scan: when present, this
  // document is the scan for one specific Form2307 row, not the step as
  // a whole (there is no step-level 2307-scan slot anymore).
  const form2307Id = String(formData.get("form2307Id") ?? "") || null;

  if (!workflowStepId || !docSlotCode) {
    return { ok: false, error: "Missing step or document slot." };
  }

  const documentDate = documentDateInput ? manilaDateInputToJsDate(documentDateInput) : new Date();

  return saveDocumentForStep({ workflowStepId, docSlotCode, file, documentDate, notes, form2307Id });
}

/** Soft-delete — financial/audit records are never hard-deleted (SPEC.md 14). */
export async function deleteDocument(documentId: string, reason: string): Promise<void> {
  const before = await prisma.document.findUnique({ where: { id: documentId }, include: { workflowStep: true } });
  if (!before) return;

  const actorId = await getActorId();
  const updated = await prisma.document.update({
    where: { id: documentId },
    data: { deletedAt: new Date(), deletedReason: reason || "No reason given", actorId },
  });

  await logActivity({
    entityType: "Document",
    entityId: documentId,
    action: "DELETE",
    before,
    after: updated,
    actorId,
  });

  if (before.filingId) {
    if (before.workflowStep?.stepCode === "RECEIVE_2307") await recomputeReceive2307Status(before.filingId);
    revalidatePath(`/clients/${before.clientId}/filings/${before.filingId}`);
  }
}
