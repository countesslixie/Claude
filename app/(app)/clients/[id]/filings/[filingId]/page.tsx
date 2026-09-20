import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { assembleAndComputeFiling, hasSalesRecordedForPeriod } from "@/lib/filingComputation";
import {
  acknowledgeReceiptsComplete,
  setCertificateCutoffOverride,
  acknowledgeAmendmentAlert,
  dismissCompletenessNote,
} from "@/lib/actions/filings";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CopyTextarea } from "@/components/copy-textarea";
import { WorkflowStepCard, type StepCardData } from "@/components/workflow-step-card";
import { WorkflowGroupCard } from "@/components/workflow-group-card";
import { NextActionControl } from "@/components/next-action-control";
import { ComputationSheetPanel } from "@/components/computation-sheet-panel";
import { centsToPesos } from "@/lib/money";
import { formatManilaDate, toManilaDateInputValue } from "@/lib/dates";
import { deriveStepAging } from "@/lib/workflow/aging";
import { countSkippedSteps, filingStatusLabel, currentStepCode } from "@/lib/workflow/status";
import { WORKFLOW_GROUPS, currentGroupCode, summarizeGroup, type GroupStepInput } from "@/lib/workflow/groups";
import { parseDocSlots, type DocSlotDef, type WorkflowStepStatus } from "@/lib/workflow/types";
import { computeFilingCompleteness } from "@/lib/workflow/completeness";
import { buildClientPackageEmail } from "@/lib/workflow/clientPackageEmail";
import { ALL_PERIODS } from "@/lib/tax/periods";
import type { FilingComputationResult } from "@/lib/tax/types";

const CUTOFF_SOURCE_LABEL: Record<string, string> = {
  MANUAL_OVERRIDE: "manual override",
  FILED_AT: "filed date",
  TODAY: "today — live preview, not yet filed",
};

