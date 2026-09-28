import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PayorForm } from "@/components/payor-form";
import { updatePayor } from "@/lib/actions/payors";

export default async function EditPayorPage({
  params,
}: {
  params: Promise<{ id: string; payorId: string }>;
}) {
  const { id, payorId } = await params;
  const payor = await prisma.payor.findUnique({ where: { id: payorId } });
  if (!payor || payor.clientId !== id) notFound();

  const atcCodes = await prisma.atcCode.findMany({ where: { isActive: true }, orderBy: { code: "asc" } });

  const boundAction = updatePayor.bind(null, payor.id, id);

  const initialValues: Record<string, string> = {
    name: payor.name,
    tin: payor.tin ?? "",
    address: payor.address ?? "",
    usualAtcCode: payor.usualAtcCode ?? "",
    isActive: payor.isActive ? "on" : "",
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-2xl font-semibold text-ink">Edit — {payor.name}</h1>
      <PayorForm action={boundAction} atcCodes={atcCodes} initialValues={initialValues} submitLabel="Save changes" />
    </div>
  );
}
