import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ClientTaxYearForm } from "@/components/client-tax-year-form";
import { createClientTaxYear } from "@/lib/actions/clientTaxYears";

export default async function NewClientTaxYearPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) notFound();

  const boundAction = createClientTaxYear.bind(null, client.id);

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-4 text-lg font-semibold text-slate-900">
        New taxable year — {client.registeredName}
      </h1>
      <ClientTaxYearForm action={boundAction} submitLabel="Create tax year" />
    </div>
  );
}