const STATUS_TONE: Record<string, "pending" | "progress" | "waiting" | "overdue" | "done"> = {
  NOT_STARTED: "pending",
  IN_PROGRESS: "progress",
  WAITING_CLIENT: "waiting",
  WAITING_BIR: "waiting",
  BLOCKED: "overdue",
  COMPLETE: "done",
  NA: "pending",
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export default async function FilingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; filingId: string }>;
  searchParams: Promise<{ showSkipped?: string }>;
}) {
  const { id, filingId } = await params;
  const { showSkipped } = await searchParams;
  const filing = await prisma.filing.findUnique({
    where: { id: filingId },
    include: {
      client: true,
      workflowSteps: { orderBy: { sequence: "asc" }, include: { documents: { where: { deletedAt: null } } } },
      amendmentAlerts: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!filing || filing.clientId !== id) notFound();

  const isFrozen = filing.computationSnapshot != null;
  const sheet: FilingComputationResult = isFrozen
    ? (JSON.parse(filing.computationSnapshot as string) as FilingComputationResult)
    : await assembleAndComputeFiling(filing.clientId, filing.taxableYear, filing.period);
  const hasSalesRecorded = await hasSalesRecordedForPeriod(filing.clientId, filing.taxableYear, filing.period);

  // Step 16's email draft needs to know the next filing in this taxable
  // year, if one already exists (rework brief #2 §5) — omitted when there
  // isn't one (e.g. ANNUAL is the last period of its taxable year).
  const nextPeriodIndex = ALL_PERIODS.indexOf(filing.period) + 1;
  const nextPeriod = nextPeriodIndex < ALL_PERIODS.length ? ALL_PERIODS[nextPeriodIndex] : null;
  const nextFiling = nextPeriod
    ? await prisma.filing.findUnique({
        where: { clientId_taxableYear_period: { clientId: filing.clientId, taxableYear: filing.taxableYear, period: nextPeriod } },
      })
    : null;

  const now = new Date();
  const allSteps: StepCardData[] = filing.workflowSteps.map((s) => {
    const aging = deriveStepAging({
      stepCode: s.stepCode,
      status: s.status,
      waitingSince: s.waitingSince,
      expectedResponseDays: s.expectedResponseDays,
      certificatesExpectedBy: filing.certificatesExpectedBy,
      now,
    });
    return {
      id: s.id,
      stepCode: s.stepCode,
      sequence: s.sequence,
      title: s.title,
      description: s.description,
      category: s.category,
      status: s.status,
      isWaitingState: s.isWaitingState,
      waitingOnLabel: s.waitingOnLabel,
      followUpCount: s.followUpCount,
      skippedReason: s.skippedReason,
      requiredDocSlots: parseDocSlots(s.requiredDocSlots),
      documents: s.documents.map((d) => ({
        id: d.id,
        docSlotCode: d.docSlotCode,
        originalFilename: d.originalFilename,
        // toManilaDateInputValue, not toISOString().split("T")[0] -- see
        // the same fix in lib/actions/quarterlySales.ts.
        documentDate: toManilaDateInputValue(d.documentDate),
      })),
      agingDaysWaiting: aging?.daysWaiting ?? null,
      agingTone: aging?.tone ?? null,
    };
  });
  const skippedCount = countSkippedSteps(filing.workflowSteps);
  const hiddenCount = allSteps.filter((s) => s.status === "NA" || s.status === "SKIPPED").length;
  const visibleSteps = showSkipped ? allSteps : allSteps.filter((s) => s.status !== "NA" && s.status !== "SKIPPED");

  // Brief #4a — the sixteen steps wrapped in five groups (lib/workflow/groups.ts).
  // Nothing about what a step does or requires changes here; this only
  // rolls the same per-step data up into a group-level summary for the
  // collapsed card header (progress, what's outstanding, whether "Mark
  // done" is disabled).
  const groupStepInputs: GroupStepInput[] = allSteps.map((s) => ({
    stepCode: s.stepCode,
    status: s.status as WorkflowStepStatus,
    waitingOnLabel: s.waitingOnLabel,
    agingDaysWaiting: s.agingDaysWaiting,
    requiredDocSlots: s.requiredDocSlots,
    documents: s.documents.map((d) => ({ docSlotCode: d.docSlotCode })),
  }));
  const activeGroupCode = currentGroupCode(
    filing.workflowSteps.map((s) => ({ stepCode: s.stepCode, status: s.status })),
  );
  const groupSections = WORKFLOW_GROUPS.map((def) => ({
    def,
    summary: summarizeGroup(def, groupStepInputs),
    steps: visibleSteps.filter((s) => def.stepCodes.includes(s.stepCode)),
  }));

  // §4.2 — the page's primary job: what to do next, in words, with the
  // action adjacent. currentStepCode is the same "earliest unresolved
  // step" logic the board/dashboard use (lib/workflow/status.ts).
  const nextStepCode = currentStepCode(filing.workflowSteps);
  const nextStep = nextStepCode ? allSteps.find((s) => s.stepCode === nextStepCode) : undefined;

  // Step 13 -> 14 (D29) — the one genuine sequencing dependency. Computed
  // once here so both NextActionControl (if step 14 happens to be next)
  // and its checklist card show the same reason.
  const ackStep = filing.workflowSteps.find((s) => s.stepCode === "SAWT_ACK");
  const validationDependencyReason =
    ackStep && ackStep.status !== "DONE" && ackStep.status !== "NA" && ackStep.status !== "SKIPPED"
      ? "Waiting on step 13's acknowledgement email — a validation email can't arrive before it."
      : null;
  const DEPENDENCY_REASON_BY_STEP_CODE: Record<string, string | null> = {
    SAWT_VALIDATION: validationDependencyReason,
  };

  const eafsStep = filing.workflowSteps.find((s) => s.stepCode === "EAFS_SUBMIT");
  const eafsConfirmationSaved = (eafsStep?.documents ?? []).some((d) => d.docSlotCode === "eafs_confirmation");

  // §5.3 — informational "documents not yet attached" note (D27
  // reconciliation, rework brief #2 §7): only DONE/IN_PROGRESS steps, all
  // their empty slots (required or optional) — see lib/workflow/completeness.ts.
  const documentsByStepCode = new Map<string, { docSlotCode: string | null; deletedAt: Date | null }[]>();
  for (const s of filing.workflowSteps) {
    documentsByStepCode.set(
      s.stepCode,
      s.documents.map((d) => ({ docSlotCode: d.docSlotCode, deletedAt: null })),
    );
  }
  const completenessGaps = filing.completenessNoteDismissedAt
    ? []
    : computeFilingCompleteness(
        filing.workflowSteps.map((s) => ({
          stepCode: s.stepCode,
          title: s.title,
          status: s.status,
          requiredDocSlots: parseDocSlots(s.requiredDocSlots) as DocSlotDef[],
        })),
        documentsByStepCode,
      );

  const daysToAdjustedDue = Math.ceil((filing.adjustedDueDate.getTime() - now.getTime()) / MS_PER_DAY);
  const netLabel = !hasSalesRecorded
    ? `No sales recorded for ${filing.period} ${filing.taxableYear}`
    : sheet.isOverpayment
      ? `Overpayment ${centsToPesos(sheet.overpaymentCents, { withSymbol: true })}`
      : `Tax payable ${centsToPesos(sheet.taxPayableCents, { withSymbol: true })}`;

  const incomeHref = `/clients/${id}/income?year=${filing.taxableYear}`;

  const clientFirstName = filing.client.registeredName.trim().split(/\s+/)[0] ?? filing.client.registeredName;
  const clientEmail = buildClientPackageEmail({
    clientRegisteredName: filing.client.registeredName,
    clientFirstName,
    period: filing.period,
    taxableYear: filing.taxableYear,
    filedAt: filing.filedAt,
    grossSalesCents: sheet.cumulativeGrossSalesCents,
    taxDueCents: sheet.incomeTaxDueCents,
    cwtCents: sheet.cumulativeCwtCents,
    isOverpayment: sheet.isOverpayment,
    finalAmountCents: sheet.isOverpayment ? sheet.overpaymentCents : sheet.taxPayableCents,
    hasCertificates: sheet.cumulativeCwtCents > 0,
    eafsConfirmationSaved,
    nextPeriodLabel: nextPeriod,
    nextPeriodDueDate: nextFiling?.adjustedDueDate ?? null,
  });

  async function submitAcknowledgement(formData: FormData) {
    "use server";
    const note = String(formData.get("note") ?? "");
    const sourceNote = String(formData.get("sourceNote") ?? "");
    await acknowledgeReceiptsComplete(filingId, note, sourceNote);
  }

  async function submitAmendmentAck(alertId: string, formData: FormData) {
    "use server";
    const note = String(formData.get("note") ?? "");
    await acknowledgeAmendmentAlert(alertId, note);
  }

  async function submitCutoffOverride(formData: FormData) {
    "use server";
    const date = String(formData.get("cutoffOverride") ?? "");
    await setCertificateCutoffOverride(filingId, date);
  }

  async function clearCutoffOverride() {
    "use server";
    await setCertificateCutoffOverride(filingId, "");
  }

  async function submitDismissCompleteness() {
    "use server";
    await dismissCompletenessNote(filingId);
  }

  // D30 — a document belongs to its step, not to the page. These three
  // used to render as page-level panels at the bottom, detached from the
  // steps they belong to ("Not sure what the bottom boxes are for").
  const recordSalesExtra = (
    <Link href={incomeHref}>
      <Button type="button" size="sm" variant="secondary">
        Go to income entry
      </Button>
    </Link>
  );

  const certificateCutoffExtra = (
    <div className="rounded border border-slate-100 p-2">
      <p className="text-xs font-medium text-slate-600">Certificate cutoff</p>
      <p className="mt-1 text-xs text-slate-600">
        Certificates received on or before{" "}
        <span className="font-medium">
          {sheet.certificateCutoffDate ? formatManilaDate(sheet.certificateCutoffDate) : "—"}
        </span>{" "}
        count toward this quarter&apos;s credit. Ones arriving later go to the next quarter instead — amended
        returns aren&apos;t filed when a certificate shows up late.
        {sheet.certificateCutoffSource && ` (${CUTOFF_SOURCE_LABEL[sheet.certificateCutoffSource]})`}
      </p>
      <form action={submitCutoffOverride} className="mt-2 flex items-end gap-2">
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-slate-400" htmlFor="cutoffOverride">
            Manual override
          </label>
          <Input
            id="cutoffOverride"
            name="cutoffOverride"
            type="date"
            className="h-8 text-xs"
            defaultValue={toManilaDateInputValue(filing.certificateCutoffOverride)}
          />
        </div>
        <Button type="submit" size="sm" variant="secondary">
          Set override
        </Button>
      </form>
      {filing.certificateCutoffOverride && (
        <form action={clearCutoffOverride} className="mt-2">
          <Button type="submit" size="sm" variant="secondary">
            Clear override
          </Button>
        </form>
      )}
    </div>
  );

  const clientConfirmationExtra = (
    <div className="rounded border border-slate-100 p-2">
      <p className="text-xs font-medium text-slate-600">Client confirmation</p>
      {filing.receiptsAcknowledgedAt ? (
        <div className="mt-1">
          <p className="text-xs text-slate-600">Confirmed {formatManilaDate(filing.receiptsAcknowledgedAt)}.</p>
          {filing.receiptsAcknowledgedSourceNote && (
            <p className="mt-0.5 text-xs text-slate-600">Source: {filing.receiptsAcknowledgedSourceNote}</p>
          )}
          {filing.receiptsAcknowledgedNote && (
            <p className="mt-0.5 text-xs text-slate-500">{filing.receiptsAcknowledgedNote}</p>
          )}
        </div>
      ) : (
        <form action={submitAcknowledgement} className="mt-1 flex flex-col gap-2">
          <p className="text-xs text-slate-600">
            Have you confirmed with the client that all receipts for this quarter are accounted for, including
            any without a 2307?
          </p>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-400" htmlFor="sourceNote">
              Where the declared sales figure came from
            </label>
            <Input id="sourceNote" name="sourceNote" className="h-8 text-xs" placeholder="e.g. client's own summary, texted Sept 14" />
          </div>
          <Textarea name="note" placeholder="Optional note" rows={2} className="text-xs" />
          <div>
            <Button type="submit" size="sm">
              Confirm
            </Button>
          </div>
        </form>
      )}
    </div>
  );

  const prepareReturnExtra = (
    <div className="flex flex-col gap-2">
      <ComputationSheetPanel
        breakdown={sheet.breakdown}
        isOverpayment={sheet.isOverpayment}
        overpaymentCents={sheet.overpaymentCents}
        taxPayableCents={sheet.taxPayableCents}
        formType={sheet.formType}
        isFrozen={isFrozen}
        hasSalesRecorded={hasSalesRecorded}
        period={filing.period}
        taxableYear={filing.taxableYear}
        incomeHref={incomeHref}
      />
      {clientConfirmationExtra}
    </div>
  );

  const sendClientPackageExtra = (
    <div className="flex flex-col gap-3">
      <a href={`/api/filings/${filing.id}/package`}>
        <Button type="button" size="sm" variant="secondary">
          Download package
        </Button>
      </a>
      <div>
        <p className="mb-1 text-xs font-medium text-slate-600">Draft email to client</p>
        <p className="mb-1 text-xs text-slate-400">Subject: {clientEmail.subject}</p>
        <CopyTextarea defaultValue={clientEmail.body} />
      </div>
    </div>
  );

  const EXTRA_BY_STEP_CODE: Record<string, React.ReactNode> = {
    RECORD_SALES: recordSalesExtra,
    RECEIVE_2307: certificateCutoffExtra,
    PREPARE_RETURN: prepareReturnExtra,
    SEND_CLIENT_PACKAGE: sendClientPackageExtra,
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-2 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900">
              {filing.client.registeredName} — TY{filing.taxableYear} {filing.period}
            </h1>
            <StatusBadge tone={STATUS_TONE[filing.status] ?? "pending"}>
              {filingStatusLabel(filing.status, skippedCount)}
            </StatusBadge>
          </div>
          <details className="mt-0.5 text-sm text-slate-500">
            <summary className="inline cursor-pointer list-none marker:hidden">
              {filing.formType} — due {formatManilaDate(filing.adjustedDueDate)}
              <span className="ml-1 text-xs text-slate-400">(details)</span>
            </summary>
            <div className="mt-1 text-xs text-slate-400">
              {filing.statutoryDueDate.getTime() !== filing.adjustedDueDate.getTime() && (
                <p>
                  Statutory due date {formatManilaDate(filing.statutoryDueDate)}, shifted for weekend/holiday.
                </p>
              )}
              {(filing.certificatesExpectedBy || filing.internalFilingTarget) && (
                <p>
                  Working calendar — certificates expected by {formatManilaDate(filing.certificatesExpectedBy)},
                  filing target {formatManilaDate(filing.internalFilingTarget)} (practice targets, not the
                  statutory deadline).
                </p>
              )}
            </div>
          </details>
        </div>
        <Link href={`/clients/${id}`}>
          <Button variant="secondary" size="sm">
            Back to client
          </Button>
        </Link>
      </div>

      {/* §4.2 — the page's primary job. If the bookkeeper reads only one thing here, this is it. */}
      <Card className="mb-3 border-slate-300 bg-slate-50">
        <CardBody className="py-3">
          {nextStep ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium text-slate-900">
                Next: Step {nextStep.sequence} of {allSteps.length} — {nextStep.title}
              </p>
              <NextActionControl
                stepId={nextStep.id}
                status={nextStep.status}
                requiredDocSlots={nextStep.requiredDocSlots}
                documents={nextStep.documents}
                dependencyBlockedReason={DEPENDENCY_REASON_BY_STEP_CODE[nextStep.stepCode] ?? null}
              />
            </div>
          ) : (
            <p className="text-sm font-medium text-emerald-700">
              All 16 steps resolved — nothing left to do on this filing.
            </p>
          )}
        </CardBody>
      </Card>

      {/* §4.2 — compact summary strip: one row, no explanatory prose. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
        <span className="font-medium text-slate-900">{netLabel}</span>
        <span className="text-slate-300">·</span>
        <span className="text-slate-600">
          {daysToAdjustedDue >= 0
            ? `${daysToAdjustedDue}d to adjusted due date`
            : `${Math.abs(daysToAdjustedDue)}d past adjusted due date`}
        </span>
        <span className="text-slate-300">·</span>
        <StatusBadge tone={STATUS_TONE[filing.status] ?? "pending"}>
          {filingStatusLabel(filing.status, skippedCount)}
        </StatusBadge>
      </div>

      {completenessGaps.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-amber-900">
                {completenessGaps.length} document{completenessGaps.length === 1 ? "" : "s"} not yet attached
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {completenessGaps.map((g, i) => (
                  <li key={i} className="text-xs text-amber-800">
                    {g.stepTitle}: {g.slotLabel}
                  </li>
                ))}
              </ul>
            </div>
            <form action={submitDismissCompleteness}>
              <Button type="submit" size="sm" variant="ghost">
                Dismiss
              </Button>
            </form>
          </div>
        </div>
      )}

      {filing.amendmentAlerts.length > 0 && (
        <Card className="mb-3 border-amber-300">
          <CardHeader>
            <h2 className="text-sm font-semibold text-amber-900">
              Amendment alerts ({filing.amendmentAlerts.length})
            </h2>
          </CardHeader>
          <CardBody>
            <p className="mb-3 text-xs text-slate-500">
              Declared sales changed after this filing was frozen. The computation sheet below still shows
              exactly what was filed — it was never rewritten. You decide whether to amend.
            </p>
            <div className="flex flex-col gap-3">
              {filing.amendmentAlerts.map((alert) => (
                <div key={alert.id} className="rounded-md border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm text-amber-900">{alert.reason}</p>
                  <p className="mt-1 text-sm font-medium text-amber-900">
                    Delta: {alert.deltaCents >= 0 ? "+" : ""}
                    {centsToPesos(alert.deltaCents, { withSymbol: true })}
                  </p>
                  <p className="text-xs text-slate-500">Raised {formatManilaDate(alert.createdAt)}</p>
                  {alert.acknowledgedAt ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Acknowledged {formatManilaDate(alert.acknowledgedAt)}
                      {alert.acknowledgedNote ? ` — ${alert.acknowledgedNote}` : ""}
                    </p>
                  ) : (
                    <form action={submitAmendmentAck.bind(null, alert.id)} className="mt-2 flex items-end gap-2">
                      <Textarea name="note" placeholder="Optional note" rows={1} className="flex-1" />
                      <Button type="submit" size="sm" variant="secondary">
                        Acknowledge
                      </Button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Brief #4a — the sixteen steps wrapped in five groups: one "Mark
          done" per group instead of one per step. Opening a group still
          exposes every per-step control that existed before grouping. */}
      <Card id="checklist" className="mb-3">
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Workflow ({visibleSteps.length}/{allSteps.length} steps shown)</h2>
          <div className="flex items-center gap-3">
            <a
              href={`/api/filings/${filing.id}/package`}
              className="text-xs text-slate-600 underline hover:text-slate-900"
            >
              Download period package
            </a>
            {hiddenCount > 0 && (
              <Link
                href={
                  showSkipped
                    ? `/clients/${id}/filings/${filingId}`
                    : `/clients/${id}/filings/${filingId}?showSkipped=1`
                }
                className="text-xs text-slate-600 underline hover:text-slate-900"
              >
                {showSkipped ? "Hide skipped/NA" : `Show ${hiddenCount} skipped/NA`}
              </Link>
            )}
          </div>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col gap-2">
            {groupSections.map(({ def, summary, steps }) => (
              <WorkflowGroupCard
                key={def.code}
                filingId={filing.id}
                groupCode={def.code}
                name={def.name}
                doneCount={summary.doneCount}
                totalCount={summary.totalCount}
                isComplete={summary.isComplete}
                blockReason={summary.blockReason}
                outstandingLabel={summary.outstandingLabel}
                defaultOpen={def.code === activeGroupCode}
              >
                {steps.map((step) => (
                  <WorkflowStepCard
                    key={step.id}
                    step={step}
                    extra={EXTRA_BY_STEP_CODE[step.stepCode]}
                    dependencyBlockedReason={DEPENDENCY_REASON_BY_STEP_CODE[step.stepCode] ?? null}
                  />
                ))}
              </WorkflowGroupCard>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
