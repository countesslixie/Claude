import { z } from "zod";
import { Regime, ElectionStatus, YearEndCreditElection } from "@prisma/client";

const pesos = z
  .string()
  .trim()
  .regex(/^\d*(,\d{3})*(\.\d{1,2})?$/, "Enter a non-negative peso amount, e.g. 50,000.00");

export const clientTaxYearSchema = z.object({
  taxableYear: z.coerce.number().int().min(2000).max(2100),
  regime: z.nativeEnum(Regime),
  electionStatus: z.nativeEnum(ElectionStatus),
  priorYearExcessCredit: pesos.default("0"),
  yearEndCreditElection: z.nativeEnum(YearEndCreditElection).default(YearEndCreditElection.NA),
});

export type ClientTaxYearInput = z.infer<typeof clientTaxYearSchema>;
