import { z } from "zod";

export const holidaySchema = z
  .object({
    date: z.string().trim().min(1, "Required"),
    name: z.string().trim().min(1, "Required"),
    type: z.enum(["REGULAR", "SPECIAL_NON_WORKING"]),
    scope: z.enum(["NATIONAL", "LOCAL"]).default("NATIONAL"),
    localScope: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v === "" ? undefined : v)),
  })
  .refine((v) => v.scope !== "LOCAL" || !!v.localScope, {
    message: "Required when scope is Local",
    path: ["localScope"],
  });

export type HolidayInput = z.infer<typeof holidaySchema>;
