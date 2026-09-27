import { z } from "zod";

/**
 * Brief #5e §8 — items 55/57 (prior-year excess credit) and 61/63 (other
 * tax credits/payments), edited inline from a filing's computation sheet.
 * Pesos-with-centavos strings, converted to integer centavos at the
 * boundary (lib/money.ts's pesosToCents) — never floats.
 */
const pesos = z
  .string()
  .trim()
  .regex(/^\d*(,\d{3})*(\.\d{1,2})?$/, "Enter a non-negative peso amount, e.g. 50,000.00");

export const yearLevelCreditsSchema = z.object({
  priorYearExcessCredit: pesos.default("0"),
  otherCredits: pesos.default("0"),
  otherCreditsDescription: z.string().trim().max(200).optional().default(""),
});

export type YearLevelCreditsInput = z.infer<typeof yearLevelCreditsSchema>;
