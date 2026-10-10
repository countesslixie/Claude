import { prisma } from "@/lib/prisma";
import { parseDocSlots } from "@/lib/workflow/types";
import { formLabel } from "@/lib/workflow/eSubmissionEmail";

/**
 * D103 (brief #5r) — the ONE list of documents in a filing's client
 * package. The zip route builds the zip from it and step 16's email prints
 * its "attached" list from it, so the two cannot disagree. The zip is flat
 * (no step folders) and carries no manifest. D111 (brief #5t): each file
 * inside the zip gets a standard name, "[Client] - [Form] [Period] [Year] -
 * [Document].[ext]" (a " (2)" suffix if two would collide); only the zip
 * copy is renamed, stored documents keep their names. D110: the email's
 * list shows document names only, never file names.
 */
export interface PackageDocument {
  docId: string;
  storedPath: string;
  /** The file's standard name inside the zip (D111), made unique. */
  zipName: string;
  /** Plain document name for the email, e.g. "Proof of payment" or "Form 2307 (Acme Corp)". */
  label: string;
  /** D194 — false for the filed return's page 2: the email names "Filed return" once, for both pages. */
  inEmailList: boolean;
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
  filed_form_page2: "Filed return", // D194 — listed once; see PackageDocument.inEmailList
  proof: "Proof of payment",
  trrc: "BIR confirmation (TRRC)",
  acknowledgement: "SAWT acknowledgement email",
};

/** Short document names for the file names inside the zip (D111). */
const FILE_LABEL_BY_SLOT: Record<string, string> = {
  filed_form: "Filed return",
  filed_form_page2: "Filed return page 2",
  proof: "Proof of payment",
  trrc: "TRRC",
  acknowledgement: "SAWT acknowledgement",
};

/** What every zip entry name starts with: "Rosario Garcia - 1701Q Q3 2026". */
export interface PackageNaming {
  registeredName: string;
  formType: string;
  period: string;
  taxableYear: number;
}

/** Drops characters Windows won't allow in a file name (and control characters), tidies spaces and trailing dots. */
export function safeFileNamePart(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot) : "";
  return /^\.[A-Za-z0-9]{1,8}$/.test(ext) ? ext.toLowerCase() : "";
}

/** "Rosario Garcia - 1701Q Q3 2026" / "… - 1701A Annual 2026". */
export function packageFilePrefix(naming: PackageNaming): string {
  const period = naming.period === "ANNUAL" ? "Annual" : naming.period;
  return `${safeFileNamePart(naming.registeredName) || "Client"} - ${formLabel(naming.formType)} ${period} ${naming.taxableYear}`;
}

/**
 * D108 (brief #5s, her decision) — the client's package holds only: the filed
 * return (step 7, both pages — D193/D194), proof of payment (9), the TRRC (10), the SAWT
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

/** Pure: documents in step order (then upload order), labelled, with unique flat zip names. */
export function planPackageDocuments(steps: PackageStepInput[], documents: PackageDocInput[], naming: PackageNaming): PackageDocument[] {
  const prefix = packageFilePrefix(naming);
  const ordered: { step: PackageStepInput | null; doc: PackageDocInput }[] = [];
  for (const step of [...steps].sort((a, b) => a.sequence - b.sequence)) {
    if (!CLIENT_PACKAGE_STEP_CODES.includes(step.stepCode)) continue;
    for (const doc of documents) if (doc.workflowStepId === step.id) ordered.push({ step, doc });
  }

  // D194 — a filing whose step 7 holds a page 2 sends both pages, named "page 1" / "page 2";
  // an older filing with the one old file keeps "Filed return".
  const hasPage2 = ordered.some(({ doc }) => doc.docSlotCode === "filed_form_page2");

  const taken = new Set<string>();
  return ordered.map(({ step, doc }) => {
    const slot = step && doc.docSlotCode ? parseDocSlots(step.requiredDocSlots).find((s) => s.slotCode === doc.docSlotCode) : undefined;
    const slotCode = doc.docSlotCode ?? "";
    const label = doc.form2307PayorName
      ? `Form 2307 (${doc.form2307PayorName})`
      : (CLIENT_LABEL_BY_SLOT[slotCode] ?? slot?.label ?? step?.title ?? "Other document");
    let fileLabel = doc.form2307PayorName
      ? `Form 2307 - ${safeFileNamePart(doc.form2307PayorName) || "Payor"}`
      : safeFileNamePart(FILE_LABEL_BY_SLOT[slotCode] ?? slot?.label ?? step?.title ?? "Other document");
    if (hasPage2 && slotCode === "filed_form") fileLabel = "Filed return page 1";

    const ext = extensionOf(doc.originalFilename);
    const stem = `${prefix} - ${fileLabel}`;
    let zipName = `${stem}${ext}`;
    for (let n = 2; taken.has(zipName.toLowerCase()); n++) zipName = `${stem} (${n})${ext}`;
    taken.add(zipName.toLowerCase());
    return { docId: doc.id, storedPath: doc.storedPath, zipName, label, inEmailList: slotCode !== "filed_form_page2" };
  });
}

export async function loadPackageDocuments(filingId: string): Promise<PackageDocument[]> {
  const filing = await prisma.filing.findUnique({
    where: { id: filingId },
    include: {
      client: { select: { registeredName: true } },
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
    { registeredName: filing.client.registeredName, formType: filing.formType, period: filing.period, taxableYear: filing.taxableYear },
  );
}

/** "Rosario Garcia - 1701Q Q3 2026.zip" — plain, no client code. Characters a file name can't hold are dropped. */
export function packageZipName(input: PackageNaming): string {
  return `${packageFilePrefix(input)}.zip`;
}
