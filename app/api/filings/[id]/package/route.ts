import { NextResponse } from "next/server";
import JSZip from "jszip";
import { prisma } from "@/lib/prisma";
import { readDocumentFile } from "@/lib/documents/storage";
import { loadPackageDocuments, packageZipName } from "@/lib/documents/filingPackage";

/**
 * "Download package" (D103, brief #5r, superseding D22's manifest and the
 * old step-code folders): a flat zip of every document saved on the
 * filing — no folders, no manifest. The list comes from
 * lib/documents/filingPackage.ts, the same source step 16's email uses for
 * its "attached" list. The app's own document records remain the audit
 * trail.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const filing = await prisma.filing.findUnique({ where: { id }, include: { client: true } });
  if (!filing) return NextResponse.json({ error: "Filing not found." }, { status: 404 });

  const zip = new JSZip();
  for (const doc of await loadPackageDocuments(filing.id)) {
    zip.file(doc.zipName, await readDocumentFile(doc.storedPath));
  }

  const content = await zip.generateAsync({ type: "nodebuffer" });
  const filename = packageZipName({
    registeredName: filing.client.registeredName,
    formType: filing.formType,
    period: filing.period,
    taxableYear: filing.taxableYear,
  });
  // ASCII fallback plus the RFC 5987 form, so names with accents still download correctly.
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");

  return new NextResponse(new Uint8Array(content), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": String(content.byteLength),
    },
  });
}
