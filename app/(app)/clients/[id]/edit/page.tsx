import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ClientForm } from "@/components/client-form";
import { updateClient } from "@/lib/actions/clients";
import { toManilaDateInputValue } from "@/lib/dates";

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) notFound();

  const boundAction = updateClient.bind(null, client.id);

  const initialValues: Record<string, string> = {
    code: client.code,
    registeredName: client.registeredName,
    tradeName: client.tradeName ?? "",
    tin: client.tin,
    branchCode: client.branchCode,
    rdoCode: client.rdoCode,
    registeredAddress: client.registeredAddress,
    birthDate: toManilaDateInputValue(client.birthDate),
    email: client.email ?? "",
    mobile: client.mobile ?? "",
    lineOfBusiness: client.lineOfBusiness ?? "",
    psicCode: client.psicCode ?? "",
    isActive: client.isActive ? "on" : "",
    engagedSince: toManilaDateInputValue(client.engagedSince),
    notes: client.notes ?? "",
  };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-2xl font-semibold text-ink">Edit {client.registeredName}</h1>
      <ClientForm action={boundAction} initialValues={initialValues} submitLabel="Save changes" cancelHref={`/clients/${client.id}`} />
    </div>
  );
}
