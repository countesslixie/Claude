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
 * Brief #4b (D33) — one customer row contributing to a quarter's gross
 * sales. customerName is required whenever a row is kept at all; a row
 * with both fields blank is dropped before validation (see
 * lib/actions/quarterlySales.ts), so "add a row, then remove it" never
 * has to pass validation on an empty row.
 */
export const quarterlySalesCustomerRowSchema = z.object({
  customerName: z.string().trim().min(1, "Customer name is required"),
  amount: requiredPesos,
});

/**
 * D26/D33 (§5.5, brief #4b) — a quarter's gross sales is the sum of zero
 * or more per-customer rows, plus non-operating income and an optional
 * note on where the figures came from. This is the only place income
 * enters the system. `intent` distinguishes a draft save (stores the
 * rows, step 1 stays not-done) from a final save (marks step 1 done).
 * `noSalesThisQuarter` is a deliberate ₱0 — mutually exclusive with any
 * customer rows, which are ignored when it is set.
 */
export const quarterlySalesSchema = z.object({
  intent: z.enum(["draft", "final"]),
  noSalesThisQuarter: z.boolean().default(false),
  customers: z.array(quarterlySalesCustomerRowSchema),
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
export type QuarterlySalesCustomerRowInput = z.infer<typeof quarterlySalesCustomerRowSchema>;
