import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { AtcCodeForm } from "@/components/atc-code-form";
import { updateAtcCode } from "@/lib/actions/atcCodes";
import { bpsToPercentLabel } from "@/lib/money";

export default async function EditAtcCodePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const atcCode = await prisma.atcCode.findUnique({ where: { id } });
  if (!atcCode) notFound();

  const boundAction = updateAtcCode.bind(null, atcCode.id);

  const initialValues: Record<string, string> = {
    code: atcCode.code,
    description: atcCode.description,
    ratePercent: bpsToPercentLabel(atcCode.rateBps).replace("%", ""),
    notes: atcCode.notes ?? "",
    isActive: atcCode.isActive ? "on" : "",
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-2xl font-semibold text-ink">Edit ATC — {atcCode.code}</h1>
      <AtcCodeForm cancelHref="/settings/atc-codes" action={boundAction} initialValues={initialValues} submitLabel="Save" />
    </div>
  );
}
