import { z } from "zod";

const monthDay = z
  .string()
  .trim()
  .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Use MM-DD format, e.g. 04-15");

const pesos = z
  .string()
  .trim()
  .regex(/^\d+(,\d{3})*(\.\d{1,2})?$/, "Enter a non-negative peso amount, e.g. 3,000,000.00");

const optionalBps = z
  .union([z.coerce.number().int().min(0).max(100000), z.literal("")])
  .optional()
  .transform((v) => (v === "" || v === undefined ? undefined : v));

export const taxRuleSetSchema = z.object({
  taxableYear: z.coerce.number().int().min(2000).max(2100),
  effectiveFrom: z.string().trim().min(1, "Required"),
  effectiveTo: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),

  incomeTaxRateBps: z.coerce.number().int().min(0).max(10000),
  vatThreshold: pesos,
  allowableDeduction: pesos,

  q1DueMonthDay: monthDay,
  q2DueMonthDay: monthDay,
  q3DueMonthDay: monthDay,
  annualDueMonthDay: monthDay,

  sawtDeadlineOffsetDays: z.coerce.number().int().min(0).max(365),
  eafsDeadlineOffsetDays: z.coerce.number().int().min(0).max(365),

  surchargeRateBps: optionalBps,
  interestRateBpsPerAnnum: optionalBps,

  notes: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

export type TaxRuleSetInput = z.infer<typeof taxRuleSetSchema>;
