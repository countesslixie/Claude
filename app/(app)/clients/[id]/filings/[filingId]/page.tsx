import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  readFilingSheet,
  hasSalesRecordedForPeriod,
  effectiveOtherCreditsFor,
  isPaymentLocked,
} from "@/lib/filingComputation";
import {
  setAllCertificatesReceived,
  acknowledgeAmendmentAlert,
  dismissCompletenessNote,
  updateFilingOtherCredits,
  savePayment,
} from "@/lib/actions/filings";
import { addCertificate } from "@/lib/actions/form2307";
import { listActivePayors, createPayorInline, fillPayorDetail } from "@/lib/actions/payors";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AdviceMessageCard } from "@/components/advice-message-card";
import { WorkflowStepCard, type StepCardData } from "@/components/workflow-step-card";
import { WorkflowGroupCard } from "@/components/workflow-group-card";
import { RecordSalesStepCard } from "@/components/record-sales-step-card";
import { Receive2307StepCard, type CertificateRow } from "@/components/receive-2307-step-card";
import { FileGroupDocStepCard } from "@/components/file-group-doc-step-card";
import { EmailDatStepCard } from "@/components/email-dat-step-card";
import { MakePaymentStepCard } from "@/components/make-payment-step-card";
import { loadFilingOrderContext } from "@/lib/workflow/filingOrderData";
import { filingOrderBlockReason, firstUnfiledEarlierPeriod } from "@/lib/workflow/filingOrder";
import { NextActionControl } from "@/components/next-action-control";
import { FilingStickyBar } from "@/components/filing-sticky-bar";
import { ComputationSheetPanel } from "@/components/computation-sheet-panel";
import { OtherCreditsForm } from "@/components/other-credits-form";
import { centsToPesos } from "@/lib/money";
import { formatManilaDate, toManilaDateInputValue } from "@/lib/dates";
import { deriveStepAging, BIR_WAIT_SHORT_NAME } from "@/lib/workflow/aging";
import { countSkippedSteps, filingStatusLabel } from "@/lib/workflow/status";
import {
  WORKFLOW_GROUPS,
  currentGroupCode,
  summarizeGroup,
  prepareGroupBlockReason,
  adviseClientBlockReason,
  nextActionModeForStepCode,
  nextActionForFiling,
  stepLockReason,
  nothingToPayLabel,
  type GroupStepInput,
} from "@/lib/workflow/groups";
import { parseDocSlots, type DocSlotDef, type WorkflowStepStatus } from "@/lib/workflow/types";
import { computeFilingCompleteness } from "@/lib/workflow/completeness";
import { buildESubmissionEmail } from "@/lib/workflow/eSubmissionEmail";
import { buildClientPackageEmailForFiling } from "@/lib/workflow/clientPackageEmailData";
import { ClientPackageStepCard } from "@/components/client-package-step-card";
import { buildLiveAdviceMessageForFiling } from "@/lib/workflow/adviceMessage";
import { ownSalesQuarterOf, periodToSingleQuarterCovered, quarterNumberDateRange } from "@/lib/tax/periods";
import { changedItems } from "@/lib/tax/amendment";
import type { FilingComputationResult } from "@/lib/tax/types";

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
  // D83 — the frozen return once filed, live before; the one reader of a filing's own figures.
  const sheet: FilingComputationResult = await readFilingSheet(filing);
  const hasSalesRecorded = await hasSalesRecordedForPeriod(filing.clientId, filing.taxableYear, filing.period);

  // Brief #4b — step 1's own card shows this filing's own quarter total
  // once saved (draft or final), not the cumulative figure above.
  const ownSalesRow = await prisma.quarterlySales.findUnique({
    where: {
      clientId_taxableYear_quarter: { clientId: filing.clientId, taxableYear: filing.taxableYear, quarter: ownSalesQuarterOf(filing.period) },
    },
  });

  // Brief #4b (D34) — a filing is "filed" for locking purposes once its
  // own step 5 (FILE_RETURN) is DONE: the income quarter and step 2's
  // certificate list both lock at that point.
  const isFilingLocked = filing.workflowSteps.some((s) => s.stepCode === "FILE_RETURN" && s.status === "DONE");

  // D75 (brief #5m §3.1) — Pay (steps 8, 9) opens only once File (5, 6,
  // 7) is Done. D75 §3.3 — step 9 unlocks once step 8 (MAKE_PAYMENT) is
  // Done specifically.
  const isFileGroupDone = ["FILE_RETURN", "SAVE_SUBMISSION_SS", "SAVE_FORM_COPY"].every(
    (code) => filing.workflowSteps.find((s) => s.stepCode === code)?.status === "DONE",
  );
  const makePaymentStep = filing.workflowSteps.find((s) => s.stepCode === "MAKE_PAYMENT");
  const isStep8Done = makePaymentStep?.status === "DONE";
  const boundSavePayment = savePayment.bind(null, filing.id);
  const paymentLocked = await isPaymentLocked(filing.clientId, filing.taxableYear, filing.period);
  const previousChannels = (
    await prisma.filing.findMany({
      where: { clientId: filing.clientId, paymentChannel: { not: null } },
      select: { paymentChannel: true },
      distinct: ["paymentChannel"],
    })
  )
    .map((f) => f.paymentChannel as string)
    .sort();

  // Brief #4b — step 2's certificate rows, entered under this filing.
  // Brief #4d — ordered by payor rather than dateReceived (removed).
  const certificates = await prisma.form2307.findMany({
    where: { claimedOnFilingId: filing.id, deletedAt: null },
    include: { documents: { where: { deletedAt: null } } },
    orderBy: [{ payorName: "asc" }, { payorTin: "asc" }],
  });
  const certificateRows: CertificateRow[] = certificates.map((c) => ({
    id: c.id,
    payorName: c.payorName,
    payorTin: c.payorTin,
    payorAddress: c.payorAddress,
    incomePaymentCents: c.incomePaymentCents,
    taxWithheldCents: c.taxWithheldCents,
    atcCode: c.atcCode,
    withholdingRateBps: c.withholdingRateBps,
    rateOverridden: c.rateOverridden,
    periodFrom: formatManilaDate(c.periodFrom),
    periodTo: formatManilaDate(c.periodTo),
    notes: c.notes,
    scans: c.documents.map((d) => ({ id: d.id, originalFilename: d.originalFilename })),
  }));
  const boundAddCertificate = addCertificate.bind(null, filing.id);
  const boundToggleAllReceived = setAllCertificatesReceived.bind(null, filing.id);
  const boundSaveNewPayor = createPayorInline.bind(null, filing.clientId);
  const boundFillPayorDetail = fillPayorDetail.bind(null, filing.clientId);

  // Brief #5a — step 2's payor picker and the certificate form's ATC
  // picker both read the client's saved lists; the ATC list also gates
  // whether a certificate can be saved at all (required, D19: never
  // invent a code).
  const [payors, activeAtcCodes] = await Promise.all([
    listActivePayors(filing.clientId),
    prisma.atcCode.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
  ]);

  // Brief #4c — "Period covered" pre-fills with this filing's own
  // quarter, the same range addCertificate falls back to if it were ever
  // left blank (it no longer can be — see lib/validation/form2307.ts).
  const defaultCertificatePeriod = quarterNumberDateRange(filing.taxableYear, periodToSingleQuarterCovered(filing.period));

  const ruleSetForEmail = await prisma.taxRuleSet.findUnique({ where: { taxableYear: filing.taxableYear } });

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
  // Brief #5i §1 — a Skipped step is a decision she made, not a step that
  // doesn't apply, so it's never hidden like an NA one: it renders in its
  // group, in step order, always. Only NA steps are optionally hidden now
  // (the `showSkipped` query param/toggle is kept, doing narrower work —
  // see the "Show N not applicable" link below).
  const naCount = allSteps.filter((s) => s.status === "NA").length;
  const visibleSteps = showSkipped ? allSteps : allSteps.filter((s) => s.status !== "NA");

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
  // D84 (brief #5o) — "Next" is her next piece of work, by group order, skipping
  // locked steps and steps waiting on BIR; the banner and the slim bar share it
  // (and the dashboard's "Needs my action" uses the same helper).
  // D95 (brief #5q) — the filing-order guard: step 5 is locked while an earlier
  // return of this client-year is unfiled. Next still names step 5, with the
  // reason and a link to the earlier filing.
  const filingOrderContext = await loadFilingOrderContext(filing);
  const filingOrderReason = filingOrderBlockReason(filingOrderContext);
  const earlierUnfiledPeriod = firstUnfiledEarlierPeriod(filingOrderContext);
  const earlierUnfiledFilingId = earlierUnfiledPeriod
    ? (filingOrderContext.siblings.find((s) => s.period === earlierUnfiledPeriod)?.id ?? null)
    : null;
  const nextAction = nextActionForFiling(filing.workflowSteps, filingOrderReason);
  const nextStep = nextAction.kind === "work" ? allSteps.find((s) => s.stepCode === nextAction.stepCode) : undefined;
  const birWaitText =
    nextAction.kind === "birWait"
      ? `waiting on BIR — ${nextAction.stepCodes
          .map((code) => {
            const days = allSteps.find((s) => s.stepCode === code)?.agingDaysWaiting;
            return `${BIR_WAIT_SHORT_NAME[code]}${days != null ? `, ${days}d` : ""}`;
          })
          .join(" · ")}`
      : null;

  // Step 13 -> 14 (D29) — the one genuine sequencing dependency. Computed
  // once here so both NextActionControl (if step 14 happens to be next)
  // and its checklist card show the same reason.
  const ackStep = filing.workflowSteps.find((s) => s.stepCode === "SAWT_ACK");
  const validationDependencyReason =
    ackStep && ackStep.status !== "DONE" && ackStep.status !== "NA" && ackStep.status !== "SKIPPED"
      ? "Waiting on step 13's acknowledgement email — a validation email can't arrive before it."
      : null;
  // Brief #4c fix — step 3's own "Mark done" button needs the same
  // steps-1/2 gate as Prepare's group-level button (brief #4b), so it
  // can't be clicked directly to bypass it.
  const prepareBlockReason = prepareGroupBlockReason(
    filing.workflowSteps.map((s) => ({ stepCode: s.stepCode, status: s.status })),
  );
  // Brief #5e §1 — step 4's own "Mark done" needs the same step-3 gate
  // markStepDone enforces server-side, so it can't be clicked while the
  // return isn't prepared yet.
  const adviseBlockReason = adviseClientBlockReason(
    filing.workflowSteps.map((s) => ({ stepCode: s.stepCode, status: s.status })),
  );
  const DEPENDENCY_REASON_BY_STEP_CODE: Record<string, string | null> = {
    SAWT_VALIDATION: validationDependencyReason,
    PREPARE_RETURN: prepareBlockReason,
    ADVISE_CLIENT: adviseBlockReason,
    // D100 (brief #5r) — Prepare's reason wins over the filing-order reason when both apply.
    FILE_RETURN: stepLockReason("FILE_RETURN", filing.workflowSteps, filingOrderReason),
  };


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

  const incomeHref = `/clients/${id}/income?filingId=${filing.id}`;

  // D76 (brief #5m §3.4) — Pay's own "Nothing to pay" header line, shown
  // alongside the green Done pill once steps 8/9 both resolve to NA
  // (lib/actions/workflowSteps.ts's markStepDone sets this the instant
  // step 5 is marked Done — see D76's own comment there). This needs the
  // filing's own computed amount, which lib/workflow/groups.ts's
  // summarizeGroup never reads (it stays pure/step-status-only), so it's
  // built here instead and passed to the Pay group's own WorkflowGroupCard
  // as an override.
  const payStep8Status = filing.workflowSteps.find((s) => s.stepCode === "MAKE_PAYMENT")?.status;
  const payStep9Status = filing.workflowSteps.find((s) => s.stepCode === "SAVE_PROOF_PAYMENT")?.status;
  const payNothingToPayLabel =
    payStep8Status === "NA" && payStep9Status === "NA" ? nothingToPayLabel(sheet.isOverpayment, sheet.overpaymentCents) : null;

  // Brief #5d — the sheet's shape now depends on formType (1701Q/1701A get
  // the new item-numbered result, MIXED_INCOME's 1701 keeps the old
  // cumulative one); extractFormSummary normalizes the figures either
  // shape needs for a client-facing message, including a pre-#5d frozen
  // snapshot that predates the new shape despite sharing a formType.
  // D102 (brief #5r) — step 16's email is built from the frozen sheet and
  // the package's own document list (lib/workflow/clientPackageEmailData.ts),
  // the same builder markStepDone uses to save it.
  const clientEmail = await buildClientPackageEmailForFiling(filing.id);

  // Item 55 (brief #5f §4) — display-only on step 3, still stored on
  // ClientTaxYear, entered only via the starting figures page.
  const clientTaxYear = await prisma.clientTaxYear.findUnique({
    where: { clientId_taxableYear: { clientId: filing.clientId, taxableYear: filing.taxableYear } },
  });

  // Brief #5f §1/§5 — step 4 (ADVISE_CLIENT) shows nothing (no message, no
  // Copy button, no hover text) until step 3 (PREPARE_RETURN) is Done.
  const prepareReturnStepStatus = filing.workflowSteps.find((s) => s.stepCode === "PREPARE_RETURN")?.status;
  const isPrepareReturnDone = prepareReturnStepStatus === "DONE";

  // Step 4's client advice message (brief #5d §8, wording/date brief #5e
  // §9). Brief #5e §3 — once step 4 is Done, the message shown is the
  // exact text saved at that moment (Filing.adviceMessageSubject/Body),
  // never rebuilt from since-changed figures; while step 4 is still
  // PENDING (including right after reopening clears the saved text), it's
  // the live preview, built fresh from the current figures.
  const adviseClientStep = filing.workflowSteps.find((s) => s.stepCode === "ADVISE_CLIENT");
  const isAdviseClientDone = adviseClientStep?.status === "DONE";
  const adviceMessage = isPrepareReturnDone
    ? isAdviseClientDone && filing.adviceMessageSubject && filing.adviceMessageBody
      ? { subject: filing.adviceMessageSubject, body: filing.adviceMessageBody }
      : await buildLiveAdviceMessageForFiling(filing.id)
    : null;

  async function submitAmendmentAck(alertId: string, formData: FormData) {
    "use server";
    const note = String(formData.get("note") ?? "");
    await acknowledgeAmendmentAlert(alertId, note);
  }

  async function submitDismissCompleteness() {
    "use server";
    await dismissCompletenessNote(filingId);
  }

  // Brief #5f §3 — item 61/63, edited from step 3's own card, above the
  // computation sheet (§2). One figure PER RETURN (Filing.otherCreditsCents),
  // inheriting from the return before it (or from starting figures) until
  // this filing's own value is saved; locked for good once this filing's
  // own step 5 (FILE_RETURN) is Done — read straight off the frozen
  // computation sheet in that case, since a filing can be filed without
  // ever explicitly saving item 61 (it just silently inherited), and the
  // inheritance chain is a live, dynamic read that must not shift a filed
  // return's own figure retroactively.
  const otherCreditsHasSavedValue = filing.otherCreditsCents != null;
  let otherCreditsAmountCents: number;
  let otherCreditsDescriptionValue: string;
  let otherCreditsSourceLabel: string | null = null;
  if (isFilingLocked && isFrozen) {
    otherCreditsAmountCents =
      "item61OtherCreditsCents" in sheet
        ? sheet.item61OtherCreditsCents
        : "item63OtherCreditsCents" in sheet
          ? sheet.item63OtherCreditsCents
          : (filing.otherCreditsCents ?? 0);
    otherCreditsDescriptionValue = filing.otherCreditsDescription ?? "";
  } else {
    const inheritance = await effectiveOtherCreditsFor(filing.clientId, filing.taxableYear, filing.period);
    otherCreditsAmountCents = inheritance.effectiveCents;
    otherCreditsDescriptionValue = inheritance.effectiveDescription;
    otherCreditsSourceLabel = inheritance.sourceLabel;
  }
  const boundUpdateFilingOtherCredits = updateFilingOtherCredits.bind(null, filing.id);
  const otherCreditsExtra =
    sheet.formType === "F1701Q" || sheet.formType === "F1701A" ? (
      <OtherCreditsForm
        action={boundUpdateFilingOtherCredits}
        locked={isFilingLocked}
        hasSavedValue={otherCreditsHasSavedValue}
        amountCents={otherCreditsAmountCents}
        description={otherCreditsDescriptionValue}
        sourceLabel={otherCreditsSourceLabel}
      />
    ) : null;

  // Brief #4d — step 3's "client confirmation" box (a yes/no
  // acknowledgement plus optional note) is removed, the bookkeeper's own
  // decision. Brief #5f §2 — the credits box (item 55, then item 61) now
  // renders ABOVE the computation sheet: she fills in the credits first,
  // then reads the result.
  const prepareReturnExtra = (
    <div className="flex flex-col gap-2">
      {(sheet.formType === "F1701Q" || sheet.formType === "F1701A") && (
        <p className="text-xs text-ink-secondary">
          Prior year&apos;s excess credit (item 55):{" "}
          <span className="font-medium">{centsToPesos(clientTaxYear?.priorYearExcessCreditCents ?? 0, { withSymbol: true })}</span>
        </p>
      )}
      {otherCreditsExtra}
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
    </div>
  );

  // Brief #5d §8 — step 4's copyable client advice message, modeled on
  // step 16's own draft below. No slot, blocks nothing (D27) — it just
  // sits inside step 4's card with a Copy button. Brief #5f §1/§5 —
  // nothing renders at all until step 3 is Done (adviceMessage is null
  // until then). Brief #5e §3 — collapses to a summary line once Done,
  // showing the saved text only on request.
  const adviseClientExtra = adviceMessage ? (
    <AdviceMessageCard
      isDone={isAdviseClientDone}
      savedAtLabel={filing.adviceMessageSavedAt ? formatManilaDate(filing.adviceMessageSavedAt) : null}
      isOverpayment={sheet.isOverpayment}
      amountLabel={centsToPesos(sheet.isOverpayment ? sheet.overpaymentCents : sheet.taxPayableCents, { withSymbol: true })}
      subject={adviceMessage.subject}
      body={adviceMessage.body}
    />
  ) : null;

  const EXTRA_BY_STEP_CODE: Record<string, React.ReactNode> = {
    PREPARE_RETURN: prepareReturnExtra,
    ADVISE_CLIENT: adviseClientExtra,
  };

  return (
    <div className="mx-auto max-w-3xl">
      <FilingStickyBar
        headerId="filing-page-header"
        title={`${filing.client.registeredName} — TY${filing.taxableYear} ${filing.period}`}
        next={nextStep ? { stepCode: nextStep.stepCode, sequence: nextStep.sequence, title: nextStep.title } : null}
        waitingText={birWaitText}
      />
      <div id="filing-page-header" className="mb-2 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-ink">
              {filing.client.registeredName} — TY{filing.taxableYear} {filing.period}
            </h1>
            <StatusBadge tone={STATUS_TONE[filing.status] ?? "pending"}>
              {filingStatusLabel(filing.status, skippedCount)}
            </StatusBadge>
          </div>
          <details className="mt-0.5 text-sm text-faint">
            <summary className="inline cursor-pointer list-none marker:hidden">
              {filing.formType} — due {formatManilaDate(filing.adjustedDueDate)}
              <span className="ml-1 text-xs text-faint">(details)</span>
            </summary>
            <div className="mt-1 text-xs text-faint">
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
      <Card className="mb-3 border-line bg-background">
        <CardBody className="py-3">
          {nextStep ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium text-ink">
                Next: Step {nextStep.sequence} of {allSteps.length} — {nextStep.title}
                {nextStep.stepCode === "FILE_RETURN" && filingOrderReason && (
                  <span className="ml-2 font-normal text-faint">
                    {filingOrderReason}
                    {earlierUnfiledFilingId && (
                      <>
                        {" "}
                        <Link
                          href={`/clients/${filing.clientId}/filings/${earlierUnfiledFilingId}`}
                          className="underline"
                        >
                          Open {earlierUnfiledPeriod === "ANNUAL" ? "Annual" : earlierUnfiledPeriod}
                        </Link>
                      </>
                    )}
                  </span>
                )}
              </p>
              <NextActionControl
                stepId={nextStep.id}
                stepCode={nextStep.stepCode}
                status={nextStep.status}
                requiredDocSlots={nextStep.requiredDocSlots}
                documents={nextStep.documents}
                dependencyBlockedReason={DEPENDENCY_REASON_BY_STEP_CODE[nextStep.stepCode] ?? null}
                mode={nextActionModeForStepCode(nextStep.stepCode)}
              />
            </div>
          ) : birWaitText ? (
            <p className="text-sm font-medium text-ink">Next: {birWaitText}</p>
          ) : (
            <p className="text-sm font-medium text-green">
              All 16 steps resolved — nothing left to do on this filing.
            </p>
          )}
        </CardBody>
      </Card>

      {/* §4.2 — compact summary strip: one row, no explanatory prose. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
        <span className="font-medium text-ink">{netLabel}</span>
        <span className="text-faint">·</span>
        <span className="text-ink-secondary">
          {daysToAdjustedDue >= 0
            ? `${daysToAdjustedDue}d to adjusted due date`
            : `${Math.abs(daysToAdjustedDue)}d past adjusted due date`}
        </span>
        <span className="text-faint">·</span>
        <StatusBadge tone={STATUS_TONE[filing.status] ?? "pending"}>
          {filingStatusLabel(filing.status, skippedCount)}
        </StatusBadge>
      </div>

      {completenessGaps.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber bg-amber-tint px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-amber">
                {completenessGaps.length} document{completenessGaps.length === 1 ? "" : "s"} not yet attached
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {completenessGaps.map((g, i) => (
                  <li key={i} className="text-xs text-amber">
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

      {/* D83 (brief #5o) — one amber line per unread alert: this return was filed, and something feeding it changed since. The return itself still shows exactly what was filed. */}
      {filing.amendmentAlerts
        .filter((alert) => alert.acknowledgedAt == null)
        .map((alert) => {
          const items = changedItems(
            JSON.parse(alert.snapshotJson as string) as FilingComputationResult,
            JSON.parse(alert.recomputedJson as string) as FilingComputationResult,
          );
          return (
            <div key={alert.id} className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-amber bg-amber-tint px-3 py-2">
              <p className="text-sm text-amber">
                Figures feeding this filed return changed since it was filed ({alert.reason.replace(/\.$/, "")}). It still shows what was filed.{" "}
                {items.map((c, i) => (
                  <span key={c.label}>
                    {i > 0 && "; "}
                    {c.item ? `item ${c.item}` : c.label}: {centsToPesos(c.oldCents, { withSymbol: true })} → {centsToPesos(c.newCents, { withSymbol: true })} (
                    {c.diffCents >= 0 ? "+" : "−"}
                    {centsToPesos(Math.abs(c.diffCents), { withSymbol: true })})
                  </span>
                ))}
                {items.length > 0 ? "; " : ""}
                net {alert.deltaCents >= 0 ? "+" : "−"}
                {centsToPesos(Math.abs(alert.deltaCents), { withSymbol: true })} on tax payable.
              </p>
              <form action={submitAmendmentAck.bind(null, alert.id)}>
                <Button type="submit" size="sm" variant="ghost">
                  Dismiss
                </Button>
              </form>
            </div>
          );
        })}

      {/* Brief #4a — the sixteen steps wrapped in five groups: one "Mark
          done" per group instead of one per step. Opening a group still
          exposes every per-step control that existed before grouping. */}
      <Card id="checklist" className="mb-3">
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Workflow ({visibleSteps.length}/{allSteps.length} steps shown)</h2>
          <div className="flex items-center gap-3">
            <a
              href={`/api/filings/${filing.id}/package`}
              className="text-xs text-ink-secondary underline hover:text-ink"
            >
              Download period package
            </a>
            {naCount > 0 && (
              <Link
                href={
                  showSkipped
                    ? `/clients/${id}/filings/${filingId}`
                    : `/clients/${id}/filings/${filingId}?showSkipped=1`
                }
                className="text-xs text-ink-secondary underline hover:text-ink"
              >
                {showSkipped ? "Hide not applicable" : `Show ${naCount} not applicable`}
              </Link>
            )}
          </div>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col gap-2">
            {groupSections.map(({ def, summary, steps }) => (
              <WorkflowGroupCard
                key={def.code}
                name={def.name}
                doneCount={summary.doneCount}
                totalCount={summary.totalCount}
                skippedCount={summary.skippedCount}
                isComplete={summary.isComplete}
                unresolvedSummary={summary.unresolvedSummary}
                outstandingLabel={summary.outstandingLabel}
                noteLabel={
                  def.code === "PAY"
                    ? payNothingToPayLabel
                    : def.code === "EAFS" && summary.totalCount === 0
                      ? "Not applicable — no Form 2307" // D93: eAFS applies only when there are certificates
                      : null
                }
                notApplicable={summary.totalCount === 0 && steps.length === 0}
                defaultOpen={def.code === activeGroupCode}
                stepCodes={def.stepCodes}
              >
                {steps.map((step) => (
                  <div key={step.id} id={`step-${step.stepCode}`} className="scroll-mt-20">
                    {(() => {
                  // Brief #4b — steps 1 and 2 are self-completing and carry no
                  // manual controls at all; they get their own bespoke cards
                  // instead of the generic WorkflowStepCard.
                  if (step.stepCode === "RECORD_SALES") {
                    return (
                      <RecordSalesStepCard
                        key={step.id}
                        sequence={step.sequence}
                        title={step.title}
                        status={step.status}
                        totalCents={ownSalesRow ? ownSalesRow.grossSalesCents : null}
                        incomeHref={incomeHref}
                      />
                    );
                  }
                  if (step.stepCode === "RECEIVE_2307") {
                    return (
                      <Receive2307StepCard
                        key={step.id}
                        stepId={step.id}
                        sequence={step.sequence}
                        title={step.title}
                        status={step.status}
                        skippedReason={step.skippedReason}
                        certificates={certificateRows}
                        allReceived={filing.certificatesAllReceivedAt != null}
                        locked={isFilingLocked}
                        addCertificateAction={boundAddCertificate}
                        toggleAllReceivedAction={boundToggleAllReceived}
                        defaultPeriodFrom={toManilaDateInputValue(defaultCertificatePeriod.from)}
                        defaultPeriodTo={toManilaDateInputValue(defaultCertificatePeriod.to)}
                        payors={payors}
                        atcCodes={activeAtcCodes}
                        onSaveNewPayor={boundSaveNewPayor}
                        onFillPayorDetail={boundFillPayorDetail}
                      />
                    );
                  }
                  // D67/D71/D75/D86/D88 — steps 6, 7 (File), 10, 14 (BIR
                  // Confirmations), 11 and 13 (eAFS) are self-completing once
                  // their own gating step is Done, the same reasoning steps 1/2
                  // already get their own bespoke cards for. Step 11 has TWO
                  // upload boxes and completes only when both files are in.
                  if (
                    step.stepCode === "SAVE_SUBMISSION_SS" ||
                    step.stepCode === "SAVE_FORM_COPY" ||
                    step.stepCode === "RECEIVE_TRRC" ||
                    step.stepCode === "SAWT_VALIDATION" ||
                    step.stepCode === "ALPHALIST_ENTRY" ||
                    step.stepCode === "SAWT_ACK"
                  ) {
                    const lock = stepLockReason(step.stepCode, filing.workflowSteps);
                    return (
                      <FileGroupDocStepCard
                        key={step.id}
                        stepId={step.id}
                        sequence={step.sequence}
                        title={step.title}
                        status={step.status}
                        isUnlocked={lock == null}
                        lockedMessage={lock ?? ""}
                        slots={step.requiredDocSlots.map((slot) => ({
                          slotCode: slot.slotCode,
                          label: slot.label,
                          documents: step.documents.filter((d) => d.docSlotCode === slot.slotCode),
                        }))}
                        waitingOnLabel={step.waitingOnLabel}
                        agingDaysWaiting={step.agingDaysWaiting}
                        agingTone={step.agingTone}
                      />
                    );
                  }
                  // D87 (brief #5o §4) — step 12: the eSubmission email draft.
                  if (step.stepCode === "EMAIL_DAT") {
                    const saved = filing.dataEmailSavedAt != null && step.status === "DONE";
                    const liveEmail = buildESubmissionEmail({
                      toAddress: ruleSetForEmail?.eSubmissionEmail ?? "",
                      period: filing.period,
                      taxableYear: filing.taxableYear,
                      formType: filing.formType,
                      registeredName: filing.client.registeredName,
                      tin: filing.client.tin,
                      branchCode: filing.client.branchCode,
                      rdoCode: filing.client.rdoCode,
                    });
                    const datDoc = allSteps
                      .find((x) => x.stepCode === "ALPHALIST_ENTRY")
                      ?.documents.find((d) => d.docSlotCode === "dat_file");
                    return (
                      <EmailDatStepCard
                        key={step.id}
                        stepId={step.id}
                        clientId={filing.clientId}
                        sequence={step.sequence}
                        title={step.title}
                        status={step.status}
                        lockedMessage={stepLockReason(step.stepCode, filing.workflowSteps)}
                        to={saved ? (filing.dataEmailTo ?? liveEmail.to) : liveEmail.to}
                        subject={saved ? (filing.dataEmailSubject ?? liveEmail.subject) : liveEmail.subject}
                        body={saved ? (filing.dataEmailBody ?? liveEmail.body) : liveEmail.body}
                        rdoMissing={liveEmail.rdoMissing}
                        datFile={datDoc ? { id: datDoc.id, filename: datDoc.originalFilename } : null}
                        savedAtLabel={filing.dataEmailSavedAt ? formatManilaDate(filing.dataEmailSavedAt) : null}
                      />
                    );
                  }
                  // D101/D102 (brief #5r) — step 16: the client email (To/Subject/Body,
                  // each copyable), Mark done only, saved and collapsed once Done.
                  if (step.stepCode === "SEND_CLIENT_PACKAGE" && clientEmail) {
                    const savedEmail = step.status === "DONE" && filing.clientPackageEmailSavedAt != null;
                    return (
                      <ClientPackageStepCard
                        key={step.id}
                        stepId={step.id}
                        clientId={filing.clientId}
                        sequence={step.sequence}
                        title={step.title}
                        status={step.status}
                        lockedMessage={stepLockReason(step.stepCode, filing.workflowSteps)}
                        to={savedEmail ? filing.clientPackageEmailTo : clientEmail.to}
                        subject={savedEmail ? (filing.clientPackageEmailSubject ?? clientEmail.subject) : clientEmail.subject}
                        body={savedEmail ? (filing.clientPackageEmailBody ?? clientEmail.body) : clientEmail.body}
                        hasSavedEmail={savedEmail}
                        doneDateLabel={
                          filing.workflowSteps.find((x) => x.id === step.id)?.completedAt
                            ? formatManilaDate(filing.workflowSteps.find((x) => x.id === step.id)!.completedAt!)
                            : null
                        }
                        savedAtLabel={filing.clientPackageEmailSavedAt ? formatManilaDate(filing.clientPackageEmailSavedAt) : null}
                        skippedReason={step.skippedReason}
                        downloadHref={`/api/filings/${filing.id}/package`}
                      />
                    );
                  }
                  // D75 (brief #5m §3.2) — step 8 (MAKE_PAYMENT): its own
                  // bespoke card, amount/date/channel fields + Mark done,
                  // locked until File is Done.
                  if (step.stepCode === "MAKE_PAYMENT") {
                    return (
                      <MakePaymentStepCard
                        key={step.id}
                        stepId={step.id}
                        sequence={step.sequence}
                        title={step.title}
                        status={step.status}
                        isUnlocked={isFileGroupDone}
                        locked={paymentLocked}
                        action={boundSavePayment}
                        defaultAmountCents={sheet.isOverpayment ? 0 : sheet.taxPayableCents}
                        savedAmountCents={filing.amountPaidCents}
                        savedPaymentDate={toManilaDateInputValue(filing.paymentDate)}
                        savedPaymentChannel={filing.paymentChannel}
                        previousChannels={previousChannels}
                      />
                    );
                  }
                  // D75 (brief #5m §3.3) — step 9 (SAVE_PROOF_PAYMENT):
                  // the same self-completing upload card as 6/7/10/14,
                  // gated on step 8 instead — it never enters
                  // WAITING_EXTERNAL on its own (Pay's own header line
                  // says "waiting on proof of payment" instead).
                  if (step.stepCode === "SAVE_PROOF_PAYMENT") {
                    return (
                      <FileGroupDocStepCard
                        key={step.id}
                        stepId={step.id}
                        sequence={step.sequence}
                        title={step.title}
                        status={step.status}
                        isUnlocked={isStep8Done}
                        lockedMessage="Available once step 8 is done."
                        slots={step.requiredDocSlots.map((slot) => ({
                          slotCode: slot.slotCode,
                          label: slot.label,
                          documents: step.documents.filter((d) => d.docSlotCode === slot.slotCode),
                        }))}
                        waitingOnLabel={step.waitingOnLabel}
                        agingDaysWaiting={step.agingDaysWaiting}
                        agingTone={step.agingTone}
                      />
                    );
                  }
                  return (
                    <WorkflowStepCard
                      key={step.id}
                      step={step}
                      extra={EXTRA_BY_STEP_CODE[step.stepCode]}
                      dependencyBlockedReason={DEPENDENCY_REASON_BY_STEP_CODE[step.stepCode] ?? null}
                      suppressTooltip={step.stepCode === "ADVISE_CLIENT"}
                      controlsMode={
                        step.stepCode === "ADVISE_CLIENT" ||
                        step.stepCode === "PREPARE_RETURN" ||
                        step.stepCode === "FILE_RETURN" ||
                        step.stepCode === "EAFS_SUBMIT" ||
                        step.stepCode === "SEND_CLIENT_PACKAGE"
                          ? "markDoneOnly"
                          : "full"
                      }
                      lockedMessage={step.stepCode === "EAFS_SUBMIT" ? stepLockReason(step.stepCode, filing.workflowSteps) : null}
                    />
                  );
                    })()}
                  </div>
                ))}
              </WorkflowGroupCard>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
