import { prisma } from "@/lib/prisma";
import type { Form2307StatusValue } from "@/lib/workflow/status";
import { safeFileNamePart } from "@/lib/documents/filingPackage";

/**
 * D160 — the Form 2307 register's rows and its "Download all" zip plan.
 * Pure helpers (sorting, labels, zip names) plus one loader.
 */
const PERIOD_ORDER: Record<string, number> = { Q1: 1, Q2: 2, Q3: 3, ANNUAL: 4 };

/** "Q3 2026" / "Annual 2026" — plain text, never a link. */
export function registerPeriodLabel(period: string | null | undefined, taxableYear: number): string {
  if (!period) return "—";
  return `${period === "ANNUAL" ? "Annual" : period} ${taxableYear}`;
}

/** Chronological: by the period the certificate was entered under (Q1 → Q2 → Q3 → Annual), then the day it was entered. A certificate under no filing sorts last. */
export function compareRegisterRows(
  a: { period: string | null; enteredAt: Date },
  b: { period: string | null; enteredAt: Date },
): number {
  const pa = a.period ? (PERIOD_ORDER[a.period] ?? 9) : 99;
  const pb = b.period ? (PERIOD_ORDER[b.period] ?? 9) : 99;
  return pa - pb || a.enteredAt.getTime() - b.enteredAt.getTime();
}

export interface RegisterRow {
  id: string;
  period: string | null;
  periodLabel: string;
  payorName: string;
  atcCode: string;
  incomePaymentCents: number;
  taxWithheldCents: number;
  withholdingRateBps: number;
  status: Form2307StatusValue;
  enteredAt: Date;
  /** The certificate's CURRENT scan — never a soft-deleted, replaced one. */
  scan: { id: string; originalFilename: string; storedPath: string } | null;
}

export async function loadRegisterRows(clientId: string, taxableYear: number): Promise<RegisterRow[]> {
  const certificates = await prisma.form2307.findMany({
    where: { clientId, taxableYear, deletedAt: null },
    include: {
      claimedOnFiling: { select: { period: true } },
      documents: { where: { deletedAt: null }, orderBy: { uploadedAt: "desc" }, take: 1 },
    },
  });
  return certificates
    .map((c) => ({
      id: c.id,
      period: c.claimedOnFiling?.period ?? null,
      periodLabel: registerPeriodLabel(c.claimedOnFiling?.period, taxableYear),
      payorName: c.payorName,
      atcCode: c.atcCode,
      incomePaymentCents: c.incomePaymentCents,
      taxWithheldCents: c.taxWithheldCents,
      withholdingRateBps: c.withholdingRateBps,
      status: c.status as Form2307StatusValue,
      enteredAt: c.createdAt,
      scan: c.documents[0] ? { id: c.documents[0].id, originalFilename: c.documents[0].originalFilename, storedPath: c.documents[0].storedPath } : null,
    }))
    .sort(compareRegisterRows);
}

/** "Gloria Tolentino - Form 2307s 2026.zip" */
export function register2307ZipName(registeredName: string, taxableYear: number): string {
  return `${safeFileNamePart(registeredName) || "Client"} - Form 2307s ${taxableYear}.zip`;
}

/** Flat zip entry names: each scan's saved file name, " (2)", " (3)"… before the extension on a collision (as the package zip does, D103). */
export function planRegisterZip<T extends { originalFilename: string }>(scans: T[]): (T & { zipName: string })[] {
  const taken = new Set<string>();
  return scans.map((scan) => {
    const base = safeFileNamePart(scan.originalFilename) || "Form 2307";
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : "";
    let zipName = `${stem}${ext}`;
    for (let n = 2; taken.has(zipName.toLowerCase()); n++) zipName = `${stem} (${n})${ext}`;
    taken.add(zipName.toLowerCase());
    return { ...scan, zipName };
  });
}
