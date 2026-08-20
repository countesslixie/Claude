import { prisma } from "@/lib/prisma";
import { ALL_PERIODS } from "@/lib/tax/periods";
import {
  resolveStatutoryDueDate,
  resolveAdjustedDueDate,
  deriveWorkingCalendar,
} from "@/lib/tax/deadlines";
import { resolveFormType } from "@/lib/tax/compute";
import type { Period } from "@/lib/tax/types";
import { getActorId } from "@/lib/actor";
import { logActivity } from "@/lib/activityLog";

/**
 * Generates every Filing (and its WorkflowStep checklist) a client needs
 * for a taxable year, in one pass. Iterates ALL_PERIODS — the single
 * source of truth for "no Q4" (SPEC.md 3.6, §16 item 6) — never a
 * hand-typed period list. Safe to call repeatedly: a period whose Filing
 * already exists is left untouched, so this can be re-run after adding a
 * new client or fixing a Holiday-table gap without disturbing filings
 * already in progress.
 */
export async function generateFilingsForClientYear(
  clientId: string,
  taxableYear: number,
): Promise<{ createdPeriods: Period[]; skippedPeriods: Period[] }> {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  const ruleSet = await prisma.taxRuleSet.findUniqueOrThrow({ where: { taxableYear } });

  // Holidays can matter in either calendar year touched by this taxable
  // year's returns (a quarterly due date falls within taxableYear itself;
  // the ANNUAL due date falls in taxableYear + 1).
  const holidays = await prisma.holiday.findMany({
    where: {
      date: {
        gte: new Date(Date.UTC(taxableYear, 0, 1)),
        lte: new Date(Date.UTC(taxableYear + 1, 11, 31)),
      },
    },
  });
  const holidayDates = holidays.map((h) => h.date);

  const templates = await prisma.workflowStepTemplate.findMany({
    where: { isActive: true },
    orderBy: { sequence: "asc" },
  });

  // The client's own default withholding rate is the best available
  // signal, at generation time, for "does this client typically receive
  // Form 2307s at all." requiresSawt itself stays a genuinely derived,
  // per-filing figure (SPEC.md 5: "derived: any Form2307 in period") that
  // recomputeRequiresSawt() refines once real certificates exist — this
  // is only the starting assumption, so RECEIVE_2307 isn't wrongly
  // skipped for a client who obviously expects certificates just because
  // none have arrived yet for a brand-new future period.
  const clientExpectsForm2307 = client.defaultWithholdingRateBps != null;

  const actorId = await getActorId();
  const createdPeriods: Period[] = [];
  const skippedPeriods: Period[] = [];

  for (const period of ALL_PERIODS) {
    const existing = await prisma.filing.findUnique({
      where: { clientId_taxableYear_period: { clientId, taxableYear, period } },
    });
    if (existing) {
      skippedPeriods.push(period);
      continue;
    }

    const statutoryDueDate = resolveStatutoryDueDate(taxableYear, period, ruleSet);
    const adjustedDueDate = resolveAdjustedDueDate(statutoryDueDate, holidayDates);
    const { certificatesExpectedBy, internalFilingTarget } = deriveWorkingCalendar(period, statutoryDueDate);
    const formType = resolveFormType({ period, taxpayerType: client.taxpayerType });

    // requiresSawt is genuinely derived from actual Form2307 records
    // (SPEC.md 5), which is always zero for a brand-new filing — it
    // starts false regardless of clientExpectsForm2307 (that signal only
    // drives whether RECEIVE_2307 itself applies, below) and gets
    // refined by recomputeRequiresSawt() as real certificates arrive.
    const filing = await prisma.filing.create({
      data: {
        clientId,
        taxableYear,
        period,
        formType,
        statutoryDueDate,
        adjustedDueDate,
        certificatesExpectedBy,
        internalFilingTarget,
        actorId,
      },
    });

    await instantiateWorkflowSteps(filing.id, {
      templates,
      requiresSawt: false,
      clientExpectsForm2307,
      certificatesExpectedBy,
      actorId,
    });

    await logActivity({ entityType: "Filing", entityId: filing.id, action: "CREATE", after: filing, actorId });

    createdPeriods.push(period);
  }

  return { createdPeriods, skippedPeriods };
}

interface StepTemplateRow {
  stepCode: string;
  sequence: number;
  title: string;
  description: string | null;
  category: string;
  isConditional: boolean;
  conditionExpression: string | null;
  isWaitingState: boolean;
  waitingOnLabel: string | null;
  expectedResponseDays: number | null;
  requiredDocSlots: unknown;
}

