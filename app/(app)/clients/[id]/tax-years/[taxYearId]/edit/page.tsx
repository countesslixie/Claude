import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ClientTaxYearForm } from "@/components/client-tax-year-form";
import { updateClientTaxYear } from "@/lib/actions/clientTaxYears";
import { centsToPesos } from "@/lib/money";

export default async function EditClientTaxYearPage({
  params,
}: {
  params: Promise<{ id: string; taxYearId: string }>;
}) {
  const { id, taxYearId } = await params;
  const taxYear = await prisma.clientTaxYear.findUnique({
    where: { id: taxYearId },
    include: { client: true },
  });
  if (!taxYear || taxYear.clientId !== id) notFound();

  const boundAction = updateClientTaxYear.bind(null, taxYear.id);

  const initialValues: Record<string, string> = {
    taxableYear: String(taxYear.taxableYear),
    regime: taxYear.regime,
    electionStatus: taxYear.electionStatus,
    priorYearExcessCredit: centsToPesos(taxYear.priorYearExcessCreditCents),
    yearEndCreditElection: taxYear.yearEndCreditElection,
  };

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-4 text-lg font-semibold text-slate-900">
        Edit {taxYear.taxableYear} — {taxYear.client.registeredName}
      </h1>
      <ClientTaxYearForm action={boundAction} initialValues={initialValues} submitLabel="Save changes" />
    </div>
  );
}
