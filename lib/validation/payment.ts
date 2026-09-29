import { z } from "zod";

const pesos = z
  .string()
  .trim()
  .min(1, "Enter the amount paid.")
  .regex(/^\d*(,\d{3})*(\.\d{1,2})?$/, "Enter a non-negative peso amount, e.g. 50,000.00");

/**
 * D75 (brief #5m §3.2) — step 8's (MAKE_PAYMENT) three required fields:
 * amount paid, date of payment, and the bank/channel paid through. The
 * full amount is always paid in one go (her own working practice — "never
 * in parts"), so this is a single figure, not a running total.
 */
export const paymentSchema = z.object({
  amountPaid: pesos,
  paymentDate: z.string().trim().min(1, "Enter the date of payment."),
  paymentChannel: z.string().trim().min(1, "Enter the bank or channel paid through."),
});

export type PaymentInput = z.infer<typeof paymentSchema>;
