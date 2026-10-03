import { periodLabel } from "@/lib/periodLabel";
import Link from "next/link";
import { ClientStickyBar } from "@/components/client-sticky-bar";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { ClientDetailsCards } from "@/components/client-details-cards";
import { GenerateFilingsForm } from "@/components/generate-filings-form";
import { formatManilaDate, currentTaxableYearManila } from "@/lib/dates";
import { formLabel } from "@/lib/workflow/eSubmissionEmail";
import { filingStatusLabel } from "@/lib/workflow/status";

// D175 — always rendered fresh from the database, never prerendered at build time.
export const dynamic = "force-dynamic";

// Brief #5i §5 — matches app/(app)/filings/page.tsx's own FILING_STATUS_TONE
// exactly, so a filing's pill reads the same colour wherever it shows.
const FILING_STATUS_TONE: Record<string, StatusTone> = {
  NOT_STARTED: "pending",
  IN_PROGRESS: "progress",
  WAITING_CLIENT: "waiting",
  WAITING_BIR: "waiting",
  BLOCKED: "overdue",
  COMPLETE: "done",
  NA: "pending",
};

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      taxYears: { orderBy: { taxableYear: "desc" } },
      filings: {
        orderBy: [{ taxableYear: "desc" }, { period: "asc" }],
        include: { workflowSteps: { select: { status: true } } },
      },
    },
  });
  if (!client) notFound();

  return (
    <div className="mx-auto max-w-4xl">
      <ClientStickyBar headerId="client-page-header" clientId={client.id} name={client.registeredName} tin={client.tin} />
      <div id="client-page-header" className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-ink">{client.registeredName}</h1>
            {client.isActive ? (
              <StatusBadge tone="done">Active</StatusBadge>
            ) : (
              <StatusBadge tone="pending">Inactive</StatusBadge>
            )}
          </div>
          {client.tradeName && <p className="text-sm text-faint">{client.tradeName}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/clients">
            <Button variant="secondary">
              Back to list
            </Button>
          </Link>
          <Link href={`/clients/${client.id}/income`}>
            <Button variant="secondary">
              Income
            </Button>
          </Link>
          <Link href={`/clients/${client.id}/form-2307`}>
            <Button variant="secondary">
              Form 2307s
            </Button>
          </Link>
          <Link href={`/clients/${client.id}/payors`}>
            <Button variant="secondary">
              Payors
            </Button>
          </Link>
          <Link href={`/clients/${client.id}/edit`}>
            <Button>Edit</Button>
          </Link>
        </div>
      </div>

      <ClientDetailsCards client={client} />

      <div className="mt-4 grid grid-cols-1 gap-4">
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Taxable years</h2>
            <Link href={`/clients/${client.id}/tax-years/new`}>
              <Button variant="secondary" size="sm">
                New tax year
              </Button>
            </Link>
          </CardHeader>
          <CardBody>
            {client.taxYears.length === 0 ? (
              <p className="text-sm text-faint">
                No taxable years recorded yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table data-table-centered">
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Threshold breached</th>
                      <th></th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {client.taxYears.map((ty) => (
                      <tr key={ty.id}>
                        <td>{ty.taxableYear}</td>
                        <td>{ty.thresholdBreachedAt ? formatManilaDate(ty.thresholdBreachedAt) : "—"}</td>
                        <td>
                          <Link
                            href={`/clients/${client.id}/tax-years/${ty.id}/starting-figures`}
                            className="text-sm text-ink-secondary hover:underline"
                          >
                            Starting figures
                          </Link>
                        </td>
                        <td>
                          <Link
                            href={`/clients/${client.id}/tax-years/${ty.id}/edit`}
                            className="text-sm text-ink-secondary hover:underline"
                          >
                            Edit
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Filings</h2>
            <GenerateFilingsForm clientId={client.id} defaultYear={currentTaxableYearManila()} />
          </CardHeader>
          <CardBody>
            {client.filings.length === 0 ? (
              <p className="text-sm text-faint">No filings yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table data-table-centered">
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Period</th>
                      <th>Form</th>
                      <th>Due</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {client.filings.map((f) => {
                      // Brief #5f §8 — a period named "filed outside the app"
                      // by starting figures renders here, never as ordinary
                      // work: no status, no link, no deadline.
                      if (f.filedOutsideApp) {
                        return (
                          <tr key={f.id}>
                            <td>{f.taxableYear}</td>
                            <td>{periodLabel(f.period)}</td>
                            <td>{formLabel(f.formType)}</td>
                            <td>—</td>
                            <td colSpan={2} className="text-faint">
                              Filed outside the app
                            </td>
                          </tr>
                        );
                      }
                      return (
                        <tr key={f.id}>
                          <td>{f.taxableYear}</td>
                          <td>{periodLabel(f.period)}</td>
                          <td>{formLabel(f.formType)}</td>
                          <td>{formatManilaDate(f.adjustedDueDate)}</td>
                          <td>
                            <StatusBadge tone={FILING_STATUS_TONE[f.status] ?? "pending"}>
                              {filingStatusLabel(f.status)}
                            </StatusBadge>
                          </td>
                          <td>
                            <Link
                              href={`/clients/${client.id}/filings/${f.id}`}
                              className="text-sm text-ink-secondary hover:underline"
                            >
                              Open
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
