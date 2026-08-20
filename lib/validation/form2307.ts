import { z } from "zod";

const pesos = z
  .string()
  .trim()
  .regex(/^\d+(,\d{3})*(\.\d{1,2})?$/, "Enter a non-negative peso amount");

export const form2307Schema = z.object({
  payorName: z.string().trim().min(1, "Required"),
  payorTin: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  payorAddress: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  periodFrom: z.string().trim().min(1, "Required"),
  periodTo: z.string().trim().min(1, "Required"),
  quarterCovered: z.coerce.number().int().min(1).max(4),
  atcCode: z.string().trim().min(1, "Required"),
  incomePayment: pesos,
  taxWithheld: pesos,
  withholdingRateBps: z.coerce.number().int().min(0).max(10000),
  dateReceived: z
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

export type Form2307Input = z.infer<typeof form2307Schema>;
