import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readDocumentFile } from "@/lib/documents/storage";

/**
 * Restores the original filename on download (SPEC.md §8) — auth is
 * already enforced globally by middleware.ts, which protects every route
 * except /login and static assets.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc || doc.deletedAt) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const buffer = await readDocumentFile(doc.storedPath);
  const encodedName = encodeURIComponent(doc.originalFilename);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": doc.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`,
      "Content-Length": String(buffer.byteLength),
    },
  });
}
