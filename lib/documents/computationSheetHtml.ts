import { centsToPesos } from "@/lib/money";
import { formatManilaDate } from "@/lib/dates";
import type { FilingComputationResult } from "@/lib/tax/types";

/**
 * Rework brief §5.4 — the fix for the clearest defect in the build:
 * PREPARE_RETURN required a draft_computation document, while the app
 * rendered that computation on screen and gave no way to obtain it as a
 * file. This renders the computation sheet to a self-contained HTML
 * file — inline styles, no external requests, no dependency — so the
 * archive can hold it and it stays readable indefinitely (prints to PDF
 * from a browser if needed).
 */
export interface ComputationSheetHtmlInput {
  clientName: string;
  clientTin: string;
  taxableYear: number;
  period: string;
  sheet: FilingComputationResult;
  isFrozen: boolean;
  generatedAt: Date;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderComputationSheetHtml(input: ComputationSheetHtmlInput): string {
  const rows = input.sheet.breakdown
    .map(
      (line) => `      <tr>
        <td>${escapeHtml(line.label)}</td>
        <td class="amount">${escapeHtml(centsToPesos(line.amountCents, { withSymbol: true }))}</td>
        <td class="note">${escapeHtml(line.sourceNote)}</td>
      </tr>`,
    )
    .join("\n");

  const resultLine = input.sheet.isOverpayment
    ? `Overpayment: ${centsToPesos(input.sheet.overpaymentCents, { withSymbol: true })}`
    : `Tax payable: ${centsToPesos(input.sheet.taxPayableCents, { withSymbol: true })}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Computation sheet — ${escapeHtml(input.clientName)} — TY${input.taxableYear} ${input.period}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; margin: 2rem; color: #0f172a; }
  h1 { font-size: 1.05rem; margin: 0 0 2px; }
  .meta { color: #64748b; font-size: 0.82rem; margin: 0 0 1rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.86rem; }
  td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  .amount { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .note { color: #94a3b8; font-size: 0.76rem; }
  .result { margin-top: 10px; font-weight: 600; }
  .banner { margin-top: 1rem; padding: 8px 12px; border-radius: 6px; font-size: 0.82rem; }
  .banner.live { background: #fef9c3; color: #713f12; }
  .banner.frozen { background: #dcfce7; color: #14532d; }
  .footer { margin-top: 1.5rem; color: #94a3b8; font-size: 0.74rem; }
</style>
</head>
<body>
  <h1>${escapeHtml(input.clientName)} — TIN ${escapeHtml(input.clientTin)}</h1>
  <p class="meta">TY${input.taxableYear} ${input.period} — Form ${escapeHtml(input.sheet.formType)} — generated ${escapeHtml(
    formatManilaDate(input.generatedAt),
  )}</p>
  <table>
    <tbody>
${rows}
    </tbody>
  </table>
  <p class="result">${escapeHtml(resultLine)}</p>
  <p class="banner ${input.isFrozen ? "frozen" : "live"}">${
    input.isFrozen
      ? "Frozen — this reflects the figures as filed."
      : "Live preview — not yet filed. This file reflects figures as of generation time."
  }</p>
  <p class="footer">Generated automatically by the practice manager. This is a preparation aid — the filed return and BIR&#39;s own assessment govern.</p>
</body>
</html>
`;
}
