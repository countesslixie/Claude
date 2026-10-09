import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { StartingFiguresForm, type StartingFiguresValues } from "@/components/starting-figures-form";
import { saveStartingFigures } from "@/lib/actions/startingFigures";
import { getStartingFigures, isStartingFiguresLocked } from "@/lib/startingFigures";
import { centsToPesos } from "@/lib/money";

// D175 — always rendered fresh from the database, never prerendered at build time.
export const dynamic = "force-dynamic";

/**
 * Brief #5f §8 — the starting figures page for a client-year, opened from
 * the client page's Taxable years row. A few figures entered once, from
 * the client's latest return filed outside the app, carried into the
 * app's own first return of the year and into the Annual
 * (lib/filingComputation.ts).
 */
export default async function StartingFiguresPage({
  params,
}: {
  params: Promise<{ id: string; taxYearId: string }>;
}) {
  const { id, taxYearId } = await params;
  const taxYear = await prisma.clientTaxYear.findUnique({ where: { id: taxYearId }, include: { client: true } });
  if (!taxYear || taxYear.clientId !== id) notFound();

  const existing = await getStartingFigures(id, taxYear.taxableYear);
  const locked = await isStartingFiguresLocked(id, taxYear.taxableYear, existing?.latestOutsideReturn ?? "NONE");

  const initialValues: StartingFiguresValues = {
    latestOutsideReturn: existing?.latestOutsideReturn ?? "NONE",
    priorYearExcessCredit: centsToPesos(existing?.priorYearExcessCreditCents ?? taxYear.priorYearExcessCreditCents ?? 0),
    cumulativeIncome: centsToPesos(existing?.cumulativeIncomeCents ?? 0),
    withholdingPreviousQuarters: centsToPesos(existing?.withholdingPreviousQuartersCents ?? 0),
    withholdingThisQuarter: centsToPesos(existing?.withholdingThisQuarterCents ?? 0),
    paymentsPreviousQuarters: centsToPesos(existing?.paymentsPreviousQuartersCents ?? 0),
    amountPaidThisReturn: centsToPesos(existing?.amountPaidThisReturnCents ?? 0),
    otherCredits: centsToPesos(existing?.otherCreditsCents ?? 0),
    otherCreditsDescription: existing?.otherCreditsDescription ?? "",
    nonOperatingIncome: centsToPesos(existing?.nonOperatingIncomeCents ?? 0),
  };

  const boundAction = saveStartingFigures.bind(null, id, taxYear.taxableYear);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold text-ink">
          <span className="block">Starting figures — {taxYear.client.registeredName}</span>
          <span className="block">TY{taxYear.taxableYear}</span>
        </h1>
        <Link href={`/clients/${id}`}>
          <Button variant="secondary">
            Back to client
          </Button>
        </Link>
      </div>
      <StartingFiguresForm action={boundAction} locked={locked} hasSavedRow={existing != null} initialValues={initialValues} />
    </div>
  );
}
