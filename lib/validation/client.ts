import { z } from "zod";
import { TaxpayerType, BooksType, CivilStatus, RecognitionBasis } from "@prisma/client";

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

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
  email: z
    .string()
    .trim()
    .email("Invalid email")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" ? undefined : v)),
  mobile: optionalText,

  taxpayerType: z.nativeEnum(TaxpayerType),
  lineOfBusiness: optionalText,
  psicCode: optionalText,
  civilStatus: z
    .union([z.nativeEnum(CivilStatus), z.literal("")])
    .optional()
    .transform((v) => (v === "" ? undefined : v)),

  booksType: z.nativeEnum(BooksType),
  booksRegistrationDate: optionalDate,
  booksPermitNumber: optionalText,

  swornDeclarationOnFile: z.boolean().default(false),
  swornDeclarationYear: z
    .union([z.coerce.number().int().min(2000).max(2100), z.literal("")])
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : v)),

  eBIRFormsEmail: z
    .string()
    .trim()
    .email("Invalid email")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" ? undefined : v)),
  eFPSEnrolled: z.boolean().default(false),
  defaultWithholdingRateBps: z
    .union([z.coerce.number().int().min(0).max(10000), z.literal("")])
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : v)),

  recognitionBasis: z.nativeEnum(RecognitionBasis).default(RecognitionBasis.COLLECTION),

  isActive: z.boolean().default(true),
  engagedSince: optionalDate,
  notes: optionalText,
});

export type ClientInput = z.infer<typeof clientSchema>;
