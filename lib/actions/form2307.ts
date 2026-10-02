"use server";

import { FILING_LOCKED_MESSAGE, filingLockedReason, isFilingComplete } from "@/lib/workflow/filingLock";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { certificateEntrySchema } from "@/lib/validation/form2307";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import { manilaDateInputToJsDate, nowManila } from "@/lib/dates";
import { pesosToCents } from "@/lib/money";
import { periodToSingleQuarterCovered } from "@/lib/tax/periods";
import { recomputeRequiresSawt } from "@/lib/workflow/filingGeneration";
import { recomputeReceive2307Status, reopenPreparedFiling } from "@/lib/actions/workflowSteps";
import { setAllCertificatesReceived } from "@/lib/actions/filings";
import { checkAndRecordAmendments } from "@/lib/filingComputation";
import { saveDocumentForStep } from "@/lib/actions/documents";

export type CertificateFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: Record<string, string>;
  saved?: boolean;
};

const FIELDS = [
  "payorName",
  "payorTin",
  "payorAddress",
  "periodFrom",
  "periodTo",
  "atcCode",
  "incomePayment",
  "taxWithheld",
  "notes",
] as const;

function rawFromFormData(formData: FormData) {
  const values: Record<string, string> = {};
  for (const key of FIELDS) {
    const v = formData.get(key);
    values[key] = typeof v === "string" ? v : "";
  }
  return values;
}

async function assertFilingNotLocked(filingId: string): Promise<string | null> {
  const fileReturnStep = await prisma.workflowStep.findFirst({
    where: { filingId, stepCode: "FILE_RETURN" },
  });
  if (fileReturnStep?.status === "DONE") {
    return "This filing has already been filed — step 2's list is locked. A certificate that arrives now belongs on the next open filing instead.";
  }
  return null;
}

/**
 * Brief #5a — while "All certificates received" is ticked, the set is
 * closed: no certificate can be added or removed until she unticks it.
 * The UI hides Add/Remove for the same reason (components/receive-2307-
 * step-card.tsx); this is the server-side half, so the rule holds even if
 * the action is ever called directly.
 */
function assertCertificatesNotAllReceived(filing: { certificatesAllReceivedAt: Date | null }): string | null {
  if (filing.certificatesAllReceivedAt != null) {
    return "\"All certificates received\" is ticked — untick it before adding or removing a certificate.";
  }
  return null;
}

/**
 * Brief #4b (D34) — adds one certificate row under this filing's step 2.
 * claimedOnFilingId is set here, once, to this filing's id: this is what
 * decides the certificate's credit period from now on (supersedes D10's
 * dateReceived-vs-cutoff rule), never reassigned afterward. Locked once
 * this filing's own return is filed (step 5, FILE_RETURN, DONE) — D11
 * (no amended returns) is what makes that safe.
 *
 * Brief #5a — the scan is now part of saving the certificate: a
 * certificate cannot be created without one (D35 is now satisfied by
 * construction, not earned afterward). The ATC code is chosen from the
 * active-codes picker; its own rate fills withholdingRateBps unless she
 * typed a different one, in which case her value is kept and
 * rateOverridden records the disagreement — the certificate is
 * authoritative over the code, not the other way around.
 */
