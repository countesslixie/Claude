import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createBackupArchive } from "@/lib/backup/createBackup";
import { recordBackup, getLastBackupAt } from "@/lib/backup/lastBackup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** D172 — Settings' "Back up now": POST streams one zip; the time is recorded when it has fully streamed. */
export async function POST() {
  const now = new Date();
  try {
    const { stream, fileName, finished } = await createBackupArchive({
      client: prisma,
      storageRoot: path.join(process.cwd(), "storage"),
      envPath: path.join(process.cwd(), ".env"),
      now,
    });
    finished.then(() => recordBackup(now)).catch((err) => console.error("Backup failed:", err));
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Backup failed:", err);
    return NextResponse.json({ error: "The backup could not be made." }, { status: 500 });
  }
}

/** The Settings button polls this to refresh the "Last backup" line once the download has finished. */
export async function GET() {
  const last = await getLastBackupAt();
  return NextResponse.json({ lastBackupAt: last ? last.toISOString() : null }, { headers: { "Cache-Control": "no-store" } });
}
