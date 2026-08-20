import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Form2307Form } from "@/components/form2307-form";
import { createForm2307 } from "@/lib/actions/form2307";
import { currentTaxableYearManila } from "@/lib/dates";

export default async function NewForm2307Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string; quarter?: string }>;
}) {
  const { id } = await params;
  const { year, quarter } = await searchParams;
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) notFound();

  const taxableYear = year ? Number(year) : currentTaxableYearManila();
  const quarterCovered = quarter ? Number(quarter) : 1;

  const boundAction = createForm2307.bind(null, client.id, taxableYear);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-lg font-semibold text-slate-900">
        New Form 2307 — {client.registeredName} ({taxableYear})
      </h1>
      <Form2307Form
        action={boundAction}
        initialValues={{ quarterCovered: String(quarterCovered) }}
        submitLabel="Save Form 2307"
      />
    </div>
  );
}
