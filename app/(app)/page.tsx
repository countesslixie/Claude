import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { ClickableRow, ActionCell } from "@/components/clickable-row";
import { formatManilaDate, currentTaxableYearManila, manilaCalendarDay } from "@/lib/dates";
import { currentStepCode } from "@/lib/workflow/status";
import { deriveStepAging, type AgingTone } from "@/lib/workflow/aging";
import { stepDueDate } from "@/lib/workflow/dueDate";
import { missingRequiredSlots } from "@/lib/workflow/docSlots";
import { parseDocSlots } from "@/lib/workflow/types";
import { logFollowUpAction } from "@/lib/actions/workflowSteps";

const AGING_BADGE_TONE: Record<AgingTone, StatusTone> = { green: "done", amber: "waiting", red: "overdue" };

/**
 * Dashboard (SPEC.md §11.1) — "where am I?" in under 10 seconds. Six rows:
 * needs my action, waiting on BIR, waiting on client, upcoming deadlines,
 * missing documents, threshold/election alerts.
 */
export default async function DashboardPage() {
  const now = new Date();
  const in45Days = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);
  const currentYear = currentTaxableYearManila();

  const activeFilings = await prisma.filing.findMany({
    where: { deletedAt: null, status: { not: "COMPLETE" } },
    include: {
      client: true,
      workflowSteps: { orderBy: { sequence: "asc" }, include: { documents: { where: { deletedAt: null } } } },
    },
    orderBy: { adjustedDueDate: "asc" },
  });

  type Row = {
    filing: (typeof activeFilings)[number];
    step: (typeof activeFilings)[number]["workflowSteps"][number];
    aging: ReturnType<typeof deriveStepAging>;
    dueDate: Date;
  };
  const needsAction: Row[] = [];
  const waitingBir: Row[] = [];
  const waitingClient: Row[] = [];
  const missingDocs: Array<{ filing: (typeof activeFilings)[number]; step: Row["step"]; missing: string[] }> = [];

  for (const filing of activeFilings) {
    const code = currentStepCode(filing.workflowSteps);
    const step = filing.workflowSteps.find((s) => s.stepCode === code);
    if (!step) continue;

    // Each step shows ITS OWN due date, never the filing's adjustedDueDate
    // by default — RECEIVE_2307 uses certificatesExpectedBy, a waiting
    // step uses its own expected-response date (the same clock the aging
    // badge below measures against), FILE_RETURN uses adjustedDueDate
    // (it genuinely is the statutory deadline), everything else uses
    // internalFilingTarget. See lib/workflow/dueDate.ts.
    const dueDate = stepDueDate({
      stepCode: step.stepCode,
      status: step.status,
      waitingSince: step.waitingSince,
      expectedResponseDays: step.expectedResponseDays,
      certificatesExpectedBy: filing.certificatesExpectedBy,
      internalFilingTarget: filing.internalFilingTarget,
      adjustedDueDate: filing.adjustedDueDate,
    });

    if (step.status === "WAITING_EXTERNAL") {
      const aging = deriveStepAging({
        stepCode: step.stepCode,
        status: step.status,
        waitingSince: step.waitingSince,
        expectedResponseDays: step.expectedResponseDays,
        certificatesExpectedBy: filing.certificatesExpectedBy,
        now,
      });
      const row: Row = { filing, step, aging, dueDate };
      if (step.waitingOnLabel === "BIR") waitingBir.push(row);
      else if (step.waitingOnLabel === "Client") waitingClient.push(row);
    } else if (step.status === "PENDING" || step.status === "IN_PROGRESS") {
      needsAction.push({ filing, step, aging: null, dueDate });
    }

    const slots = parseDocSlots(step.requiredDocSlots);
    const missing = missingRequiredSlots(slots, step.documents);
    if (missing.length > 0) {
      missingDocs.push({ filing, step, missing: missing.map((s) => s.label) });
    }
  }

  waitingBir.sort((a, b) => agingRank(b.aging) - agingRank(a.aging));
  waitingClient.sort((a, b) => agingRank(b.aging) - agingRank(a.aging));

  // Calendar-day comparison, not raw instant: adjustedDueDate is a clean
  // UTC-midnight marker (Manila 08:00). An instant comparison against
  // `now` would drop a filing due TODAY off this list the moment Manila
  // passes 08:00, hours before its actual deadline (Manila midnight).
  const todayManila = manilaCalendarDay(now);
  const in45DaysManila = manilaCalendarDay(in45Days);
  const upcomingDeadlines = activeFilings.filter((f) => {
    const dueManila = manilaCalendarDay(f.adjustedDueDate);
    return dueManila >= todayManila && dueManila <= in45DaysManila;
  });

  const missingDocsByClient = new Map<string, { clientName: string; items: typeof missingDocs }>();
  for (const item of missingDocs) {
    const key = item.filing.clientId;
    const bucket = missingDocsByClient.get(key) ?? { clientName: item.filing.client.registeredName, items: [] };
    bucket.items.push(item);
    missingDocsByClient.set(key, bucket);
  }

  const [ruleSet, activeClients] = await Promise.all([
    prisma.taxRuleSet.findUnique({ where: { taxableYear: currentYear } }),
    prisma.client.findMany({
      where: { isActive: true },
      include: { taxYears: { where: { taxableYear: currentYear } } },
    }),
  ]);

  const electionAlerts = activeClients.filter((c) => (c.taxYears[0]?.electionStatus ?? "NOT_YET_ELECTED") !== "ELECTED");

  const thresholdAlerts: Array<{ clientName: string; pct: number }> = [];
  if (ruleSet) {
    for (const client of activeClients) {
      const sum = await prisma.salesTransaction.aggregate({
        where: { clientId: client.id, taxableYear: currentYear, deletedAt: null },
        _sum: { grossAmountCents: true },
      });
      const cumulativeGross = sum._sum.grossAmountCents ?? 0;
      const pct = cumulativeGross / ruleSet.vatThresholdCents;
      if (pct >= 0.8) thresholdAlerts.push({ clientName: client.registeredName, pct });
    }
  }

  const rowHref = (filingId: string, clientId: string) => `/clients/${clientId}/filings/${filingId}`;

  const needsActionRows: FilingTableRow[] = needsAction.map((r) => ({
    id: r.filing.id,
    href: rowHref(r.filing.id, r.filing.clientId),
    clientName: r.filing.client.registeredName,
    taxableYear: r.filing.taxableYear,
    period: r.filing.period,
    stepTitle: r.step.title,
    dueDate: r.dueDate,
  }));

  const waitingBirRows: FilingTableRow[] = waitingBir.map((r) => ({
    id: r.filing.id,
    href: rowHref(r.filing.id, r.filing.clientId),
    clientName: r.filing.client.registeredName,
    taxableYear: r.filing.taxableYear,
    period: r.filing.period,
    stepTitle: r.step.title,
    dueDate: r.dueDate,
    aging: r.aging,
    action: (
      <form action={logFollowUpAction.bind(null, r.step.id)}>
        <Button type="submit" size="sm" variant="secondary">
          Log follow-up
        </Button>
      </form>
    ),
  }));

  const waitingClientRows: FilingTableRow[] = waitingClient.map((r) => ({
    id: r.filing.id,
    href: rowHref(r.filing.id, r.filing.clientId),
    clientName: r.filing.client.registeredName,
    taxableYear: r.filing.taxableYear,
    period: r.filing.period,
    stepTitle: r.step.title,
    dueDate: r.dueDate,
    aging: r.aging,
    action: (
      <form action={logFollowUpAction.bind(null, r.step.id)}>
        <Button type="submit" size="sm" variant="secondary">
          Log follow-up
        </Button>
      </form>
    ),
  }));

  const upcomingRows: FilingTableRow[] = upcomingDeadlines.map((f) => ({
    id: f.id,
    href: rowHref(f.id, f.clientId),
    clientName: f.client.registeredName,
    taxableYear: f.taxableYear,
    period: f.period,
    // This row is specifically the statutory/adjusted deadline calendar,
    // unlike the rows above — filing.adjustedDueDate is correct here, not
    // a bug.
    stepTitle: f.formType,
    dueDate: f.adjustedDueDate,
  }));

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-3">
      <h1 className="text-lg font-semibold text-slate-900">Dashboard</h1>

      <DashboardRow title="Needs my action now" count={needsActionRows.length}>
        <FilingRowsTable rows={needsActionRows} />
      </DashboardRow>

      <DashboardRow title="Waiting on BIR" count={waitingBirRows.length}>
        <FilingRowsTable rows={waitingBirRows} />
      </DashboardRow>

      <DashboardRow title="Waiting on client" count={waitingClientRows.length}>
        <FilingRowsTable rows={waitingClientRows} />
      </DashboardRow>

      <DashboardRow title="Upcoming deadlines (next 45 days)" count={upcomingRows.length}>
        <FilingRowsTable rows={upcomingRows} />
      </DashboardRow>

      <DashboardRow title="Missing documents" count={missingDocs.length}>
        <div className="flex flex-col gap-2 p-3">
          {Array.from(missingDocsByClient.entries()).map(([clientId, bucket]) => (
            <div key={clientId} className="rounded-md border border-slate-200 p-2">
              <p className="text-[14px] font-medium text-slate-900">{bucket.clientName}</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {bucket.items.map((item, i) => (
                  <li key={i} className="text-[13px] text-slate-600">
                    TY{item.filing.taxableYear} {item.filing.period} —{" "}
                    <Link href={rowHref(item.filing.id, item.filing.clientId)} className="underline">
                      {item.step.title}
                    </Link>
                    : {item.missing.join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DashboardRow>

      <DashboardRow title="Threshold & election alerts" count={thresholdAlerts.length + electionAlerts.length}>
        <div className="flex flex-col gap-2 p-3">
          {thresholdAlerts.map((a) => (
            <p key={a.clientName} className="rounded-md bg-red-50 px-3 py-2 text-[14px] text-red-800">
              {a.clientName}: {(a.pct * 100).toFixed(0)}% of the ₱3,000,000 VAT threshold
              {a.pct >= 1 ? " — BREACHED. The 8% option ceases to apply; consult the current BIR issuance." : "."}
            </p>
          ))}
          {electionAlerts.map((c) => (
            <p key={c.id} className="rounded-md bg-amber-50 px-3 py-2 text-[14px] text-amber-800">
              {c.registeredName}: 8% election for TY{currentYear} is{" "}
              {c.taxYears[0]?.electionStatus ?? "not recorded"} — Q1 filings are blocked until confirmed.
            </p>
          ))}
        </div>
      </DashboardRow>
    </div>
  );
}

function agingRank(aging: ReturnType<typeof deriveStepAging>): number {
  if (!aging) return -1;
  return aging.tone === "red" ? 2 : aging.tone === "amber" ? 1 : 0;
}

function DashboardRow({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) {
    return (
      <div className="flex items-center gap-2 px-1 text-[13px] text-slate-400">
        <span>{title}</span>
        <span className="inline-flex items-center justify-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-400">
          0
        </span>
      </div>
    );
  }
  return (
    <Card>
      <CardHeader className="flex items-center gap-2 py-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <span className="inline-flex items-center justify-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
          {count}
        </span>
      </CardHeader>
      <CardBody className="p-0">{children}</CardBody>
    </Card>
  );
}

type FilingTableRow = {
  id: string;
  href: string;
  clientName: string;
  taxableYear: number;
  period: string;
  stepTitle: string;
  dueDate: Date;
  aging?: ReturnType<typeof deriveStepAging>;
  action?: React.ReactNode;
};

function FilingRowsTable({ rows }: { rows: FilingTableRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-slate-100 text-left text-[11px] font-medium uppercase tracking-wide text-slate-400">
            <th className="px-3 py-2 font-medium">Client</th>
            <th className="px-3 py-2 font-medium">Period</th>
            <th className="px-3 py-2 font-medium">Step</th>
            <th className="px-3 py-2 font-medium">Due</th>
            <th className="px-3 py-2 font-medium">Aging</th>
            <th className="px-3 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <ClickableRow key={r.id} href={r.href} className="border-b border-slate-100 last:border-0">
              <td className="px-3 py-2 text-[14px] font-medium text-slate-900">{r.clientName}</td>
              <td className="px-3 py-2 text-[13px] text-slate-500">
                TY{r.taxableYear} {r.period}
              </td>
              <td className="px-3 py-2 text-[14px] text-slate-700">{r.stepTitle}</td>
              <td className="px-3 py-2 text-[13px] text-slate-500">{formatManilaDate(r.dueDate)}</td>
              <td className="px-3 py-2">
                {r.aging && <StatusBadge tone={AGING_BADGE_TONE[r.aging.tone]}>{r.aging.daysWaiting}d</StatusBadge>}
              </td>
              {r.action ? <ActionCell>{r.action}</ActionCell> : <td className="px-3 py-2" />}
            </ClickableRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}
