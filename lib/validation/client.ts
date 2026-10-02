import { z } from "zod";
import { DateTime } from "luxon";

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

// Brief #6b (D146) — required on New and Edit. A real calendar date typed
// or picked as yyyy-mm-dd.
const requiredDate = z
  .string()
  .trim()
  .min(1, "Required")
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && DateTime.fromISO(v).isValid, "Enter a valid date");

// Brief #6b (D145) — the form no longer asks for taxpayer type, recognition
// basis, civil status, default WHT rate or the books fields. They are not in
// this schema on purpose: createClient writes fixed values for them and
// updateClient never touches them.
export const clientSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Required")
    .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers, and hyphens only"),
  registeredName: z.string().trim().min(1, "Required"),
  tradeName: optionalText,

  tin: z.string().trim().regex(/^\d{9}$/, "TIN must be exactly 9 digits"),
  branchCode: z.string().trim().min(1, "Required").default("000"),
  rdoCode: z.string().trim().min(1, "Required"),

  registeredAddress: z.string().trim().min(1, "Required"),
  birthDate: requiredDate,
  email: z
    .string()
    .trim()
    .email("Invalid email")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" ? undefined : v)),
  mobile: optionalText,

  lineOfBusiness: optionalText,
  psicCode: optionalText,

  isActive: z.boolean().default(true),
  engagedSince: optionalDate,
  notes: optionalText,
});

export type ClientInput = z.infer<typeof clientSchema>;