/**
 * Instantiates one WorkflowStep per active template row (SPEC.md 7.1),
 * applying:
 *   - steps 11-14 (isConditional, "requiresSawt == true") -> NA when the
 *     filing has no SAWT requirement, excluded from progress % (§16 item 12)
 *   - RECEIVE_2307 -> SKIPPED with a reason when the client never
 *     receives Form 2307s at all
 *   - RECEIVE_2307, otherwise -> WAITING_EXTERNAL from the moment the
 *     filing is generated, with its clock stamped at certificatesExpectedBy,
 *     not "now" (SPEC.md 3.6 — the waiting clock starts from when
 *     certificates are expected, not when the bookkeeper happens to open
 *     the app and notice)
 */
export async function instantiateWorkflowSteps(
  filingId: string,
  opts: {
    templates: StepTemplateRow[];
    requiresSawt: boolean;
    clientExpectsForm2307: boolean;
    certificatesExpectedBy: Date | null;
    actorId: string;
  },
) {
  for (const template of opts.templates) {
    let status: "PENDING" | "WAITING_EXTERNAL" | "NA" | "SKIPPED" = "PENDING";
    let waitingSince: Date | null = null;
    let skippedReason: string | null = null;

    if (template.isConditional && !opts.requiresSawt) {
      status = "NA";
    } else if (template.stepCode === "RECEIVE_2307" && !opts.clientExpectsForm2307) {
      status = "SKIPPED";
      skippedReason = "No withholding agents / no Form 2307 expected for this client this period.";
    } else if (template.stepCode === "RECEIVE_2307") {
      status = "WAITING_EXTERNAL";
      waitingSince = opts.certificatesExpectedBy;
    }

    await prisma.workflowStep.create({
      data: {
        filingId,
        stepCode: template.stepCode,
        sequence: template.sequence,
        title: template.title,
        description: template.description,
        category: template.category as never,
        status,
        isConditional: template.isConditional,
        conditionExpression: template.conditionExpression,
        isWaitingState: template.isWaitingState,
        waitingOnLabel: template.waitingOnLabel,
        expectedResponseDays: template.expectedResponseDays,
        waitingSince,
        requiredDocSlots:
          typeof template.requiredDocSlots === "string"
            ? template.requiredDocSlots
            : JSON.stringify(template.requiredDocSlots),
        skippedReason,
        actorId: opts.actorId,
      },
    });
  }
}

/**
 * Recomputes Filing.requiresSawt from actual Form2307 records (SPEC.md 5:
 * "derived: any Form2307 in period"). Call this whenever a Form2307 is
 * created/deleted for a client. If requiresSawt flips from false to true,
 * un-NA's steps 11-14 back to PENDING so they become visible — a filing
 * generated when no certificates were expected can still turn out to
 * need SAWT once one actually arrives.
 */
export async function recomputeRequiresSawt(clientId: string, taxableYear: number, period: Period) {
  const filing = await prisma.filing.findUnique({
    where: { clientId_taxableYear_period: { clientId, taxableYear, period } },
  });
  if (!filing) return;

  // ANNUAL consolidates the whole year: any certificate in taxableYear
  // (any quarterCovered) means the annual return needs SAWT too, not
  // only a certificate specifically tagged quarterCovered 4.
  const certCount = await prisma.form2307.count({
    where: {
      clientId,
      taxableYear,
      deletedAt: null,
      ...(period === "ANNUAL" ? {} : { quarterCovered: periodToQuarterCovered(period) }),
    },
  });
  const requiresSawt = certCount > 0;
  if (requiresSawt === filing.requiresSawt) return;

  const actorId = await getActorId();
  await prisma.filing.update({ where: { id: filing.id }, data: { requiresSawt, actorId } });

  if (requiresSawt) {
    await prisma.workflowStep.updateMany({
      where: { filingId: filing.id, isConditional: true, status: "NA" },
      data: { status: "PENDING" },
    });
  }
}

/** Form2307.quarterCovered is 1-3 for quarterly periods; ANNUAL certificates are recorded against quarter 4. */
function periodToQuarterCovered(period: Period): number {
  switch (period) {
    case "Q1":
      return 1;
    case "Q2":
      return 2;
    case "Q3":
      return 3;
    case "ANNUAL":
      return 4;
  }
}
