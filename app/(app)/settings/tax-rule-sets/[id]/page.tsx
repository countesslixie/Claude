import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TaxRuleSetForm } from "@/components/tax-rule-set-form";
import { updateTaxRuleSet } from "@/lib/actions/taxRuleSets";
import { toManilaDateInputValue } from "@/lib/dates";
import { centsToPesos } from "@/lib/money";

export default async function EditTaxRuleSetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ruleSet = await prisma.taxRuleSet.findUnique({ where: { id } });
  if (!ruleSet) notFound();

  const boundAction = updateTaxRuleSet.bind(null, ruleSet.id);

  const initialValues: Record<string, string> = {
    taxableYear: String(ruleSet.taxableYear),
    effectiveFrom: toManilaDateInputValue(ruleSet.effectiveFrom),
    effectiveTo: toManilaDateInputValue(ruleSet.effectiveTo),
    incomeTaxRateBps: String(ruleSet.incomeTaxRateBps),
    vatThreshold: centsToPesos(ruleSet.vatThresholdCents),
    allowableDeduction: centsToPesos(ruleSet.allowableDeductionCents),
    q1DueMonthDay: ruleSet.q1DueMonthDay,
    q2DueMonthDay: ruleSet.q2DueMonthDay,
    q3DueMonthDay: ruleSet.q3DueMonthDay,
    annualDueMonthDay: ruleSet.annualDueMonthDay,
    sawtDeadlineOffsetDays: String(ruleSet.sawtDeadlineOffsetDays),
    eafsDeadlineOffsetDays: String(ruleSet.eafsDeadlineOffsetDays),
    surchargeRateBps: ruleSet.surchargeRateBps != null ? String(ruleSet.surchargeRateBps) : "",
    interestRateBpsPerAnnum:
      ruleSet.interestRateBpsPerAnnum != null ? String(ruleSet.interestRateBpsPerAnnum) : "",
    notes: ruleSet.notes ?? "",
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-lg font-semibold text-slate-900">
        Edit tax rule set — {ruleSet.taxableYear}
      </h1>
      <TaxRuleSetForm action={boundAction} initialValues={initialValues} submitLabel="Save changes" />
    </div>
  );
}
