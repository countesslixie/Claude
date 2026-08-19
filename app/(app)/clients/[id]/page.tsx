import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { formatManilaDate } from "@/lib/dates";
import { bpsToPercentLabel } from "@/lib/money";

const LABELS: Record<string, string> = {
  PURELY_SELF_EMPLOYED: "Purely self-employed",
  MIXED_INCOME: "Mixed income",
  MANUAL: "Manual",
  LOOSE_LEAF: "Loose-leaf",
  CAS: "CAS",
  COLLECTION: "Collection (cash received)",
  BILLING: "Billing (accrual)",
  ELECTED: "Elected",
  NOT_YET_ELECTED: "Not yet elected",
  DEFAULTED_GRADUATED: "Defaulted to graduated",
  RATE_8_PERCENT: "8% flat rate",
  GRADUATED_OSD: "Graduated, OSD",
  GRADUATED_ITEMIZED: "Graduated, itemized",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value ?? "—"}</dd>
    </div>
  );
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await prisma.client.findUnique({
    where: { id },
    include: { taxYears: { orderBy: { taxableYear: "desc" } } },
  });
  if (!client) notFound();

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900">{client.registeredName}</h1>
            {client.isActive ? (
              <StatusBadge tone="done">Active</StatusBadge>
            ) : (
              <StatusBadge tone="pending">Inactive</StatusBadge>
            )}
          </div>
          {client.tradeName && <p className="text-sm text-slate-500">{client.tradeName}</p>}
        </div>
        <div className="flex gap-2">
          <Link href="/clients">
            <Button variant="secondary" size="sm">
              Back to list
            </Button>
          </Link>
          <Link href={`/clients/${client.id}/edit`}>
            <Button size="sm">Edit</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-900">Registration</h2>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Client code" value={<span className="font-mono">{client.code}</span>} />
              <Field label="TIN" value={<span className="font-mono">{client.tin}</span>} />
              <Field label="Branch code" value={client.branchCode} />
              <Field label="RDO code" value={client.rdoCode} />
              <Field label="Taxpayer type" value={LABELS[client.taxpayerType]} />
              <Field label="Civil status" value={client.civilStatus ? LABELS[client.civilStatus] ?? client.civilStatus : "—"} />
              <div className="col-span-2">
                <Field label="Registered address" value={client.registeredAddress} />
              </div>
              <Field label="Email" value={client.email} />
              <Field label="Mobile" value={client.mobile} />
              <Field label="Line of business" value={client.lineOfBusiness} />
              <Field label="PSIC code" value={client.psicCode} />
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-900">Books & compliance</h2>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Books type" value={LABELS[client.booksType]} />
              <Field label="Books registration date" value={formatManilaDate(client.booksRegistrationDate)} />
              <Field label="Books permit number" value={client.booksPermitNumber} />
              <Field
                label="Sworn declaration"
                value={
                  client.swornDeclarationOnFile
                    ? `On file (${client.swornDeclarationYear ?? "year unknown"})`
                    : "Not on file"
                }
              />
              <Field label="eBIRForms email" value={client.eBIRFormsEmail} />
              <Field label="eFPS enrolled" value={client.eFPSEnrolled ? "Yes" : "No"} />
              <Field
                label="Default WHT rate"
                value={
                  client.defaultWithholdingRateBps != null
                    ? bpsToPercentLabel(client.defaultWithholdingRateBps)
                    : "—"
                }
              />
              <Field label="Revenue recognition" value={LABELS[client.recognitionBasis]} />
            </dl>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Taxable years</h2>
          </CardHeader>
          <CardBody>
            {client.taxYears.length === 0 ? (
              <p className="text-sm text-slate-400">
                No taxable years recorded yet. These are created when a filing cycle is opened
                (Phase 3).
              </p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Year</th>
                    <th>Regime</th>
                    <th>Election status</th>
                    <th>Prior-year excess credit</th>
                    <th>Threshold breached</th>
                  </tr>
                </thead>
                <tbody>
                  {client.taxYears.map((ty) => (
                    <tr key={ty.id}>
                      <td>{ty.taxableYear}</td>
                      <td>{LABELS[ty.regime]}</td>
                      <td>
                        {ty.electionStatus === "ELECTED" ? (
                          <StatusBadge tone="done">{LABELS[ty.electionStatus]}</StatusBadge>
                        ) : ty.electionStatus === "DEFAULTED_GRADUATED" ? (
                          <StatusBadge tone="overdue">{LABELS[ty.electionStatus]}</StatusBadge>
                        ) : (
                          <StatusBadge tone="waiting">{LABELS[ty.electionStatus]}</StatusBadge>
                        )}
                      </td>
                      <td>{(ty.priorYearExcessCreditCents / 100).toFixed(2)}</td>
                      <td>{ty.thresholdBreachedAt ? formatManilaDate(ty.thresholdBreachedAt) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-900">Notes</h2>
          </CardHeader>
          <CardBody>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{client.notes || "—"}</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
