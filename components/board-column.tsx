import Link from "next/link";
import { periodLabel } from "@/lib/periodLabel";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { formatManilaDate } from "@/lib/dates";
import { filingStatusLabel } from "@/lib/workflow/status";
import type { BirWaitTag } from "@/lib/workflow/aging";
import type { FilingStatus } from "@/lib/workflow/types";

const FILING_STATUS_TONE: Record<string, StatusTone> = {
  NOT_STARTED: "pending",
  IN_PROGRESS: "progress",
  WAITING_CLIENT: "waiting",
  WAITING_BIR: "waiting",
  BLOCKED: "overdue",
  COMPLETE: "done",
  NA: "pending",
};

/** D138 — a BIR wait tag on a card outside BIR Confirmations: plain grey text, no pill, no colour. */
export const BIR_TAG_CLASS = "text-xs text-faint";

export interface BoardCardData {
  id: string;
  clientId: string;
  taxableYear: number;
  period: string;
  status: FilingStatus;
  adjustedDueDate: Date;
  client: { registeredName: string };
  outstandingLabel: string | null;
  outstandingTone: "amber" | "red";
  birTags: BirWaitTag[];
}

/**
 * D138 — every card has the same fixed height (sized for name, period, pill and
 * due date, a two-line message and a wait tag); a card with less keeps the empty
 * space. The message is cut off after two lines; the tag sits at the bottom right.
 */
export function BoardColumn({ title, filings }: { title: string; filings: BoardCardData[] }) {
  return (
    <div className="w-60 flex-shrink-0">
      <div className="sticky top-0 z-10 mb-2 flex items-center justify-between border-b-2 border-ink-secondary bg-background px-1 pb-1.5">
        <h2 className="text-[15px] font-bold text-ink">{title}</h2>
        <span className="rounded-full bg-[var(--status-pending-bg)] px-2 py-0.5 text-xs font-medium text-ink-secondary">
          {filings.length}
        </span>
      </div>
      {filings.length === 0 ? (
        <p className="px-1 text-xs text-faint">Nothing here.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {filings.map((f) => (
            <Link key={f.id} href={`/clients/${f.clientId}/filings/${f.id}`} className="block">
              <div className="flex h-[9.25rem] flex-col rounded-md border border-line bg-surface p-2 text-sm hover:border-separator">
                <p className="truncate font-medium text-ink">{f.client.registeredName}</p>
                <p className="text-xs text-faint">
                  TY{f.taxableYear} {periodLabel(f.period)}
                </p>
                <div className="mt-1 flex items-center justify-between gap-1">
                  <StatusBadge tone={FILING_STATUS_TONE[f.status] ?? "pending"}>{filingStatusLabel(f.status)}</StatusBadge>
                  <span className="text-xs text-faint">{formatManilaDate(f.adjustedDueDate)}</span>
                </div>
                {f.outstandingLabel && (
                  <p className={`mt-1 line-clamp-2 text-xs ${f.outstandingTone === "red" ? "text-red" : "text-amber"}`}>
                    {f.outstandingLabel}
                  </p>
                )}
                {f.birTags.length > 0 && (
                  <p className={`mt-auto text-right ${BIR_TAG_CLASS}`}>{f.birTags.map((t) => t.text).join(" · ")}</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