export async function addCertificate(
  filingId: string,
  _prevState: CertificateFormState,
  formData: FormData,
): Promise<CertificateFormState> {
  const values = rawFromFormData(formData);
  const parsed = certificateEntrySchema.safeParse(values);

  const file = formData.get("file");
  const hasFile = file instanceof File && file.size > 0;
  if (!hasFile) {
    const fieldErrors = parsed.success ? {} : parsed.error.flatten().fieldErrors;
    return { fieldErrors: { ...fieldErrors, file: ["A scan is required to save this certificate."] }, values };
  }
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  }

  const filing = await prisma.filing.findUnique({ where: { id: filingId }, include: { client: true } });
  if (!filing) return { error: "Filing not found." };

  // D153 — a Complete filing takes no new certificate.
  if (isFilingComplete(filing)) return { error: FILING_LOCKED_MESSAGE, values };

  const lockedReason = await assertFilingNotLocked(filingId);
  if (lockedReason) return { error: lockedReason, values };

  const allReceivedReason = assertCertificatesNotAllReceived(filing);
  if (allReceivedReason) return { error: allReceivedReason, values };

  const atcCode = await prisma.atcCode.findUnique({ where: { code: parsed.data.atcCode } });
  if (!atcCode) {
    return { fieldErrors: { atcCode: ["Unknown ATC code — refresh the page and choose again."] }, values };
  }

  const quarterCovered = periodToSingleQuarterCovered(filing.period);
  // D132 — no Rate field: the certificate's rate is the chosen ATC code's.
  const withholdingRateBps = atcCode.rateBps;
  const rateOverridden = false;

  const documentDateRaw = String(formData.get("documentDate") ?? "");
  const documentDate = documentDateRaw ? manilaDateInputToJsDate(documentDateRaw) : nowManila().startOf("day").toJSDate(); // D122 — the form has no scan date; the upload day (Manila). The seed may still pass one.

  const actorId = await getActorId();
  const cert = await prisma.form2307.create({
    data: {
      clientId: filing.clientId,
      taxableYear: filing.taxableYear,
      payorName: parsed.data.payorName,
      payorTin: parsed.data.payorTin,
      payorAddress: parsed.data.payorAddress,
      periodFrom: manilaDateInputToJsDate(parsed.data.periodFrom),
      periodTo: manilaDateInputToJsDate(parsed.data.periodTo),
      quarterCovered,
      atcCode: atcCode.code,
      incomePaymentCents: pesosToCents(parsed.data.incomePayment),
      taxWithheldCents: pesosToCents(parsed.data.taxWithheld),
      withholdingRateBps,
      rateOverridden,
      status: "RECORDED",
      claimedOnFilingId: filing.id,
      notes: parsed.data.notes ?? null,
      actorId,
    },
  });

  await logActivity({ entityType: "Form2307", entityId: cert.id, action: "CREATE", after: cert, actorId });

  const receive2307Step = await prisma.workflowStep.findFirstOrThrow({
    where: { filingId: filing.id, stepCode: "RECEIVE_2307" },
  });
  const scanResult = await saveDocumentForStep({
    workflowStepId: receive2307Step.id,
    docSlotCode: "form2307_scan",
    file,
    documentDate,
    form2307Id: cert.id,
  });
  if (!scanResult.ok) {
    // The certificate is required to have a scan by construction (brief
    // #5a) — a failed scan save (e.g. a disk write error) must not leave
    // an orphaned certificate with none. This was never actually
    // persisted "for real" from her point of view, so a hard delete here
    // (not the usual soft delete) is correct.
    await prisma.form2307.delete({ where: { id: cert.id } });
    return { error: scanResult.error ?? "Could not save the scan.", values };
  }

  // saveDocumentForStep above already recomputed step 2's status (it
  // always does, for a RECEIVE_2307 step) — no need to do it again here.
  await recomputeRequiresSawt(filing.clientId, filing.taxableYear, filing.period);
  // Brief #5d §6 — adding a certificate reopens steps 3/4 if step 3 was
  // already Done.
  await reopenPreparedFiling(filing.id);
  await checkAndRecordAmendments(filing.clientId, filing.taxableYear, null, `A certificate was added on ${filing.period} ${filing.taxableYear}.`);
  revalidatePath(`/clients/${filing.clientId}/filings/${filing.id}`);

  return { saved: true };
}

/**
 * Removes a certificate row entered in error, before this filing is
 * filed — soft-delete (D14/SPEC.md, no hard deletes on financial
 * records), same as Document's own delete.
 */
export async function deleteCertificate(certificateId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const cert = await prisma.form2307.findUnique({ where: { id: certificateId } });
  if (!cert) return { ok: false, error: "Certificate not found." };
  if (!cert.claimedOnFilingId) return { ok: false, error: "Certificate isn't attached to a filing." };

  // D153 — a Complete filing keeps every certificate it has.
  const completeReason = await filingLockedReason(cert.claimedOnFilingId);
  if (completeReason) return { ok: false, error: completeReason };

  const lockedReason = await assertFilingNotLocked(cert.claimedOnFilingId);
  if (lockedReason) return { ok: false, error: lockedReason };

  const filingForCheck = await prisma.filing.findUnique({ where: { id: cert.claimedOnFilingId } });
  if (!filingForCheck) return { ok: false, error: "Filing not found." };
  const allReceivedReason = assertCertificatesNotAllReceived(filingForCheck);
  if (allReceivedReason) return { ok: false, error: allReceivedReason };

  const actorId = await getActorId();
  const updated = await prisma.form2307.update({
    where: { id: certificateId },
    data: { deletedAt: new Date(), deletedReason: reason || "Removed before filing.", actorId },
  });

  await logActivity({ entityType: "Form2307", entityId: certificateId, action: "DELETE", before: cert, after: updated, actorId });

  const filing = await prisma.filing.findUnique({ where: { id: cert.claimedOnFilingId } });
  if (filing) {
    await recomputeRequiresSawt(filing.clientId, filing.taxableYear, filing.period);

    // Brief #4d — removing the last row on this filing goes back to the
    // "no certificates yet" state (Add certificate / Skip, no checkbox);
    // untick "all received" if it was ticked, since there's nothing left
    // for it to describe.
    const remaining = await prisma.form2307.count({ where: { claimedOnFilingId: filing.id, deletedAt: null } });
    if (remaining === 0 && filing.certificatesAllReceivedAt != null) {
      await setAllCertificatesReceived(filing.id, false);
    } else {
      await recomputeReceive2307Status(filing.id);
    }
    // Brief #5d §6 — removing a certificate reopens steps 3/4 if step 3
    // was already Done.
    await reopenPreparedFiling(filing.id);
    await checkAndRecordAmendments(filing.clientId, filing.taxableYear, null, `A certificate was removed from ${filing.period} ${filing.taxableYear}.`);
    revalidatePath(`/clients/${filing.clientId}/filings/${filing.id}`);
  }

  return { ok: true };
}
