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

/**
 * Brief #4b — one certificate row entered under a filing's step 2.
 * Essential fields (payor, amounts, date received) are required; the
 * remaining existing Form2307 fields (payor TIN/address, ATC code,
 * withholding rate, the certificate's own period) sit behind "more" and
 * are optional here — left blank, the action defaults them (period to
 * the filing's own quarter, rate to the client's default, ATC code left
 * empty and unverified per D19) rather than inventing a value.
 * quarterCovered is no longer a form field at all: it's derived from
 * the filing this certificate is entered under.
 */
export const certificateEntrySchema = z.object({
  payorName: z.string().trim().min(1, "Required"),
  incomePayment: pesos,
  taxWithheld: pesos,
  dateReceived: z.string().trim().min(1, "Required"),
  payorTin: optionalText,
  payorAddress: optionalText,
  atcCode: optionalText,
  withholdingRateBps: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : Number(v))),
  periodFrom: optionalText,
  periodTo: optionalText,
  notes: optionalText,
});

export type CertificateEntryInput = z.infer<typeof certificateEntrySchema>;
