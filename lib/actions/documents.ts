"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import { buildStorageRelativePath, saveDocumentFile } from "@/lib/documents/storage";
import { computeSha256 } from "@/lib/documents/storage";
import { manilaDateInputToJsDate, formatManilaDate, nowManila } from "@/lib/dates";
import { recomputeReceive2307Status, recomputeFileGroupDocStepStatus } from "@/lib/actions/workflowSteps";
import {
  SELF_COMPLETING_DOC_STEP_CODES,
  SELF_COMPLETING_UNLOCK_STEP_CODE,
  EAFS_SELF_COMPLETING_STEP_CODES,
  stepLockReason,
} from "@/lib/workflow/groups";
import { MAX_UPLOAD_BYTES } from "@/lib/upload";

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

  // D64 (brief #5k §1) — a server-side backstop behind the client-side
  // check every upload control now runs first: a file this large should
  // never reach here, but if it does (a direct call, a stale client), fail
  // cleanly rather than let Next's own Server Action body-size limit throw
  // its dev-only error overlay.
  if (params.file.size > MAX_UPLOAD_BYTES) {
    const fileMb = (params.file.size / (1024 * 1024)).toFixed(1);
    const limitMb = Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024));
    return { ok: false, error: `This file is ${fileMb} MB — the limit is ${limitMb} MB.` };
  }

  // D67/D71/D75 — every self-completing doc step (6, 7, 9, 10, 14) unlocks
  // only once its own gating step is Done (FILE_RETURN for 6/7; MAKE_PAYMENT
  // for 9; FILE_RETURN for 10; SAWT_ACK for 14 — see
  // SELF_COMPLETING_UNLOCK_STEP_CODE). Enforced here, in the upload action
  // itself, not just by the UI hiding the upload box, so it can't be
  // bypassed by calling this action directly.
  const unlockStepCode = SELF_COMPLETING_UNLOCK_STEP_CODE[step.stepCode];
  if (unlockStepCode) {
    const unlockStep = await prisma.workflowStep.findFirst({
      where: { filingId: filing.id, stepCode: unlockStepCode },
    });
    if (unlockStep?.status !== "DONE") {
      return { ok: false, error: `Can't attach this document until step ${unlockStep?.sequence ?? "?"} is marked done.` };
    }
  }

  // D85/D93 (brief #5o) — the eAFS group's steps take documents only once File
  // and Pay are Done (and, within it, once the step before is Done), and never
  // on a filing with no Form 2307 (the step is NA). Enforced here, not just by
  // the UI hiding the boxes.
  if (EAFS_SELF_COMPLETING_STEP_CODES.includes(step.stepCode)) {
    if (step.status === "NA") return { ok: false, error: "This step doesn't apply — there's no Form 2307 on this filing." };
    const allSteps = await prisma.workflowStep.findMany({ where: { filingId: filing.id } });
    const lock = stepLockReason(step.stepCode, allSteps);
    if (lock) return { ok: false, error: `Can't attach this document yet. ${lock}` };
  }

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

  // D67/D71/D75 — every self-completing doc step's own document is
  // one-for-one, the same "Replace" pattern D46 gave step 2's certificate
  // scan: a new upload against this step+slot soft-deletes whatever was
  // there before rather than accumulating alongside it.
  if (SELF_COMPLETING_DOC_STEP_CODES.includes(step.stepCode)) {
    const siblings = await prisma.document.findMany({
      where: { workflowStepId: step.id, docSlotCode: params.docSlotCode, id: { not: created.id }, deletedAt: null },
    });
    for (const sibling of siblings) {
      const updated = await prisma.document.update({
        where: { id: sibling.id },
        data: { deletedAt: new Date(), deletedReason: "Replaced by a newer file.", actorId },
      });
      await logActivity({ entityType: "Document", entityId: sibling.id, action: "DELETE", before: sibling, after: updated, actorId });
    }
  }

  if (step.stepCode === "RECEIVE_2307") await recomputeReceive2307Status(filing.id);
  if (SELF_COMPLETING_DOC_STEP_CODES.includes(step.stepCode)) await recomputeFileGroupDocStepStatus(step.id);
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

  // D119 — the upload boxes carry no date field: the document is dated the day it is uploaded (Manila). A date may still be passed in (the seed back-dates its sample documents).
  const documentDate = documentDateInput ? manilaDateInputToJsDate(documentDateInput) : nowManila().startOf("day").toJSDate();

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
    // D67/D71/D75 — removing the only file behind a self-completing doc
    // step reverts it (to PENDING for 6/7/9, or back to WAITING_EXTERNAL
    // for 10/14 — see recomputeFileGroupDocStepStatus); no UI calls this
    // for these steps yet (their generic doc slots only support
    // Add/Replace today, no Remove — confirmed by grep), but the rule is
    // enforced here so it holds regardless of what eventually calls it.
    if (before.workflowStep && SELF_COMPLETING_DOC_STEP_CODES.includes(before.workflowStep.stepCode)) {
      await recomputeFileGroupDocStepStatus(before.workflowStep.id);
    }
    revalidatePath(`/clients/${before.clientId}/filings/${before.filingId}`);
  }
}
