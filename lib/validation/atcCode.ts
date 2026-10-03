import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" || v === undefined ? undefined : v));

/**
 * Brief #5a — the ATC code maintenance screen (Settings). The rate is a
 * property of the code (percent entry, converted to basis points at the
 * action boundary via lib/money.ts's percentToBps — no float arithmetic).
 * Never invent a code or a rate here (D19) — this schema only validates
 * shape; it is the bookkeeper who supplies every value.
 */
export const atcCodeSchema = z.object({
  code: z.string().trim().min(1, "Required"),
  description: z.string().trim().min(1, "Required"),
  ratePercent: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter a non-negative percent, e.g. 5 or 5.00"),
  isActive: z.boolean().default(true),
  notes: optionalText,
});

export type AtcCodeInput = z.infer<typeof atcCodeSchema>;
