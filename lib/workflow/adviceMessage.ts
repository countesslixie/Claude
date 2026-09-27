import { prisma } from "@/lib/prisma";
import { assembleAndComputeFiling, hasSalesRecordedForPeriod } from "@/lib/filingComputation";
import { extractFormSummary } from "@/lib/tax/compute";
import { clientPaymentDueDate } from "@/lib/tax/deadlines";
import { buildClientTaxAdviceMessage } from "@/lib/workflow/clientTaxAdviceMessage";

/**
 * Brief #5d §8 / #5e §3 §9 — assembles step 4's client advice message from
 * a filing's LIVE figures. This is the single source both the filing page
 * (the live preview shown while step 4 is still PENDING) and markStepDone
 * (what gets frozen onto Filing.adviceMessageSubject/Body when step 4 is
 * marked Done) call, so they can never drift apart from each other.
 *
 * Returns null when there's nothing to build yet: no sales recorded for
 * this filing's own period, or the form isn't one of the two in scope
 * (MIXED_INCOME's annual return, Form 1701, has no sheet built).
 */
export async function buildLiveAdviceMessageForFiling(
  filingId: string,
): Promise<{ subject: string; body: string } | null> {
  const filing = await prisma.filing.findUnique({ where: { id: filingId }, include: { client: true } });
  if (!filing) return null;

  const hasSalesRecorded = await hasSalesRecordedForPeriod(filing.clientId, filing.taxableYear, filing.period);
  if (!hasSalesRecorded) return null;

  const sheet = await assembleAndComputeFiling(filing.clientId, filing.taxableYear, filing.period);
  if (sheet.formType !== "F1701Q" && sheet.formType !== "F1701A") return null;

  const summaryFigures = extractFormSummary(sheet);

  const [clientTaxYear, ruleSet, holidays] = await Promise.all([
    prisma.clientTaxYear.findUnique({
      where: { clientId_taxableYear: { clientId: filing.clientId, taxableYear: filing.taxableYear } },
    }),
    prisma.taxRuleSet.findUnique({ where: { taxableYear: filing.taxableYear } }),
    prisma.holiday.findMany({
      where: {
        date: {
          gte: new Date(Date.UTC(filing.taxableYear - 1, 0, 1)),
          lte: new Date(Date.UTC(filing.taxableYear + 1, 11, 31)),
        },
      },
    }),
  ]);

  const clientDueDate = clientPaymentDueDate(
    filing.adjustedDueDate,
    ruleSet?.clientPaymentLeadDays ?? 10,
    holidays.map((h) => h.date),
  );
  const clientFirstName = filing.client.registeredName.trim().split(/\s+/)[0] ?? filing.client.registeredName;

  return buildClientTaxAdviceMessage({
    clientRegisteredName: filing.client.registeredName,
    clientFirstName,
    period: filing.period,
    taxableYear: filing.taxableYear,
    formType: sheet.formType,
    grossSalesCents: summaryFigures.grossSalesCents,
    taxDueCents: summaryFigures.taxDueCents,
    totalCreditsCents: summaryFigures.totalCreditsCents,
    taxPayableCents: sheet.taxPayableCents,
    isOverpayment: sheet.isOverpayment,
    overpaymentCents: sheet.overpaymentCents,
    clientDueDate,
    yearEndCreditElection: clientTaxYear?.yearEndCreditElection,
  });
}
