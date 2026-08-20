import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { assembleAndComputeFiling } from "@/lib/filingComputation";
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
import { WorkflowStepCard, type StepCardData } from "@/components/workflow-step-card";
import { centsToPesos } from "@/lib/money";
import { formatManilaDate, toManilaDateInputValue } from "@/lib/dates";
import { deriveStepAging } from "@/lib/workflow/aging";
import { parseDocSlots } from "@/lib/workflow/types";
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
        documentDate: d.documentDate.toISOString().split("T")[0],
      })),
      agingDaysWaiting: aging?.daysWaiting ?? null,
      agingTone: aging?.tone ?? null,
    };
  });
  const hiddenCount = allSteps.filter((s) => s.status === "NA" || s.status === "SKIPPED").length;
  const visibleSteps = showSkipped ? allSteps : allSteps.filter((s) => s.status !== "NA" && s.status !== "SKIPPED");

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

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900">
              {filing.client.registeredName} — TY{filing.taxableYear} {filing.period}
            </h1>
            <StatusBadge tone={STATUS_TONE[filing.status] ?? "pending"}>{filing.status}</StatusBadge>
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

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-900">
            Computation sheet {isFrozen ? "(frozen — as filed)" : "(live preview — not yet filed)"}
          </h2>
        </CardHeader>
        <CardBody>
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
          <p className="mt-3 text-xs text-slate-400">
            {sheet.isOverpayment
              ? `Overpayment: ${centsToPesos(sheet.overpaymentCents, { withSymbol: true })}`
              : `Tax payable: ${centsToPesos(sheet.taxPayableCents, { withSymbol: true })}`}
            {" — "}Form {sheet.formType}. This is a preparation aid; the filed return and BIR&apos;s own
            assessment govern.
          </p>
        </CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-900">Certificate cutoff</h2>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-slate-700">
            Certificates received on or before{" "}
            <span className="font-medium">
              {sheet.certificateCutoffDate ? formatManilaDate(sheet.certificateCutoffDate) : "—"}
            </span>{" "}
            are claimed on this filing ({sheet.certificateCutoffSource
              ? CUTOFF_SOURCE_LABEL[sheet.certificateCutoffSource]
              : "unknown — frozen before this field existed"}
            ).
          </p>
          <p className="mt-1 text-xs text-slate-400">
            A certificate is claimed in the period whose cutoff it falls within — the bookkeeper does not
            file amended returns when one arrives late (SPEC.md 3.5).
          </p>
          <form action={submitCutoffOverride} className="mt-3 flex items-end gap-2">
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-slate-400" htmlFor="cutoffOverride">
                Manual override
              </label>
              <Input
                id="cutoffOverride"
                name="cutoffOverride"
                type="date"
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
        </CardBody>
      </Card>

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
          <div className="flex flex-col gap-2">
            {visibleSteps.map((step) => (
              <WorkflowStepCard key={step.id} step={step} />
            ))}
          </div>
        </CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-900">Receipts confirmation (PREPARE_RETURN)</h2>
        </CardHeader>
        <CardBody>
          {filing.receiptsAcknowledgedAt ? (
            <div>
              <p className="text-sm text-slate-700">
                Confirmed {formatManilaDate(filing.receiptsAcknowledgedAt)}.
              </p>
              {filing.receiptsAcknowledgedNote && (
                <p className="mt-1 text-sm text-slate-500">{filing.receiptsAcknowledgedNote}</p>
              )}
            </div>
          ) : (
            <form action={submitAcknowledgement} className="flex flex-col gap-3">
              <p className="text-sm text-slate-700">
                Have you confirmed with the client that all receipts for this quarter are accounted
                for, including any without a 2307?
              </p>
              <Textarea name="note" placeholder="Optional note" rows={2} />
              <div>
                <Button type="submit" size="sm">
                  Confirm
                </Button>
              </div>
            </form>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
