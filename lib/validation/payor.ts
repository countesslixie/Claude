import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" || v === undefined ? undefined : v));

/**
 * Brief #5a — one saved "Customers / payors" entry for a client (the
 * Payor table). Purely a shared reference of names/details: nothing here
 * feeds gross sales or a certificate's own numbers (D26/D33 untouched).
 * usualAtcCode is validated against the active AtcCode list at the action
 * boundary, not here, since this schema has no database access.
 */
export const payorSchema = z.object({
  name: z.string().trim().min(1, "Required"),
  tin: optionalText,
  address: optionalText,
  usualAtcCode: optionalText,
  isActive: z.boolean().default(true),
});

export type PayorInput = z.infer<typeof payorSchema>;
