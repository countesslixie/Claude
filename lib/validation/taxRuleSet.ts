import { z } from "zod";

const monthDay = z
  .string()
  .trim()
  .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Use MM-DD format, e.g. 04-15");

const pesos = z
  .string()
  .trim()
  .regex(/^\d+(,\d{3})*(\.\d{1,2})?$/, "Enter a non-negative peso amount, e.g. 3,000,000.00");

// D105/D110-era plain wording (brief #5t): rates are typed as percentages ("8" or "8.00") and
// converted to basis points at the action boundary (lib/money.ts's percentToBps).
const percentText = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter a percent, e.g. 8 or 8.00");

export const taxRuleSetSchema = z.object({
  taxableYear: z.coerce.number().int().min(2000).max(2100),
  effectiveFrom: z.string().trim().min(1, "Required"),
  effectiveTo: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),

  incomeTaxRatePercent: percentText.refine((v) => Number(v) <= 100, "Enter a percent between 0 and 100"),
  vatThreshold: pesos,
  allowableDeduction: pesos,

  q1DueMonthDay: monthDay,
  q2DueMonthDay: monthDay,
  q3DueMonthDay: monthDay,
  annualDueMonthDay: monthDay,

  sawtDeadlineOffsetDays: z.coerce.number().int().min(0).max(365),
  eafsDeadlineOffsetDays: z.coerce.number().int().min(0).max(365),
  // D87 (brief #5o) — the BIR eSubmission address the DAT-file email draft goes to.
  eSubmissionEmail: z.string().trim().email("Enter an email address"),
  // D106 (brief #5s) — the day of the month after each period ends by which the client sends documents (her engagement letter).
  clientDocsDueDay: z.coerce.number().int().min(1).max(28),

  notes: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

export type TaxRuleSetInput = z.infer<typeof taxRuleSetSchema>;
