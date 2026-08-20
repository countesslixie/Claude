import { z } from "zod";

const pesos = z
  .string()
  .trim()
  .regex(/^\d*(,\d{3})*(\.\d{1,2})?$/, "Enter a non-negative peso amount");

/** Quick-entry row: manual standalone transaction entry (SPEC.md 12, exception path). */
export const quickTransactionSchema = z.object({
  transactionDate: z.string().trim().min(1, "Required"),
  orNumber: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  payorName: z.string().trim().min(1, "Required"),
  payorTin: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  grossAmount: pesos,
  withholdingRateBps: z.coerce.number().int().min(0).max(10000).default(0),
  withholdingAmount: pesos.optional().default("0"),
  netReceivedOverride: pesos.optional(),
  incomeType: z.enum(["OPERATING", "NON_OPERATING"]).default("OPERATING"),
  description: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

export type QuickTransactionInput = z.infer<typeof quickTransactionSchema>;
