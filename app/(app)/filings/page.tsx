import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { formatManilaDate } from "@/lib/dates";
import { countSkippedSteps, filingStatusLabel } from "@/lib/workflow/status";
import { WORKFLOW_GROUPS, currentGroupCode, summarizeGroup } from "@/lib/workflow/groups";
import { deriveStepAging, birWaitTags, type BirWaitTag } from "@/lib/workflow/aging";
import type { FilingStatus, WorkflowStepStatus } from "@/lib/workflow/types";

const FILING_STATUS_TONE: Record<string, StatusTone> = {
  NOT_STARTED: "pending",
  IN_PROGRESS: "progress",
  WAITING_CLIENT: "waiting",
  WAITING_BIR: "waiting",
  BLOCKED: "overdue",
  COMPLETE: "done",
  NA: "pending",
};

/**
 * Filing cycle board (brief #4a, superseding SPEC.md §11.2's flat
 * sixteen-column design): kanban, columns = the five groups, cards =
 * client-period. Sixteen columns couldn't be read at a glance; five can.
 * "Which process am I in" at a glance. Filters persist via the URL
 * (client/year/status) — no client-side state, so a bookmarked/shared
 * link reproduces the same view (SPEC.md §11 design note).
 */
export default async function FilingsBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; taxableYear?: string; status?: string }>;
}) {
  const params = await searchParams;

  const clients = await prisma.client.findMany({ where: { isActive: true }, orderBy: { registeredName: "asc" } });

  const filings = await prisma.filing.findMany({
    where: {
      deletedAt: null,
      filedOutsideApp: false,
      ...(params.clientId ? { clientId: params.clientId } : {}),
      ...(params.taxableYear ? { taxableYear: Number(params.taxableYear) } : {}),
      ...(params.status ? { status: params.status as never } : {}),
    },
    include: {
      client: true,
      workflowSteps: {
        select: {
          sequence: true,
          status: true,
          stepCode: true,
          waitingOnLabel: true,
          waitingSince: true,
          expectedResponseDays: true,
        },
      },
    },
    orderBy: [{ adjustedDueDate: "asc" }],
  });

  // §2, §5 — a card sits in its earliest incomplete GROUP (group order,
  // not raw step sequence — group 2/File isn't contiguous), carrying that
  // group's waiting state so a filing awaiting only the TRRC reads as
  // "File — waiting on BIR, 12d" rather than looking unfiled.
  const now = new Date();
  const cards = filings.map((f) => {
    const groupCode = currentGroupCode(f.workflowSteps);
    const group = groupCode ? WORKFLOW_GROUPS.find((g) => g.code === groupCode) : undefined;
    const outstandingLabel = group
      ? summarizeGroup(
          group,
          f.workflowSteps.map((s) => ({
            stepCode: s.stepCode,
            status: s.status,
            waitingOnLabel: s.waitingOnLabel,
            agingDaysWaiting:
              s.status === "WAITING_EXTERNAL"
                ? deriveStepAging({
                    stepCode: s.stepCode,
                    status: s.status,
                    waitingSince: s.waitingSince,
                    expectedResponseDays: s.expectedResponseDays,
                    certificatesExpectedBy: f.certificatesExpectedBy,
                    now,
                  })?.daysWaiting ?? null
                : null,
          })),
        ).outstandingLabel
      : null;
    // D79 — a card outside BIR Confirmations still shows any BIR wait it's carrying;
    // one inside that column already says so.
    const allBirTags = birWaitTags(f.workflowSteps, f.certificatesExpectedBy, now);
    const birTags = groupCode === "BIR_CONFIRMATIONS" ? [] : allBirTags;
    // Inside BIR Confirmations the group's own wait line carries the colour instead:
    // red once either wait is past twice its expected response days (same thresholds as the pill).
    const outstandingTone: "amber" | "red" =
      groupCode === "BIR_CONFIRMATIONS" && allBirTags.some((t) => t.tone === "overdue") ? "red" : "amber";
    return { ...f, groupCode, outstandingLabel, outstandingTone, birTags };
  });

  const columns = WORKFLOW_GROUPS.map((g) => ({
    code: g.code,
    title: g.name,
    filings: cards.filter((c) => c.groupCode === g.code),
  }));
  const completeLane = cards.filter((c) => c.groupCode === null);

  const taxableYears = Array.from(new Set(filings.map((f) => f.taxableYear))).sort((a, b) => b - a);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">Filing cycle board</h1>
      </div>

      <Card className="mb-4">
        <CardBody>
          <form className="flex flex-wrap items-end gap-3" method="get">
            <div className="w-56">
              <label className="text-xs font-medium uppercase tracking-wide text-faint" htmlFor="clientId">
                Client
              </label>
              <Select id="clientId" name="clientId" defaultValue={params.clientId ?? ""}>
                <option value="">All clients</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.registeredName}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-32">
              <label className="text-xs font-medium uppercase tracking-wide text-faint" htmlFor="taxableYear">
                Year
              </label>
              <Select id="taxableYear" name="taxableYear" defaultValue={params.taxableYear ?? ""}>
                <option value="">All years</option>
                {taxableYears.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-44">
              <label className="text-xs font-medium uppercase tracking-wide text-faint" htmlFor="status">
                Status
              </label>
              <Select id="status" name="status" defaultValue={params.status ?? ""}>
                <option value="">All statuses</option>
                {Object.keys(FILING_STATUS_TONE).map((s) => (
                  <option key={s} value={s}>
                    {filingStatusLabel(s as FilingStatus, 0)}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" size="sm" variant="secondary">
              Filter
            </Button>
            {(params.clientId || params.taxableYear || params.status) && (
              <Link href="/filings">
                <Button type="button" size="sm" variant="ghost">
                  Clear
                </Button>
              </Link>
            )}
          </form>
        </CardBody>
      </Card>

      {filings.length === 0 ? (
        <p className="text-sm text-faint">No filings match these filters.</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {columns.map((col) => (
            <BoardColumn key={col.code} title={col.title} filings={col.filings} />
          ))}
          <BoardColumn title="Complete" filings={completeLane} />
        </div>
      )}
    </div>
  );
}

function BoardColumn({
  title,
  filings,
}: {
  title: string;
  filings: Array<{
    id: string;
    clientId: string;
    taxableYear: number;
    period: string;
    status: FilingStatus;
    adjustedDueDate: Date;
    client: { registeredName: string };
    workflowSteps: Array<{ status: WorkflowStepStatus }>;
    outstandingLabel: string | null;
    outstandingTone: "amber" | "red";
    birTags: BirWaitTag[];
  }>;
}) {
  return (
    <div className="w-64 flex-shrink-0">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-faint">{title}</h2>
        <span className="text-xs text-faint">{filings.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {filings.map((f) => (
          <Link key={f.id} href={`/clients/${f.clientId}/filings/${f.id}`}>
            <div className="rounded-md border border-line bg-surface p-2 text-sm hover:border-separator">
              <p className="font-medium text-ink">{f.client.registeredName}</p>
              <p className="text-xs text-faint">
                TY{f.taxableYear} {f.period}
              </p>
              <div className="mt-1 flex items-center justify-between">
                <StatusBadge tone={FILING_STATUS_TONE[f.status] ?? "pending"}>
                  {filingStatusLabel(f.status, countSkippedSteps(f.workflowSteps))}
                </StatusBadge>
                <span className="text-xs text-faint">{formatManilaDate(f.adjustedDueDate)}</span>
              </div>
              {f.outstandingLabel && (
                <p className={`mt-1 text-xs ${f.outstandingTone === "red" ? "text-red" : "text-amber"}`}>{f.outstandingLabel}</p>
              )}
              {f.birTags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {f.birTags.map((t) => (
                    <StatusBadge key={t.stepCode} tone={t.tone}>
                      {t.text}
                    </StatusBadge>
                  ))}
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
