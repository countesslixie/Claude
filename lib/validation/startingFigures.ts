import { z } from "zod";
import { pesosToCents } from "@/lib/money";

const pesos = z
  .string()
  .trim()
  .regex(/^\d*(,\d{3})*(\.\d{1,2})?$/, "Enter a non-negative peso amount, e.g. 50,000.00");

/**
 * Brief #5f §8 — the handful of figures a mid-year client brings in from
 * her own outside-the-app filing. `priorYearExcessCredit` (item 55) is
 * always entered, regardless of `latestOutsideReturn`; every other field
 * only actually matters when `latestOutsideReturn` isn't NONE (the form
 * doesn't show them otherwise, and they're left at their zero default).
 * Money stays integer centavos, converted at the boundary
 * (lib/money.ts's pesosToCents) — never floats.
 */
export const startingFiguresSchema = z
  .object({
    latestOutsideReturn: z.enum(["NONE", "Q1", "Q2", "Q3"]),
    priorYearExcessCredit: pesos.default("0"),
    cumulativeIncome: pesos.default("0"),
    withholdingPreviousQuarters: pesos.default("0"),
    withholdingThisQuarter: pesos.default("0"),
    paymentsPreviousQuarters: pesos.default("0"),
    amountPaidThisReturn: pesos.default("0"),
    otherCredits: pesos.default("0"),
    otherCreditsDescription: z.string().trim().max(200).optional().default(""),
    nonOperatingIncome: pesos.default("0"),
  })
  .superRefine((data, ctx) => {
    if (data.latestOutsideReturn === "NONE") return;

    // Malformed amounts already fail the regex above (their own field
    // errors); guard here too since a refinement can still run against the
    // raw strings regardless (pesosToCents would otherwise throw on
    // something the regex already rejected).
    const safeCents = (value: string): number | null => {
      try {
        return pesosToCents(value);
      } catch {
        return null;
      }
    };
    const nonOperating = safeCents(data.nonOperatingIncome);
    const cumulative = safeCents(data.cumulativeIncome);
    if (nonOperating != null && cumulative != null && nonOperating > cumulative) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nonOperatingIncome"],
        message: "Non-operating income can't exceed cumulative income.",
      });
    }
    const otherCredits = safeCents(data.otherCredits);
    if (otherCredits != null && otherCredits > 0 && data.otherCreditsDescription.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["otherCreditsDescription"],
        message: "A description is required when the amount is above zero.",
      });
    }
  });

export type StartingFiguresInput = z.infer<typeof startingFiguresSchema>;
