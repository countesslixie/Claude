import Link from "next/link";
import { ClickableRow } from "@/components/clickable-row";
import { StatusBadge } from "@/components/status-badge";
import { formatManilaDate } from "@/lib/dates";
import { formatDays } from "@/lib/formatDays";
import { periodLabel } from "@/lib/periodLabel";
import { agingPillTone, type StepAging } from "@/lib/workflow/aging";

/**
 * D127 — every dashboard table shares one set of centred columns at fixed
 * widths (Client · Period · Step · Due · Aging), so they line up from one table
 * to the next. A table scrolls sideways inside its card when it gets narrow.
 */
const COL_WIDTHS = ["22%", "13%", "30%", "16%", "19%"];
const TH = "px-3 py-2 text-center text-[11px] font-medium uppercase tracking-wide text-faint";
const TD = "px-3 py-2 text-center align-middle";

function Shell({ headers, children }: { headers: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] table-fixed border-collapse">
        <colgroup>
          {COL_WIDTHS.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-line">{headers}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const periodText = (taxableYear: number, period: string) => `TY${taxableYear} ${periodLabel(period)}`;

export type FilingTableRow = {
  id: string;
  href: string;
  clientName: string;
  taxableYear: number;
  period: string;
  stepCode: string;
  stepTitle: string;
  dueDate: Date;
  aging?: StepAging | null;
};

export function FilingRowsTable({ rows }: { rows: FilingTableRow[] }) {
  return (
    <Shell
      headers={
        <>
          <th className={TH}>Client</th>
          <th className={TH}>Period</th>
          <th className={TH}>Step</th>
          <th className={TH}>Due</th>
          <th className={TH}>Aging</th>
        </>
      }
    >
      {rows.map((r) => (
        <ClickableRow key={r.id} href={r.href} className="border-b border-line last:border-0">
          <td className={`${TD} text-[14px] font-medium text-ink`}>{r.clientName}</td>
          <td className={`${TD} text-[13px] text-faint`}>{periodText(r.taxableYear, r.period)}</td>
          <td className={`${TD} text-[14px] text-ink-secondary`}>{r.stepTitle}</td>
          <td className={`${TD} text-[13px] text-faint`}>{formatManilaDate(r.dueDate)}</td>
          <td className={TD}>
            {r.aging && <StatusBadge tone={agingPillTone(r.stepCode, r.aging.tone)}>{formatDays(r.aging.daysWaiting)}</StatusBadge>}
          </td>
        </ClickableRow>
      ))}
    </Shell>
  );
}

export type MissingRow = {
  id: string;
  href: string;
  clientName: string;
  taxableYear: number;
  period: string;
  stepTitle: string;
  missing: string;
  dueDate: Date;
};

export function MissingDocsTable({ rows }: { rows: MissingRow[] }) {
  return (
    <Shell
      headers={
        <>
          <th className={TH}>Client</th>
          <th className={TH}>Period</th>
          <th className={TH}>Step</th>
          <th className={TH} colSpan={2}>
            Missing
          </th>
        </>
      }
    >
      {rows.map((r) => (
        <tr key={r.id} className="border-b border-line last:border-0">
          <td className={`${TD} text-[14px] font-medium text-ink`}>{r.clientName}</td>
          <td className={`${TD} text-[13px] text-faint`}>{periodText(r.taxableYear, r.period)}</td>
          <td className={`${TD} text-[14px]`}>
            <Link href={r.href} className="text-ink-secondary underline">
              {r.stepTitle}
            </Link>
          </td>
          <td className={`${TD} text-[13px] text-ink-secondary`} colSpan={2}>
            {r.missing}
          </td>
        </tr>
      ))}
    </Shell>
  );
}

export type AlertRow = { id: string; clientName: string; taxableYear: number; text: string; tone: "red" | "amber" };

export function AlertsTable({ rows }: { rows: AlertRow[] }) {
  return (
    <Shell
      headers={
        <>
          <th className={TH}>Client</th>
          <th className={TH}>Period</th>
          <th className={TH} colSpan={3}>
            Alert
          </th>
        </>
      }
    >
      {rows.map((r) => (
        <tr key={r.id} className="border-b border-line last:border-0">
          <td className={`${TD} text-[14px] font-medium text-ink`}>{r.clientName}</td>
          <td className={`${TD} text-[13px] text-faint`}>TY{r.taxableYear}</td>
          <td className={`${TD} text-[13px] ${r.tone === "red" ? "text-red" : "text-amber"}`} colSpan={3}>
            {r.text}
          </td>
        </tr>
      ))}
    </Shell>
  );
}
