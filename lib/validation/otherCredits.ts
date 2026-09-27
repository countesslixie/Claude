import { z } from "zod";
import { pesosToCents } from "@/lib/money";

const pesos = z
  .string()
  .trim()
  .regex(/^\d*(,\d{3})*(\.\d{1,2})?$/, "Enter a non-negative peso amount, e.g. 50,000.00");

/**
 * Brief #5f §3 — item 61 (1701Q) / item 63 (1701A), "Other Tax
 * Credits/Payments," now one figure PER RETURN (Filing.otherCreditsCents),
 * not per client-year. Amount >= 0 (enforced by the regex above, which
 * never accepts a leading minus); a description is required once the
 * amount is above zero.
 */
export const otherCreditsSchema = z
  .object({
    otherCredits: pesos.default("0"),
    otherCreditsDescription: z.string().trim().max(200).optional().default(""),
  })
  .superRefine((data, ctx) => {
    // A malformed amount already fails the regex above (its own field
    // error); guard here too since a refinement can still run against the
    // raw string regardless (pesosToCents would otherwise throw on
    // something the regex already rejected).
    let cents = 0;
    try {
      cents = pesosToCents(data.otherCredits);
    } catch {
      return;
    }
    if (cents > 0 && data.otherCreditsDescription.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["otherCreditsDescription"],
        message: "A description is required when the amount is above zero.",
      });
    }
  });

export type OtherCreditsInput = z.infer<typeof otherCreditsSchema>;
