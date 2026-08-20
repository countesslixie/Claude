import { NextResponse } from "next/server";
import JSZip from "jszip";
import { prisma } from "@/lib/prisma";
import { readDocumentFile } from "@/lib/documents/storage";
import { parseDocSlots } from "@/lib/workflow/types";
import { formatManilaDate } from "@/lib/dates";

/**
 * "Download period package" (SPEC.md §8, §16 item 19): a zip of every
 * document for a filing, in step order, plus a manifest listing every
 * document, its slot, and its date — and any required slots still empty.
 *
 * The manifest is plain text, not the PDF SPEC.md §8 describes — this
 * project has no PDF-generation dependency, and the manifest's actual
 * acceptance criterion (§16 item 19) is "lists every document plus a
 * manifest listing empty slots," which a text file satisfies. A PDF
 * manifest is a reasonable Phase 4 follow-up, not added here.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const filing = await prisma.filing.findUnique({
    where: { id },
    include: {
      client: true,
      documents: { where: { deletedAt: null }, orderBy: { uploadedAt: "asc" } },
      workflowSteps: { orderBy: { sequence: "asc" } },
    },
  });
  if (!filing) return NextResponse.json({ error: "Filing not found." }, { status: 404 });

  const zip = new JSZip();
  type StepRow = (typeof filing.workflowSteps)[number];
  type DocRow = (typeof filing.documents)[number];
  const documentsBySequence: Array<{ step: StepRow | null; doc: DocRow }> = [];
  for (const step of filing.workflowSteps) {
    for (const doc of filing.documents) {
      if (doc.workflowStepId === step.id) documentsBySequence.push({ step, doc });
    }
  }
  for (const doc of filing.documents) {
    if (!doc.workflowStepId) documentsBySequence.push({ step: null, doc }); // not tied to a step
  }

  const manifestLines: string[] = [
    `Filing package — ${filing.client.registeredName} — TY${filing.taxableYear} ${filing.period} (${filing.formType})`,
    `Generated ${formatManilaDate(new Date())}`,
    "",
    "Documents:",
  ];

  for (const { step, doc } of documentsBySequence) {
    const buffer = await readDocumentFile(doc.storedPath);
    const stepLabel = step ? `${String(step.sequence).padStart(2, "0")}_${step.stepCode}` : "unfiled";
    zip.file(`${stepLabel}/${doc.id}__${doc.originalFilename}`, buffer);
    manifestLines.push(
      `  [x] ${step ? step.stepCode : "(no step)"} / ${doc.docSlotCode ?? "(unassigned)"} — ${
        doc.originalFilename
      } (${formatManilaDate(doc.documentDate)})`,
    );
  }

  manifestLines.push("", "Empty required slots:");
  const filledSlotCodesByStep = new Map<string, Set<string>>();
  for (const doc of filing.documents) {
    if (!doc.workflowStepId || !doc.docSlotCode) continue;
    const set = filledSlotCodesByStep.get(doc.workflowStepId) ?? new Set<string>();
    set.add(doc.docSlotCode);
    filledSlotCodesByStep.set(doc.workflowStepId, set);
  }

  let anyEmpty = false;
  for (const step of filing.workflowSteps) {
    if (step.status === "NA" || step.status === "SKIPPED") continue;
    const slots = parseDocSlots(step.requiredDocSlots);
    const filled = filledSlotCodesByStep.get(step.id) ?? new Set<string>();
    for (const slot of slots) {
      if (slot.required && !filled.has(slot.slotCode)) {
        manifestLines.push(`  [ ] ${step.stepCode} / ${slot.slotCode} — ${slot.label}`);
        anyEmpty = true;
      }
    }
  }
  if (!anyEmpty) manifestLines.push("  (none)");

  zip.file("manifest.txt", manifestLines.join("\n"));

  const content = await zip.generateAsync({ type: "nodebuffer" });
  const filename = `${filing.client.code}-${filing.taxableYear}-${filing.period}-package.zip`;

  return new NextResponse(new Uint8Array(content), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(content.byteLength),
    },
  });
}
