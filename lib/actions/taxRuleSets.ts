"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { taxRuleSetSchema } from "@/lib/validation/taxRuleSet";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";
import { manilaDateInputToJsDate } from "@/lib/dates";
import { pesosToCents } from "@/lib/money";

export type TaxRuleSetFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: Record<string, string>;
};

const FIELDS = [
  "taxableYear",
  "effectiveFrom",
  "effectiveTo",
  "incomeTaxRateBps",
  "vatThreshold",
  "allowableDeduction",
  "q1DueMonthDay",
  "q2DueMonthDay",
  "q3DueMonthDay",
  "annualDueMonthDay",
  "sawtDeadlineOffsetDays",
  "eafsDeadlineOffsetDays",
  "surchargeRateBps",
  "interestRateBpsPerAnnum",
  "notes",
] as const;

function rawFromFormData(formData: FormData) {
  const values: Record<string, string> = {};
  for (const key of FIELDS) {
    const v = formData.get(key);
    values[key] = typeof v === "string" ? v : "";
  }
  return values;
}

export async function createTaxRuleSet(
  _prevState: TaxRuleSetFormState,
  formData: FormData,
): Promise<TaxRuleSetFormState> {
  const values = rawFromFormData(formData);
  const parsed = taxRuleSetSchema.safeParse(values);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  }

  const existing = await prisma.taxRuleSet.findUnique({
    where: { taxableYear: parsed.data.taxableYear },
  });
  if (existing) {
    return {
      fieldErrors: { taxableYear: ["A rule set for this taxable year already exists."] },
      values,
    };
  }

  const actorId = await getActorId();
  const ruleSet = await prisma.taxRuleSet.create({
    data: {
      taxableYear: parsed.data.taxableYear,
      effectiveFrom: manilaDateInputToJsDate(parsed.data.effectiveFrom),
      effectiveTo: parsed.data.effectiveTo ? manilaDateInputToJsDate(parsed.data.effectiveTo) : null,
      incomeTaxRateBps: parsed.data.incomeTaxRateBps,
      vatThresholdCents: pesosToCents(parsed.data.vatThreshold),
      allowableDeductionCents: pesosToCents(parsed.data.allowableDeduction),
      q1DueMonthDay: parsed.data.q1DueMonthDay,
      q2DueMonthDay: parsed.data.q2DueMonthDay,
      q3DueMonthDay: parsed.data.q3DueMonthDay,
      annualDueMonthDay: parsed.data.annualDueMonthDay,
      sawtDeadlineOffsetDays: parsed.data.sawtDeadlineOffsetDays,
      eafsDeadlineOffsetDays: parsed.data.eafsDeadlineOffsetDays,
      surchargeRateBps: parsed.data.surchargeRateBps ?? null,
      interestRateBpsPerAnnum: parsed.data.interestRateBpsPerAnnum ?? null,
      notes: parsed.data.notes ?? null,
      actorId,
    },
  });

  await logActivity({
    entityType: "TaxRuleSet",
    entityId: ruleSet.id,
    action: "CREATE",
    after: ruleSet,
    actorId,
  });

  revalidatePath("/settings/tax-rule-sets");
  redirect("/settings/tax-rule-sets");
}

export async function updateTaxRuleSet(
  id: string,
  _prevState: TaxRuleSetFormState,
  formData: FormData,
): Promise<TaxRuleSetFormState> {
  const values = rawFromFormData(formData);
  const parsed = taxRuleSetSchema.safeParse(values);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  }

  const before = await prisma.taxRuleSet.findUnique({ where: { id } });
  if (!before) return { error: "Rule set not found." };

  if (parsed.data.taxableYear !== before.taxableYear) {
    const taken = await prisma.taxRuleSet.findUnique({
      where: { taxableYear: parsed.data.taxableYear },
    });
    if (taken) {
      return {
        fieldErrors: { taxableYear: ["A rule set for this taxable year already exists."] },
        values,
      };
    }
  }

  const actorId = await getActorId();
  const ruleSet = await prisma.taxRuleSet.update({
    where: { id },
    data: {
      taxableYear: parsed.data.taxableYear,
      effectiveFrom: manilaDateInputToJsDate(parsed.data.effectiveFrom),
      effectiveTo: parsed.data.effectiveTo ? manilaDateInputToJsDate(parsed.data.effectiveTo) : null,
      incomeTaxRateBps: parsed.data.incomeTaxRateBps,
      vatThresholdCents: pesosToCents(parsed.data.vatThreshold),
      allowableDeductionCents: pesosToCents(parsed.data.allowableDeduction),
      q1DueMonthDay: parsed.data.q1DueMonthDay,
      q2DueMonthDay: parsed.data.q2DueMonthDay,
      q3DueMonthDay: parsed.data.q3DueMonthDay,
      annualDueMonthDay: parsed.data.annualDueMonthDay,
      sawtDeadlineOffsetDays: parsed.data.sawtDeadlineOffsetDays,
      eafsDeadlineOffsetDays: parsed.data.eafsDeadlineOffsetDays,
      surchargeRateBps: parsed.data.surchargeRateBps ?? null,
      interestRateBpsPerAnnum: parsed.data.interestRateBpsPerAnnum ?? null,
      notes: parsed.data.notes ?? null,
      actorId,
    },
  });

  await logActivity({
    entityType: "TaxRuleSet",
    entityId: ruleSet.id,
    action: "UPDATE",
    before,
    after: ruleSet,
    actorId,
  });

  revalidatePath("/settings/tax-rule-sets");
  redirect("/settings/tax-rule-sets");
}
