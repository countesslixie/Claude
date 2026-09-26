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
 * Brief #4b/#4c/#4d — one certificate row entered under a filing's step
 * 2. quarterCovered is not a form field at all: it's derived from the
 * filing this certificate is entered under. `withholdingRatePercent` is
 * entered as a percent ("5" or "5.00") and converted to basis points at
 * the action boundary (lib/money.ts's percentToBps) — no float
 * arithmetic. Brief #4d removed dateReceived entirely — its last two
 * readers (the SAWT keying worksheet's row order, the annual
 * reconciliation's year attribution) were switched to read the filing
 * this certificate was entered under instead.
 *
 * Brief #5a — payorTin, payorAddress and atcCode are now required
 * alongside the fields that already were, folded into one main form (the
 * old "more" disclosure held nothing required once these three joined
 * it, so it's gone — see components/certificate-form.tsx). atcCode is
 * chosen from a picker of active AtcCode rows, never free-typed.
 * withholdingRatePercent stays optional here: left blank, the action
 * defaults it to the chosen ATC code's own rate (lib/actions/form2307.ts)
 * rather than the client's default, since the rate is now a property of
 * the code (D19 — never invent a rate).
 */
export const certificateEntrySchema = z.object({
  payorName: z.string().trim().min(1, "Required"),
  payorTin: z.string().trim().min(1, "Required"),
  payorAddress: z.string().trim().min(1, "Required"),
  atcCode: z.string().trim().min(1, "Required"),
  incomePayment: pesos,
  taxWithheld: pesos,
  periodFrom: z.string().trim().min(1, "Required"),
  periodTo: z.string().trim().min(1, "Required"),
  withholdingRatePercent: optionalPercent,
  notes: optionalText,
});

export type CertificateEntryInput = z.infer<typeof certificateEntrySchema>;
