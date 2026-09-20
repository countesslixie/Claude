import { centsToPesos } from "@/lib/money";
import { formatManilaDate } from "@/lib/dates";
import type { FilingComputationResult, Period } from "@/lib/tax/types";

/**
 * Renders the computation sheet the app files into the vault itself
 * (rework brief #2 §1.2 / Brief #1 §5.4) — the bookkeeper never uploads
 * this; step 3 (PREPARE_RETURN) generates and attaches it on completion.
 * Plain HTML, not a PDF — same reasoning as the filing package's
 * manifest.txt (no PDF-generation dependency in this project).
 */
export interface ComputationSheetClientInfo {
  registeredName: string;
  tin: string;
  rdoCode: string;
}

export interface ComputationSheetInput {
  client: ComputationSheetClientInfo;
  taxableYear: number;
  period: Period;
  generatedAt: Date;
  sheet: FilingComputationResult;
  hasSalesRecorded: boolean;
}

export function renderComputationSheetHtml(input: ComputationSheetInput): string {
  const { client, taxableYear, period, generatedAt, sheet, hasSalesRecorded } = input;

  const rows = sheet.breakdown
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.label)}</td><td class="amount">${escapeHtml(
          centsToPesos(line.amountCents, { withSymbol: true }),
        )}</td><td class="note">${escapeHtml(line.sourceNote)}</td></tr>`,
    )
    .join("\n");

  const summary = !hasSalesRecorded
    ? `No sales recorded for ${period} ${taxableYear} — enter the client's declared figure to compute. The figures below are incomplete until then.`
    : sheet.isOverpayment
      ? `Overpayment: ${centsToPesos(sheet.overpaymentCents, { withSymbol: true })}`
      : `Tax payable: ${centsToPesos(sheet.taxPayableCents, { withSymbol: true })}`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Computation sheet — ${escapeHtml(client.registeredName)} — TY${taxableYear} ${period}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; padding: 24px; }
  h1 { font-size: 16px; margin-bottom: 4px; }
  p.meta { color: #64748b; font-size: 12px; margin-top: 0; }
  table { border-collapse: collapse; width: 100%; margin-top: 16px; }
  td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
  td.amount { text-align: right; font-family: monospace; white-space: nowrap; }
  td.note { color: #94a3b8; font-size: 11px; }
  p.summary { font-weight: 600; margin-top: 16px; }
  p.disclaimer { color: #94a3b8; font-size: 11px; }
</style>
</head>
<body>
  <h1>${escapeHtml(client.registeredName)} — TY${taxableYear} ${period} — Computation sheet</h1>
  <p class="meta">TIN ${escapeHtml(client.tin)} · RDO ${escapeHtml(client.rdoCode)} · Generated ${escapeHtml(
    formatManilaDate(generatedAt),
  )}</p>
  <table><tbody>${rows}</tbody></table>
  <p class="summary">${escapeHtml(summary)}</p>
  <p class="disclaimer">This is a preparation aid; the filed return and BIR&apos;s own assessment govern.</p>
</body>
</html>
`;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}
