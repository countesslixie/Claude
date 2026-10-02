import { NextResponse } from "next/server";
import JSZip from "jszip";
import { prisma } from "@/lib/prisma";
import { readDocumentFile } from "@/lib/documents/storage";
import { currentTaxableYearManila } from "@/lib/dates";
import { loadRegisterRows, planRegisterZip, register2307ZipName } from "@/lib/form2307Register";

/**
 * D160 — "Download all" on the Form 2307 register: every CURRENT scan (never
 * a replaced, soft-deleted one) for the year shown, as one flat zip.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  const yearParam = new URL(request.url).searchParams.get("year");
  const taxableYear = yearParam && Number.isInteger(Number(yearParam)) ? Number(yearParam) : currentTaxableYearManila();

  const scans = (await loadRegisterRows(id, taxableYear)).flatMap((r) => (r.scan ? [r.scan] : []));
  if (scans.length === 0) return NextResponse.json({ error: "No scans for this year." }, { status: 404 });

  const zip = new JSZip();
  for (const scan of planRegisterZip(scans)) zip.file(scan.zipName, await readDocumentFile(scan.storedPath));
  const content = await zip.generateAsync({ type: "nodebuffer" });

  const filename = register2307ZipName(client.registeredName, taxableYear);
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new NextResponse(new Uint8Array(content), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": String(content.byteLength),
    },
  });
}
