import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createTransactionFromForm2307 } from "@/lib/actions/salesTransactions";
import { centsToPesos, bpsToPercentLabel } from "@/lib/money";
import { toManilaDateInputValue } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function CreateTransactionFromForm2307Page({
  params,
}: {
  params: Promise<{ id: string; form2307Id: string }>;
}) {
  const { id, form2307Id } = await params;
  const cert = await prisma.form2307.findUnique({ where: { id: form2307Id } });
  if (!cert || cert.clientId !== id) notFound();

  async function submit(formData: FormData) {
    "use server";
    const transactionDate = String(formData.get("transactionDate") ?? "");
    const description = String(formData.get("description") ?? "");
    const result = await createTransactionFromForm2307(form2307Id, transactionDate, description);
    if (result.ok) {
      const { redirect } = await import("next/navigation");
      redirect(`/clients/${id}/transactions`);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-1 text-lg font-semibold text-slate-900">Create transaction from Form 2307</h1>
      <p className="mb-4 text-sm text-slate-500">
        Pre-filled from the certificate. This is the primary entry path — the 2307 is the source
        document for the transaction, not an independent check on it.
      </p>

      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase text-slate-400">Payor</dt>
            <dd>{cert.payorName}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-400">TIN</dt>
            <dd>{cert.payorTin ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-400">Gross (income payment)</dt>
            <dd>{centsToPesos(cert.incomePaymentCents, { withSymbol: true })}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-400">CWT (tax withheld)</dt>
            <dd>{centsToPesos(cert.taxWithheldCents, { withSymbol: true })}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-400">Rate</dt>
            <dd>{bpsToPercentLabel(cert.withholdingRateBps)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-400">ATC</dt>
            <dd className="font-mono">{cert.atcCode}</dd>
          </div>
        </dl>
      </div>

      <form action={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="transactionDate">
            Transaction date<span className="text-red-500"> *</span>
          </Label>
          <Input
            id="transactionDate"
            name="transactionDate"
            type="date"
            defaultValue={toManilaDateInputValue(cert.periodTo)}
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="description">Description</Label>
          <Input id="description" name="description" placeholder={`From Form 2307 (${cert.atcCode})`} />
        </div>
        <div>
          <Button type="submit">Create transaction</Button>
        </div>
      </form>
    </div>
  );
}
