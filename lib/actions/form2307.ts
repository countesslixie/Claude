"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { certificateEntrySchema } from "@/lib/validation/form2307";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import { manilaDateInputToJsDate } from "@/lib/dates";
import { pesosToCents } from "@/lib/money";
import { periodToSingleQuarterCovered } from "@/lib/tax/periods";
import { recomputeRequiresSawt } from "@/lib/workflow/filingGeneration";
import { recomputeReceive2307Status } from "@/lib/actions/workflowSteps";

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
  "withholdingRateBps",
  "dateReceived",
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

/** Last day of the quarter matching quarterNumber (1-4) in taxableYear, via the day-0 trick. */
function quarterNumberDateRange(taxableYear: number, quarterNumber: number): { from: Date; to: Date } {
  const startMonth = (quarterNumber - 1) * 3;
  const from = new Date(Date.UTC(taxableYear, startMonth, 1));
  const to = new Date(Date.UTC(taxableYear, startMonth + 3, 0));
  return { from, to };
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
 * Brief #4b (D34) — adds one certificate row under this filing's step 2.
 * claimedOnFilingId is set here, once, to this filing's id: this is what
 * decides the certificate's credit period from now on (supersedes D10's
 * dateReceived-vs-cutoff rule), never reassigned afterward. Locked once
 * this filing's own return is filed (step 5, FILE_RETURN, DONE) — D11
 * (no amended returns) is what makes that safe.
 */
export async function addCertificate(
  filingId: string,
  _prevState: CertificateFormState,
  formData: FormData,
): Promise<CertificateFormState> {
  const values = rawFromFormData(formData);
  const parsed = certificateEntrySchema.safeParse(values);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  }

  const filing = await prisma.filing.findUnique({ where: { id: filingId }, include: { client: true } });
  if (!filing) return { error: "Filing not found." };

  const lockedReason = await assertFilingNotLocked(filingId);
  if (lockedReason) return { error: lockedReason, values };

  const quarterCovered = periodToSingleQuarterCovered(filing.period);
  const defaultRange = quarterNumberDateRange(filing.taxableYear, quarterCovered);
  const withholdingRateBps = parsed.data.withholdingRateBps ?? filing.client.defaultWithholdingRateBps ?? 0;

  const actorId = await getActorId();
  const cert = await prisma.form2307.create({
    data: {
      clientId: filing.clientId,
      taxableYear: filing.taxableYear,
      payorName: parsed.data.payorName,
      payorTin: parsed.data.payorTin ?? null,
      payorAddress: parsed.data.payorAddress ?? null,
      periodFrom: parsed.data.periodFrom ? manilaDateInputToJsDate(parsed.data.periodFrom) : defaultRange.from,
      periodTo: parsed.data.periodTo ? manilaDateInputToJsDate(parsed.data.periodTo) : defaultRange.to,
      quarterCovered,
      // D19 — never invent an ATC code; left empty and unverified when she hasn't supplied one.
      atcCode: parsed.data.atcCode ?? "",
      incomePaymentCents: pesosToCents(parsed.data.incomePayment),
      taxWithheldCents: pesosToCents(parsed.data.taxWithheld),
      withholdingRateBps,
      dateReceived: manilaDateInputToJsDate(parsed.data.dateReceived),
      status: "RECORDED",
      claimedOnFilingId: filing.id,
      notes: parsed.data.notes ?? null,
      actorId,
    },
  });

  await logActivity({ entityType: "Form2307", entityId: cert.id, action: "CREATE", after: cert, actorId });

  await recomputeRequiresSawt(filing.clientId, filing.taxableYear, filing.period);
  await recomputeReceive2307Status(filing.id);
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

  const lockedReason = await assertFilingNotLocked(cert.claimedOnFilingId);
  if (lockedReason) return { ok: false, error: lockedReason };

  const actorId = await getActorId();
  const updated = await prisma.form2307.update({
    where: { id: certificateId },
    data: { deletedAt: new Date(), deletedReason: reason || "Removed before filing.", actorId },
  });

  await logActivity({ entityType: "Form2307", entityId: certificateId, action: "DELETE", before: cert, after: updated, actorId });

  const filing = await prisma.filing.findUnique({ where: { id: cert.claimedOnFilingId } });
  if (filing) {
    await recomputeRequiresSawt(filing.clientId, filing.taxableYear, filing.period);
    await recomputeReceive2307Status(filing.id);
    revalidatePath(`/clients/${filing.clientId}/filings/${filing.id}`);
  }

  return { ok: true };
}
