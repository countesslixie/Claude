import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { STATUS_GRID, STATUS_STRIP_PADDING } from "@/components/status-columns";

/**
 * D116 — the tax payable line under the Next banner: amount, days to the
 * adjusted due date, and the filing's status pill in the same fixed column as
 * every group header's pill (no "·" before it). The empty action cell keeps the
 * Expand/Collapse column's width so the pill's position matches the groups'.
 */
export function FilingSummaryStrip({
  netLabel,
  daysLabel,
  statusTone,
  statusLabel,
}: {
  netLabel: string;
  daysLabel: string;
  statusTone: StatusTone;
  statusLabel: string;
}) {
  return (
    <div className={`mb-3 ${STATUS_GRID} rounded-lg border border-line bg-surface py-2 text-sm ${STATUS_STRIP_PADDING}`}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-medium text-ink">{netLabel}</span>
        <span className="text-faint">·</span>
        <span className="text-ink-secondary">{daysLabel}</span>
      </div>
      <div data-cell="status" className="whitespace-nowrap">
        <StatusBadge tone={statusTone}>{statusLabel}</StatusBadge>
      </div>
      <div data-cell="action" />
    </div>
  );
}
