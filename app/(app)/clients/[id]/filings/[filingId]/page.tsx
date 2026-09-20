import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { assembleAndComputeFiling, hasSalesRecordedForPeriod } from "@/lib/filingComputation";
import {
  acknowledgeReceiptsComplete,
  setCertificateCutoffOverride,
  acknowledgeAmendmentAlert,
} from "@/lib/actions/filings";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CopyTextarea } from "@/components/copy-textarea";
import { WorkflowStepCard, type StepCardData } from "@/components/workflow-step-card";
import { centsToPesos } from "@/lib/money";
import { formatManilaDate, toManilaDateInputValue } from "@/lib/dates";
import { deriveStepAging } from "@/lib/workflow/aging";
import { countSkippedSteps, filingStatusLabel } from "@/lib/workflow/status";
import { parseDocSlots, type DocSlotDef } from "@/lib/workflow/types";
import { emptySlots } from "@/lib/workflow/docSlots";
import { buildClientPackageEmail } from "@/lib/workflow/clientPackageEmail";
import { ALL_PERIODS, periodToQuarters } from "@/lib/tax/periods";
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
        // the same fix in lib/actions/salesTransactions.ts.
        documentDate: toManilaDateInputValue(d.documentDate),
      })),
      agingDaysWaiting: aging?.daysWaiting ?? null,
      agingTone: aging?.tone ?? null,
    };
  });
  const skippedCount = countSkippedSteps(filing.workflowSteps);
  const hiddenCount = allSteps.filter((s) => s.status === "NA" || s.status === "SKIPPED").length;
  const visibleSteps = showSkipped ? allSteps : allSteps.filter((s) => s.status !== "NA" && s.status !== "SKIPPED");

  // "N documents not yet attached" (rework brief #2 §7): only what's DONE
  // or IN_PROGRESS, not the whole quarter's eventual paperwork — empty on
  // a filing that hasn't started, filling in as she works.
  const notYetAttached: Array<{ stepTitle: string; slot: DocSlotDef }> = [];
  for (const s of filing.workflowSteps) {
    if (s.status !== "DONE" && s.status !== "IN_PROGRESS") continue;
    for (const slot of emptySlots(parseDocSlots(s.requiredDocSlots), s.documents)) {
      notYetAttached.push({ stepTitle: s.title, slot });
    }
  }

  const ackStep = filing.workflowSteps.find((s) => s.stepCode === "SAWT_ACK");
  const validationDependencyReason =
    ackStep && ackStep.status !== "DONE" && ackStep.status !== "NA" && ackStep.status !== "SKIPPED"
      ? "Waiting on step 13's acknowledgement email — a validation email can't arrive before it."
      : null;

  const eafsStep = filing.workflowSteps.find((s) => s.stepCode === "EAFS_SUBMIT");
  const eafsConfirmationSaved = (eafsStep?.documents ?? []).some((d) => d.docSlotCode === "eafs_confirmation");

  const salesEntryQuarter = periodToQuarters(filing.period)[0];
  const salesEntryHref =
    filing.period === "ANNUAL"
      ? `/clients/${id}/transactions?year=${filing.taxableYear}`
      : `/clients/${id}/transactions?year=${filing.taxableYear}&quarter=${salesEntryQuarter}`;

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
    await acknowledgeReceiptsComplete(filingId, note);
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

  const computationSheetExtra = (
    <details className="rounded border border-slate-100 p-2">
      <summary className="cursor-pointer text-xs font-medium text-slate-600">
        Computation sheet{isFrozen ? " (frozen — as filed)" : " (live preview)"} —{" "}
        {hasSalesRecorded
          ? sheet.isOverpayment
            ? `Overpayment ${centsToPesos(sheet.overpaymentCents, { withSymbol: true })}`
            : `Tax payable ${centsToPesos(sheet.taxPayableCents, { withSymbol: true })}`
          : `No sales recorded for ${filing.period} ${filing.taxableYear}`}
      </summary>
      <div className="mt-2">
        {!hasSalesRecorded && (
          <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
            No sales recorded for {filing.period} {filing.taxableYear} — enter the client&apos;s declared figure
            to compute.{" "}
            <Link href={salesEntryHref} className="underline">
              Record quarterly sales
            </Link>
            .
          </p>
        )}
        <table className="data-table">
          <tbody>
            {sheet.breakdown.map((line) => (
              <tr key={line.label}>
                <td className="w-1/2">{line.label}</td>
                <td className="w-1/4 text-right font-mono">
                  {centsToPesos(line.amountCents, { withSymbol: true })}
                </td>
                <td className="text-xs text-slate-400">{line.sourceNote}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-400">
          Form {sheet.formType}. This is a preparation aid; the filed return and BIR&apos;s own assessment
          govern.
        </p>
      </div>
    </details>
  );

  const clientConfirmationExtra = (
    <div className="rounded border border-slate-100 p-2">
      <p className="text-xs font-medium text-slate-600">Client confirmation</p>
      {filing.receiptsAcknowledgedAt ? (
        <div className="mt-1">
          <p className="text-xs text-slate-600">Confirmed {formatManilaDate(filing.receiptsAcknowledgedAt)}.</p>
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
      {computationSheetExtra}
      {clientConfirmationExtra}
    </div>
  );

  const recordSalesExtra = (
    <Link href={salesEntryHref}>
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

  const DEPENDENCY_REASON_BY_STEP_CODE: Record<string, string | null> = {
    SAWT_VALIDATION: validationDependencyReason,
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900">
              {filing.client.registeredName} — TY{filing.taxableYear} {filing.period}
            </h1>
            <StatusBadge tone={STATUS_TONE[filing.status] ?? "pending"}>
              {filingStatusLabel(filing.status, skippedCount)}
            </StatusBadge>
          </div>
          <p className="text-sm text-slate-500">
            {filing.formType} — due {formatManilaDate(filing.adjustedDueDate)}
            {filing.statutoryDueDate.getTime() !== filing.adjustedDueDate.getTime() &&
              ` (statutory ${formatManilaDate(filing.statutoryDueDate)}, shifted for weekend/holiday)`}
          </p>
          {(filing.certificatesExpectedBy || filing.internalFilingTarget) && (
            <p className="text-xs text-slate-400">
              Working calendar — certificates expected by {formatManilaDate(filing.certificatesExpectedBy)},
              filing target {formatManilaDate(filing.internalFilingTarget)} (practice targets, not the
              statutory deadline above)
            </p>
          )}
        </div>
        <Link href={`/clients/${id}`}>
          <Button variant="secondary" size="sm">
            Back to client
          </Button>
        </Link>
      </div>

      {filing.amendmentAlerts.length > 0 && (
        <Card className="mt-4 border-amber-300">
          <CardHeader>
            <h2 className="text-sm font-semibold text-amber-900">
              Amendment alerts ({filing.amendmentAlerts.length})
            </h2>
          </CardHeader>
          <CardBody>
            <p className="mb-3 text-xs text-slate-500">
              A transaction changed after this filing was frozen. The computation sheet above still shows
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

      <Card className="mt-4">
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Workflow ({visibleSteps.length}/16 steps shown)</h2>
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
          {notYetAttached.length > 0 && (
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2">
              <p className="text-xs font-medium text-amber-800">
                {notYetAttached.length} document{notYetAttached.length === 1 ? "" : "s"} not yet attached
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {notYetAttached.map((item, i) => (
                  <li key={i} className="text-xs text-amber-800">
                    {item.stepTitle} — {item.slot.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {visibleSteps.map((step) => (
              <WorkflowStepCard
                key={step.id}
                step={step}
                extra={EXTRA_BY_STEP_CODE[step.stepCode]}
                dependencyBlockedReason={DEPENDENCY_REASON_BY_STEP_CODE[step.stepCode] ?? null}
              />
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
