import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { formatManilaDate, currentTaxableYearManila } from "@/lib/dates";
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

  const upcomingDeadlines = activeFilings.filter(
    (f) => f.adjustedDueDate.getTime() >= now.getTime() && f.adjustedDueDate.getTime() <= in45Days.getTime(),
  );

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

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-slate-900">Dashboard</h1>

      <DashboardRow title="Needs my action now" count={needsAction.length}>
        {needsAction.length === 0 ? (
          <Empty text="Nothing waiting on you right now." />
        ) : (
          needsAction.map(({ filing, step, dueDate }) => (
            <FilingRowCard key={filing.id} filing={filing} stepTitle={step.title} dueDate={dueDate} />
          ))
        )}
      </DashboardRow>

      <DashboardRow title="Waiting on BIR" count={waitingBir.length}>
        {waitingBir.length === 0 ? (
          <Empty text="Nothing waiting on BIR." />
        ) : (
          waitingBir.map(({ filing, step, aging, dueDate }) => (
            <FilingRowCard key={filing.id} filing={filing} stepTitle={step.title} dueDate={dueDate} aging={aging}>
              <form action={logFollowUpAction.bind(null, step.id)}>
                <Button type="submit" size="sm" variant="secondary">
                  Log follow-up
                </Button>
              </form>
            </FilingRowCard>
          ))
        )}
      </DashboardRow>

      <DashboardRow title="Waiting on client" count={waitingClient.length}>
        {waitingClient.length === 0 ? (
          <Empty text="Nothing waiting on a client." />
        ) : (
          waitingClient.map(({ filing, step, aging, dueDate }) => (
            <FilingRowCard key={filing.id} filing={filing} stepTitle={step.title} dueDate={dueDate} aging={aging}>
              <form action={logFollowUpAction.bind(null, step.id)}>
                <Button type="submit" size="sm" variant="secondary">
                  Log follow-up
                </Button>
              </form>
            </FilingRowCard>
          ))
        )}
      </DashboardRow>

      <DashboardRow title="Upcoming deadlines (next 45 days)" count={upcomingDeadlines.length}>
        {upcomingDeadlines.length === 0 ? (
          <Empty text="Nothing due in the next 45 days." />
        ) : (
          // This row is specifically the statutory/adjusted deadline
          // calendar, unlike the step rows above — filing.adjustedDueDate
          // is correct here, not a bug (see the "Confirm what that panel
          // queries" note in the commit for this fix).
          upcomingDeadlines.map((f) => (
            <FilingRowCard key={f.id} filing={f} stepTitle={f.formType} dueDate={f.adjustedDueDate} />
          ))
        )}
      </DashboardRow>

      <DashboardRow title="Missing documents" count={missingDocs.length}>
        {missingDocsByClient.size === 0 ? (
          <Empty text="No missing required documents." />
        ) : (
          Array.from(missingDocsByClient.entries()).map(([clientId, bucket]) => (
            <div key={clientId} className="rounded-md border border-slate-200 p-2">
              <p className="text-sm font-medium text-slate-900">{bucket.clientName}</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {bucket.items.map((item, i) => (
                  <li key={i} className="text-xs text-slate-600">
                    TY{item.filing.taxableYear} {item.filing.period} —{" "}
                    <Link href={`/clients/${item.filing.clientId}/filings/${item.filing.id}`} className="underline">
                      {item.step.title}
                    </Link>
                    : {item.missing.join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </DashboardRow>

      <DashboardRow title="Threshold & election alerts" count={thresholdAlerts.length + electionAlerts.length}>
        {thresholdAlerts.length === 0 && electionAlerts.length === 0 ? (
          <Empty text="No threshold or election alerts." />
        ) : (
          <div className="flex flex-col gap-2">
            {thresholdAlerts.map((a) => (
              <p key={a.clientName} className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
                {a.clientName}: {(a.pct * 100).toFixed(0)}% of the ₱3,000,000 VAT threshold
                {a.pct >= 1 ? " — BREACHED. The 8% option ceases to apply; consult the current BIR issuance." : "."}
              </p>
            ))}
            {electionAlerts.map((c) => (
              <p key={c.id} className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {c.registeredName}: 8% election for TY{currentYear} is{" "}
                {c.taxYears[0]?.electionStatus ?? "not recorded"} — Q1 filings are blocked until confirmed.
              </p>
            ))}
          </div>
        )}
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
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <span className="text-xs text-slate-400">{count}</span>
      </CardHeader>
      <CardBody className="flex flex-col gap-2">{children}</CardBody>
    </Card>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-slate-400">{text}</p>;
}

function FilingRowCard({
  filing,
  stepTitle,
  dueDate,
  aging,
  children,
}: {
  filing: { id: string; clientId: string; taxableYear: number; period: string; client: { registeredName: string } };
  stepTitle: string;
  dueDate: Date;
  aging?: ReturnType<typeof deriveStepAging>;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-slate-200 p-2">
      <div>
        <Link href={`/clients/${filing.clientId}/filings/${filing.id}`} className="text-sm font-medium text-slate-900 hover:underline">
          {filing.client.registeredName} — TY{filing.taxableYear} {filing.period}
        </Link>
        <p className="text-xs text-slate-500">
          {stepTitle} — due {formatManilaDate(dueDate)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {aging && <StatusBadge tone={AGING_BADGE_TONE[aging.tone]}>{aging.daysWaiting}d</StatusBadge>}
        {children}
      </div>
    </div>
  );
}
