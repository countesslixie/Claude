import { prisma } from "@/lib/prisma";
import { getFilingSheet } from "@/lib/filingComputation";
import { ALL_PERIODS } from "@/lib/tax/periods";
import { clientDocsDueDate } from "@/lib/tax/deadlines";
import { loadPackageDocuments } from "@/lib/documents/filingPackage";
import { buildClientPackageEmail, type ClientPackageEmail } from "@/lib/workflow/clientPackageEmail";

/**
 * D101/D102 (brief #5r) — the I/O half of step 16's email: gathers the
 * frozen sheet, the package's document list, the client's email and the
 * next return, then hands them to the pure builder. Used by the filing page
 * (live draft) and by markStepDone (the copy saved when step 16 is Done),
 * so what she sees and what gets saved cannot drift apart.
 */
export async function buildClientPackageEmailForFiling(filingId: string): Promise<ClientPackageEmail | null> {
  const filing = await prisma.filing.findUnique({ where: { id: filingId }, include: { client: true } });
  if (!filing) return null;

  const sheet = await getFilingSheet(filingId);
  const attachments = (await loadPackageDocuments(filingId)).filter((d) => d.inEmailList).map((d) => ({ label: d.label }));

  const nextPeriod = ALL_PERIODS[ALL_PERIODS.indexOf(filing.period) + 1] ?? null;
  const nextFiling = nextPeriod
    ? await prisma.filing.findUnique({
        where: { clientId_taxableYear_period: { clientId: filing.clientId, taxableYear: filing.taxableYear, period: nextPeriod } },
      })
    : null;

  const ruleSet = await prisma.taxRuleSet.findUnique({ where: { taxableYear: filing.taxableYear } });
  const firstName = filing.client.registeredName.trim().split(/\s+/)[0] ?? filing.client.registeredName;

  return buildClientPackageEmail({
    clientRegisteredName: filing.client.registeredName,
    clientFirstName: firstName,
    clientEmail: filing.client.email,
    period: filing.period,
    taxableYear: filing.taxableYear,
    formType: filing.formType,
    filedAt: filing.filedAt,
    sheet,
    attachments,
    next: nextFiling
      ? { period: nextFiling.period, taxableYear: nextFiling.taxableYear, formType: nextFiling.formType, dueDate: nextFiling.adjustedDueDate,
        docsDueDate: clientDocsDueDate(nextFiling.period, nextFiling.taxableYear, ruleSet?.clientDocsDueDay ?? 20),
      }
      : null,
  });
}
