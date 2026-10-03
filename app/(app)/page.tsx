import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getLastBackupAt, backupReminderText } from "@/lib/backup/lastBackup";
import { currentTaxableYearManila } from "@/lib/dates";
import { nextActionForFiling, BIR_WAIT_STEP_CODES } from "@/lib/workflow/groups";
import { deriveStepAging } from "@/lib/workflow/aging";
import { stepDueDate } from "@/lib/workflow/dueDate";
import { cumulativeGrossForThreshold } from "@/lib/vatThreshold";
import { clientWaitDueDate, periodHasEnded } from "@/lib/workflow/clientWait";
import { DASHBOARD_SECTIONS, sortByDueThenClient } from "@/lib/workflow/dashboardRows";
import { DashboardSection } from "@/components/dashboard-section";
import {
  AlertsTable,
  FilingRowsTable,
  type AlertRow,
  type FilingTableRow,
} from "@/components/dashboard-tables";
import type { Period } from "@/lib/tax/types";

/**
 * Dashboard (SPEC.md §11.1) — "where am I?" in under 10 seconds. Four
 * collapsible sections (D126/D137, lib/workflow/dashboardRows.ts): needs my action,
 * waiting on client, waiting on BIR, 3M threshold alert.
 */
// D173 — the backup reminder depends on the current time, so this page is never prerendered.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const now = new Date();
  const currentYear = currentTaxableYearManila();
  const backupReminder = backupReminderText(await getLastBackupAt(), now);

  const activeFilings = await prisma.filing.findMany({
    where: { deletedAt: null, filedOutsideApp: false, status: { not: "COMPLETE" } },
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

  for (const filing of activeFilings) {
    // D74 (brief #5m §2) — "Needs my action" / "Waiting on client" pick
    // their one representative step by GROUP order, the same rule the
    // board uses (lib/workflow/groups.ts's currentGroupCode), not by raw
    // step number. Before this fix, a filing whose only open work was a
    // BIR wait far EARLIER in raw sequence (step 10) than an unresolved
    // step in an earlier GROUP (e.g. step 11) would pick step 10 here —
    // wrong, since group order says the earlier group's own step 11 is
    // what she needs to act on first.
    // D84 (brief #5o) — the same "Next" helper as the filing page's banner and bar:
    // her next piece of work, skipping locked steps and BIR waits (those list below).
    const next = nextActionForFiling(filing.workflowSteps);
    const step = next.kind === "work" ? filing.workflowSteps.find((s) => s.stepCode === next.stepCode) : undefined;

    if (step) {
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

      if (step.status === "WAITING_EXTERNAL" && step.waitingOnLabel === "Client") {
        const aging = deriveStepAging({
          stepCode: step.stepCode,
          status: step.status,
          waitingSince: step.waitingSince,
          expectedResponseDays: step.expectedResponseDays,
          certificatesExpectedBy: filing.certificatesExpectedBy,
          now,
        });
        // D130 — a filing waits on the client only once its period has ended, and its
        // Due is the date the client's documents are due, not step-clock arithmetic.
        if (periodHasEnded(filing.taxableYear, filing.period as Period, now)) {
          waitingClient.push({ filing, step, aging, dueDate: clientWaitDueDate(filing.certificatesExpectedBy, dueDate) });
        }
      } else if (step.status === "PENDING" || step.status === "IN_PROGRESS") {
        needsAction.push({ filing, step, aging: null, dueDate });
      }

    }

    // D74 — "Waiting on BIR" lists every step 10/13/14 currently
    // WAITING_EXTERNAL on this filing, independent of the representative
    // step picked above: a filing can show here for step 10 waiting AND
    // separately in "Needs my action" for an earlier group's own next
    // step (her own explicit intent, not a bug — the same filing needing
    // two different things at once).
    for (const birStep of filing.workflowSteps.filter(
      (s) => BIR_WAIT_STEP_CODES.includes(s.stepCode) && s.status === "WAITING_EXTERNAL",
    )) {
      const aging = deriveStepAging({
        stepCode: birStep.stepCode,
        status: birStep.status,
        waitingSince: birStep.waitingSince,
        expectedResponseDays: birStep.expectedResponseDays,
        certificatesExpectedBy: filing.certificatesExpectedBy,
        now,
      });
      const dueDate = stepDueDate({
        stepCode: birStep.stepCode,
        status: birStep.status,
        waitingSince: birStep.waitingSince,
        expectedResponseDays: birStep.expectedResponseDays,
        certificatesExpectedBy: filing.certificatesExpectedBy,
        internalFilingTarget: filing.internalFilingTarget,
        adjustedDueDate: filing.adjustedDueDate,
      });
      waitingBir.push({ filing, step: birStep, aging, dueDate });
    }
  }

  const [ruleSet, activeClients] = await Promise.all([
    prisma.taxRuleSet.findUnique({ where: { taxableYear: currentYear } }),
    prisma.client.findMany({ where: { isActive: true } }),
  ]);

  const thresholdAlerts: Array<{ clientName: string; pct: number }> = [];
  if (ruleSet) {
    for (const client of activeClients) {
      // Brief #5f §8 — includes a mid-year client's starting cumulative
      // income: she can already be close to the VAT threshold before the
      // app ever saw a peso of hers.
      const cumulativeGross = await cumulativeGrossForThreshold(client.id, currentYear);
      const pct = cumulativeGross / ruleSet.vatThresholdCents;
      if (pct >= 0.8) thresholdAlerts.push({ clientName: client.registeredName, pct });
    }
  }

  const rowHref = (filingId: string, clientId: string) => `/clients/${clientId}/filings/${filingId}`;

  const toRow = (r: Row, id: string): FilingTableRow => ({
    id,
    href: rowHref(r.filing.id, r.filing.clientId),
    clientName: r.filing.client.registeredName,
    taxableYear: r.filing.taxableYear,
    period: r.filing.period,
    stepCode: r.step.stepCode,
    stepTitle: r.step.title,
    dueDate: r.dueDate,
    aging: r.aging,
  });

  // D72 — no Log follow-up on any BIR wait. D128 — and none on the dashboard at all.
  // `id` is per (filing, step): D74 can list more than one BIR-waiting step for the same filing.
  const needsActionRows = sortByDueThenClient(needsAction.map((r) => toRow(r, r.filing.id)));
  const waitingClientRows = sortByDueThenClient(waitingClient.map((r) => toRow(r, r.filing.id)));
  const waitingBirRows = sortByDueThenClient(waitingBir.map((r) => toRow(r, `${r.filing.id}-${r.step.stepCode}`)));

  const alertRows: AlertRow[] = [
    ...thresholdAlerts.map((a) => ({
      id: `threshold-${a.clientName}`,
      clientName: a.clientName,
      taxableYear: currentYear,
      tone: "red" as const,
      text: `${(a.pct * 100).toFixed(0)}% of the ₱3,000,000 VAT threshold${
        a.pct >= 1 ? " — BREACHED. The 8% option ceases to apply; consult the current BIR issuance." : "."
      }`,
    })),
  ].sort((a, b) => a.clientName.localeCompare(b.clientName));

  const sections: Record<(typeof DASHBOARD_SECTIONS)[number], { count: number; body: React.ReactNode }> = {
    "Needs my action now": { count: needsActionRows.length, body: <FilingRowsTable rows={needsActionRows} /> },
    "Waiting on client": { count: waitingClientRows.length, body: <FilingRowsTable rows={waitingClientRows} /> },
    "Waiting on BIR": { count: waitingBirRows.length, body: <FilingRowsTable rows={waitingBirRows} /> },
    "3M Threshold Alert": { count: alertRows.length, body: <AlertsTable rows={alertRows} /> },
  };

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-3">
      <h1 className="text-2xl font-semibold text-ink">Dashboard</h1>
      {backupReminder && (
        <p className="text-sm text-amber" data-testid="backup-reminder">
          {backupReminder} —{" "}
          <Link href="/settings" className="underline">
            back up now
          </Link>
        </p>
      )}
      {DASHBOARD_SECTIONS.map((title) => (
        <DashboardSection key={title} title={title} count={sections[title].count}>
          {sections[title].body}
        </DashboardSection>
      ))}
    </div>
  );
}
