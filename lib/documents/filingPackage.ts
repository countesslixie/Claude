import { prisma } from "@/lib/prisma";
import { parseDocSlots } from "@/lib/workflow/types";
import { formLabel } from "@/lib/workflow/eSubmissionEmail";

/**
 * D103 (brief #5r) — the ONE list of documents in a filing's client
 * package. The zip route builds the zip from it and step 16's email prints
 * its "attached" list from it, so the two cannot disagree. The zip is flat
 * (no step folders) and carries no manifest; each file keeps its saved
 * name, with a short " (2)" suffix if two names collide.
 */
export interface PackageDocument {
  docId: string;
  storedPath: string;
  /** The file's name inside the zip (its saved name, made unique). */
  zipName: string;
  /** Plain description for the email, e.g. "Proof of payment" or "Form 2307 — Acme Corp". */
  label: string;
}

export interface PackageStepInput {
  id: string;
  stepCode: string;
  sequence: number;
  title: string;
  requiredDocSlots: unknown;
}

export interface PackageDocInput {
  id: string;
  workflowStepId: string | null;
  docSlotCode: string | null;
  originalFilename: string;
  storedPath: string;
  form2307PayorName?: string | null;
}

/** Plain, client-facing names for the slots a package can hold — the slot's own label is written for the form field, not for the client. */
const CLIENT_LABEL_BY_SLOT: Record<string, string> = {
  filed_form: "Filed return",
  proof: "Proof of payment",
  trrc: "BIR confirmation (TRRC)",
  acknowledgement: "SAWT acknowledgement email",
};

/**
 * D108 (brief #5s, her decision) — the client's package holds only: the filed
 * return (step 7), proof of payment (9), the TRRC (10), the SAWT
 * acknowledgement email (13) and the Form 2307 scans (2). Everything else —
 * submission screenshot (6), computation sheet (3), alphalist report and DAT
 * (11), SAWT validation email (14) — stays out. A step that doesn't apply
 * simply has no document, so it is absent, with no placeholder.
 */
export const CLIENT_PACKAGE_STEP_CODES: readonly string[] = [
  "RECEIVE_2307",
  "SAVE_FORM_COPY",
  "SAVE_PROOF_PAYMENT",
  "RECEIVE_TRRC",
  "SAWT_ACK",
];

function withSuffix(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
}

/** Pure: documents in step order (then upload order), labelled, with unique flat zip names. */
export function planPackageDocuments(steps: PackageStepInput[], documents: PackageDocInput[]): PackageDocument[] {
  const ordered: { step: PackageStepInput | null; doc: PackageDocInput }[] = [];
  for (const step of [...steps].sort((a, b) => a.sequence - b.sequence)) {
    if (!CLIENT_PACKAGE_STEP_CODES.includes(step.stepCode)) continue;
    for (const doc of documents) if (doc.workflowStepId === step.id) ordered.push({ step, doc });
  }

  const taken = new Set<string>();
  return ordered.map(({ step, doc }) => {
    let zipName = doc.originalFilename;
    for (let n = 2; taken.has(zipName.toLowerCase()); n++) zipName = withSuffix(doc.originalFilename, n);
    taken.add(zipName.toLowerCase());

    const slot = step && doc.docSlotCode ? parseDocSlots(step.requiredDocSlots).find((s) => s.slotCode === doc.docSlotCode) : undefined;
    const label = doc.form2307PayorName
      ? `Form 2307 — ${doc.form2307PayorName}`
      : ((doc.docSlotCode && CLIENT_LABEL_BY_SLOT[doc.docSlotCode]) ?? slot?.label ?? step?.title ?? "Other document");
    return { docId: doc.id, storedPath: doc.storedPath, zipName, label };
  });
}

export async function loadPackageDocuments(filingId: string): Promise<PackageDocument[]> {
  const filing = await prisma.filing.findUnique({
    where: { id: filingId },
    include: {
      documents: { where: { deletedAt: null }, orderBy: { uploadedAt: "asc" }, include: { form2307: { select: { payorName: true } } } },
      workflowSteps: { orderBy: { sequence: "asc" } },
    },
  });
  if (!filing) return [];
  return planPackageDocuments(
    filing.workflowSteps.map((s) => ({ id: s.id, stepCode: s.stepCode, sequence: s.sequence, title: s.title, requiredDocSlots: s.requiredDocSlots })),
    filing.documents.map((d) => ({
      id: d.id,
      workflowStepId: d.workflowStepId,
      docSlotCode: d.docSlotCode,
      originalFilename: d.originalFilename,
      storedPath: d.storedPath,
      form2307PayorName: d.form2307?.payorName ?? null,
    })),
  );
}

/** "Rosario Garcia - 1701Q Q3 2026.zip" — plain, no client code. Characters a file name can't hold are dropped. */
export function packageZipName(input: { registeredName: string; formType: string; period: string; taxableYear: number }): string {
  const safeName = input.registeredName.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim() || "Client";
  const period = input.period === "ANNUAL" ? "Annual" : input.period;
  return `${safeName} - ${formLabel(input.formType)} ${period} ${input.taxableYear}.zip`;
}
