import { z } from "zod";
import { YearEndCreditElection } from "@prisma/client";

/**
 * Brief #5f §7 — prior-year excess credit (item 55) is no longer entered
 * here. It's still stored on ClientTaxYear.priorYearExcessCreditCents, but
 * the starting figures page (lib/actions/startingFigures.ts) is now the
 * only place it's entered.
 */
export const clientTaxYearSchema = z.object({
  taxableYear: z.coerce.number().int().min(2000).max(2100),
  yearEndCreditElection: z.nativeEnum(YearEndCreditElection).default(YearEndCreditElection.NA),
});

export type ClientTaxYearInput = z.infer<typeof clientTaxYearSchema>;
