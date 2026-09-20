import { z } from "zod";

const requiredPesos = z
  .string()
  .trim()
  .regex(/^\d+(,\d{3})*(\.\d{1,2})?$/, "Enter a non-negative peso amount");

const optionalPesos = z
  .string()
  .trim()
  .regex(/^\d*(,\d{3})*(\.\d{1,2})?$/, "Enter a non-negative peso amount")
  .optional()
  .default("0");

/**
 * D26/§5.5 — one quarterly declared gross sales figure per client per
 * quarter, plus non-operating income and an optional note on where the
 * figure came from. This is the only place income enters the system.
 */
export const quarterlySalesSchema = z.object({
  grossSales: requiredPesos,
  nonOperatingIncome: optionalPesos,
  sourceNote: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  notes: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

export type QuarterlySalesInput = z.infer<typeof quarterlySalesSchema>;
