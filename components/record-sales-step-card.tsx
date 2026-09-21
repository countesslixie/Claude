import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { centsToPesos } from "@/lib/money";

/**
 * Brief #4b (D33) — step 1 (RECORD_SALES) is a self-completing step: it
 * marks itself DONE the moment the quarter's sales are Saved for real
 * (lib/actions/quarterlySales.ts's saveQuarterlySales), and there is no
 * manual control left on this card at all — no Start, Mark waiting, Mark
 * done, Skip, or skip-reason box. The status is derived: "Waiting on
 * client" until a final Save, then Done, and the quarter's total shows
 * once it's been saved (draft or final).
 */
export function RecordSalesStepCard({
  sequence,
  title,
  status,
  totalCents,
  incomeHref,
}: {
  sequence: number;
  title: string;
  status: string;
  /** null when this quarter has no QuarterlySales row at all yet. */
  totalCents: number | null;
  incomeHref: string;
}) {
  const isDone = status === "DONE";

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-900">
          {sequence}. {title}
        </p>
        <StatusBadge tone={isDone ? "done" : "waiting"}>{isDone ? "Done" : "Waiting on client"}</StatusBadge>
      </div>

      <p className="mt-1 text-sm text-slate-700">
        {totalCents != null ? `Total: ${centsToPesos(totalCents, { withSymbol: true })}` : "Not saved yet."}
      </p>

      <div className="mt-2">
        <Link href={incomeHref}>
          <Button type="button" size="sm" variant="secondary">
            Go to income entry
          </Button>
        </Link>
      </div>
    </div>
  );
}
