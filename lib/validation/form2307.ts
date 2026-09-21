import { z } from "zod";

const pesos = z
  .string()
  .trim()
  .regex(/^\d+(,\d{3})*(\.\d{1,2})?$/, "Enter a non-negative peso amount");

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" || v === undefined ? undefined : v));

const optionalPercent = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" || v === undefined ? undefined : v))
  .refine((v) => v === undefined || /^\d+(\.\d{1,2})?$/.test(v), "Enter a non-negative percent");

/**
 * Brief #4b/#4c — one certificate row entered under a filing's step 2.
 * Essential fields (payor, amounts, date received, the period the
 * certificate covers) are required; the remaining existing Form2307
 * fields (payor TIN/address, ATC code, withholding rate) sit behind
 * "more" and are optional here — left blank, the action defaults them
 * (rate to the client's default, ATC code left empty and unverified per
 * D19) rather than inventing a value. quarterCovered is no longer a
 * form field at all: it's derived from the filing this certificate is
 * entered under. `withholdingRatePercent` is entered as a percent
 * ("5" or "5.00") and converted to basis points at the action boundary
 * (lib/money.ts's percentToBps) — no float arithmetic.
 */
export const certificateEntrySchema = z.object({
  payorName: z.string().trim().min(1, "Required"),
  incomePayment: pesos,
  taxWithheld: pesos,
  dateReceived: z.string().trim().min(1, "Required"),
  periodFrom: z.string().trim().min(1, "Required"),
  periodTo: z.string().trim().min(1, "Required"),
  payorTin: optionalText,
  payorAddress: optionalText,
  atcCode: optionalText,
  withholdingRatePercent: optionalPercent,
  notes: optionalText,
});

export type CertificateEntryInput = z.infer<typeof certificateEntrySchema>;
