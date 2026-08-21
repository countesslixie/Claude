import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { formatManilaDate } from "@/lib/dates";
import { currentStepCode, countSkippedSteps, filingStatusLabel } from "@/lib/workflow/status";
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
 * Filing cycle board (SPEC.md §11.2): kanban, columns = the 16 steps,
 * cards = client-period. "Which process am I in" at a glance. Filters
 * persist via the URL (client/year/status) — no client-side state, so a
 * bookmarked/shared link reproduces the same view (SPEC.md §11 design note).
 */
export default async function FilingsBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; taxableYear?: string; status?: string }>;
}) {
  const params = await searchParams;

  const [templates, clients] = await Promise.all([
    prisma.workflowStepTemplate.findMany({ where: { isActive: true }, orderBy: { sequence: "asc" } }),
    prisma.client.findMany({ where: { isActive: true }, orderBy: { registeredName: "asc" } }),
  ]);

  const filings = await prisma.filing.findMany({
    where: {
      deletedAt: null,
      ...(params.clientId ? { clientId: params.clientId } : {}),
      ...(params.taxableYear ? { taxableYear: Number(params.taxableYear) } : {}),
      ...(params.status ? { status: params.status as never } : {}),
    },
    include: { client: true, workflowSteps: { select: { sequence: true, status: true, stepCode: true } } },
    orderBy: [{ adjustedDueDate: "asc" }],
  });

  const columns = templates.map((t) => ({
    stepCode: t.stepCode,
    title: t.title,
    filings: filings.filter((f) => currentStepCode(f.workflowSteps) === t.stepCode),
  }));
  const completeLane = filings.filter((f) => currentStepCode(f.workflowSteps) === null);

  const taxableYears = Array.from(new Set(filings.map((f) => f.taxableYear))).sort((a, b) => b - a);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Filing cycle board</h1>
      </div>

      <Card className="mb-4">
        <CardBody>
          <form className="flex flex-wrap items-end gap-3" method="get">
            <div className="w-56">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-400" htmlFor="clientId">
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
              <label className="text-xs font-medium uppercase tracking-wide text-slate-400" htmlFor="taxableYear">
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
              <label className="text-xs font-medium uppercase tracking-wide text-slate-400" htmlFor="status">
                Status
              </label>
              <Select id="status" name="status" defaultValue={params.status ?? ""}>
                <option value="">All statuses</option>
                {Object.keys(FILING_STATUS_TONE).map((s) => (
                  <option key={s} value={s}>
                    {s}
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
        <p className="text-sm text-slate-400">No filings match these filters.</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {columns.map((col) => (
            <BoardColumn key={col.stepCode} title={col.title} filings={col.filings} />
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
  }>;
}) {
  return (
    <div className="w-64 flex-shrink-0">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
        <span className="text-xs text-slate-400">{filings.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {filings.map((f) => (
          <Link key={f.id} href={`/clients/${f.clientId}/filings/${f.id}`}>
            <div className="rounded-md border border-slate-200 bg-white p-2 text-sm hover:border-slate-400">
              <p className="font-medium text-slate-900">{f.client.registeredName}</p>
              <p className="text-xs text-slate-500">
                TY{f.taxableYear} {f.period}
              </p>
              <div className="mt-1 flex items-center justify-between">
                <StatusBadge tone={FILING_STATUS_TONE[f.status] ?? "pending"}>
                  {filingStatusLabel(f.status, countSkippedSteps(f.workflowSteps))}
                </StatusBadge>
                <span className="text-xs text-slate-400">{formatManilaDate(f.adjustedDueDate)}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
