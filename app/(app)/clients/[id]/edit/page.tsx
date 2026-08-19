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
    email: client.email ?? "",
    mobile: client.mobile ?? "",
    taxpayerType: client.taxpayerType,
    lineOfBusiness: client.lineOfBusiness ?? "",
    psicCode: client.psicCode ?? "",
    civilStatus: client.civilStatus ?? "",
    booksType: client.booksType,
    booksRegistrationDate: toManilaDateInputValue(client.booksRegistrationDate),
    booksPermitNumber: client.booksPermitNumber ?? "",
    swornDeclarationOnFile: client.swornDeclarationOnFile ? "on" : "",
    swornDeclarationYear: client.swornDeclarationYear ? String(client.swornDeclarationYear) : "",
    eBIRFormsEmail: client.eBIRFormsEmail ?? "",
    eFPSEnrolled: client.eFPSEnrolled ? "on" : "",
    defaultWithholdingRateBps:
      client.defaultWithholdingRateBps != null ? String(client.defaultWithholdingRateBps) : "",
    recognitionBasis: client.recognitionBasis,
    isActive: client.isActive ? "on" : "",
    engagedSince: toManilaDateInputValue(client.engagedSince),
    notes: client.notes ?? "",
  };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-lg font-semibold text-slate-900">Edit {client.registeredName}</h1>
      <ClientForm action={boundAction} initialValues={initialValues} submitLabel="Save changes" />
    </div>
  );
}
