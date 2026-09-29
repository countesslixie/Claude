/**
 * Seed data for local development and demos.
 *
 * - One seeded User (single-operator MVP; every mutation's actorId defaults
 *   to this row — SPEC.md section 2).
 * - TaxRuleSet rows for TY2025 and TY2026 (current year), with only the
 *   figures given explicitly in SPEC.md section 3. Surcharge/interest rates
 *   are left null rather than guessed — confirm against the current BIR
 *   issuance before use (SPEC.md 3.7, 17).
 * - Holiday rows for 2025-2027 (SPEC.md 3.6). A starter list — maintain it
 *   from Settings.
 * - A sparse, unverified AtcCode table (SPEC.md 3.5) — do not add codes
 *   here without confirming them against the current BIR ATC list (D19).
 * - The 16-step WorkflowStepTemplate.
 * - Brief #5n (D82): eight labelled, fictitious sample clients — one
 *   scenario each — built in prisma/seedScenarios.ts by calling the real
 *   server actions (saveQuarterlySales, addCertificate, markStepDone,
 *   savePayment, uploadDocument, ...), so nothing is hand-set that the app
 *   would have produced itself. Every past-due filing is either Complete or
 *   doesn't exist. See CURRENT_STATE.md's "Sample data" table.
 *
 * The reference data above is upserted, so running this again is safe. The
 * sample clients are only built when none of them exist yet. To start from
 * an empty database, run "npx prisma migrate reset --force" (it drops the
 * database, re-applies the migrations and runs this seed).
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CENTS = (pesos: number) => Math.round(pesos * 100);

async function seedUser() {
  return prisma.user.upsert({
    where: { email: "raynelly.joguilon@gmail.com" },
    update: {},
    create: { name: "Bookkeeper", email: "raynelly.joguilon@gmail.com" },
  });
}

async function seedTaxRuleSets(actorId: string) {
  for (const taxableYear of [2025, 2026]) {
    await prisma.taxRuleSet.upsert({
      where: { taxableYear },
      update: {},
      create: {
        taxableYear,
        effectiveFrom: new Date(Date.UTC(taxableYear, 0, 1)),
        effectiveTo: null,
        incomeTaxRateBps: 800, // 8.00% — SPEC.md 3.2
        vatThresholdCents: CENTS(3_000_000), // SPEC.md 3.1
        allowableDeductionCents: CENTS(250_000), // SPEC.md 3.2
        q1DueMonthDay: "05-15", // resolved, SPEC.md 3.6 (formerly Open Question 1)
        q2DueMonthDay: "08-15",
        q3DueMonthDay: "11-15",
        annualDueMonthDay: "04-15", // of the following year
        sawtDeadlineOffsetDays: 0,
        eafsDeadlineOffsetDays: 15,
        surchargeRateBps: null,
        interestRateBpsPerAnnum: null,
        compromisePenaltySchedule: undefined,
        notes:
          "Late-filing rates (surcharge/interest/compromise) are unconfirmed placeholders — verify against the current BIR issuance before live use (SPEC.md 3.7).",
        actorId,
      },
    });
  }
}

const HOLIDAYS: Array<{ date: string; name: string; type: "REGULAR" | "SPECIAL_NON_WORKING" }> = [
  // 2025
  { date: "2025-04-09", name: "Araw ng Kagitingan", type: "REGULAR" },
  { date: "2025-04-17", name: "Maundy Thursday", type: "REGULAR" },
  { date: "2025-04-18", name: "Good Friday", type: "REGULAR" },
  { date: "2025-08-15", name: "Assumption of the Blessed Virgin Mary (Fri)", type: "SPECIAL_NON_WORKING" },
  { date: "2025-11-01", name: "All Saints' Day", type: "SPECIAL_NON_WORKING" },
  { date: "2025-11-15", name: "Additional special (non-working) day", type: "SPECIAL_NON_WORKING" },
  { date: "2025-12-25", name: "Christmas Day", type: "REGULAR" },
  { date: "2025-12-30", name: "Rizal Day", type: "REGULAR" },
  // 2026
  { date: "2026-01-01", name: "New Year's Day", type: "REGULAR" },
  { date: "2026-04-09", name: "Araw ng Kagitingan", type: "REGULAR" },
  { date: "2026-04-02", name: "Maundy Thursday", type: "REGULAR" },
  { date: "2026-04-03", name: "Good Friday", type: "REGULAR" },
  { date: "2026-08-15", name: "Assumption of the Blessed Virgin Mary (Sat)", type: "SPECIAL_NON_WORKING" },
  { date: "2026-11-01", name: "All Saints' Day", type: "SPECIAL_NON_WORKING" },
  { date: "2026-12-25", name: "Christmas Day", type: "REGULAR" },
  { date: "2026-12-30", name: "Rizal Day", type: "REGULAR" },
  // 2027
  { date: "2027-01-01", name: "New Year's Day", type: "REGULAR" },
  { date: "2027-04-15", name: "Good Friday", type: "REGULAR" },
  { date: "2027-11-01", name: "All Saints' Day", type: "SPECIAL_NON_WORKING" },
  { date: "2027-12-25", name: "Christmas Day", type: "REGULAR" },
  { date: "2027-12-30", name: "Rizal Day", type: "REGULAR" },
];

async function seedHolidays(actorId: string) {
  for (const h of HOLIDAYS) {
    const date = new Date(`${h.date}T00:00:00.000Z`);
    const existing = await prisma.holiday.findFirst({ where: { date, scope: "NATIONAL" } });
    if (existing) continue;
    await prisma.holiday.create({
      data: { date, name: h.name, type: h.type, scope: "NATIONAL", actorId },
    });
  }
}

async function seedAtcCodes() {
  const disclaimer =
    "Confirm this code and rate against the current BIR Alphanumeric Tax Code (ATC) list before live use (SPEC.md 3.5, 17.5).";
  await prisma.atcCode.upsert({
    where: { code: "WI010" },
    update: {},
    create: {
      code: "WI010",
      description:
        "Professional fees / talent fees paid to individual payees who have furnished a sworn declaration that gross income will not exceed ₱3,000,000",
      rateBps: 500,
      payeeType: "Individual",
      verifiedAgainstIssuance: false,
      notes: disclaimer,
    },
  });
  await prisma.atcCode.upsert({
    where: { code: "WI011" },
    update: {},
    create: {
      code: "WI011",
      description:
        "Professional fees / talent fees paid to individual payees who have NOT furnished a sworn declaration, or whose gross income exceeds ₱3,000,000",
      rateBps: 1000,
      payeeType: "Individual",
      verifiedAgainstIssuance: false,
      notes: disclaimer,
    },
  });
}


const WORKFLOW_STEP_TEMPLATE: Array<{
  stepCode: string;
  sequence: number;
  title: string;
  description?: string;
  category: "PREP" | "FILING" | "PAYMENT" | "SAWT" | "ATTACHMENT" | "CLIENT_COMM";
  isConditional?: boolean;
  conditionExpression?: string;
  isWaitingState?: boolean;
  waitingOnLabel?: string;
  expectedResponseDays?: number;
  requiredDocSlots: Array<{ slotCode: string; label: string; required: boolean; acceptedTypes: string[] }>;
}> = [
  {
    // Rework brief #2 §3 / D28 — replaces the retired RECORD_CRJ (it
    // survived the CRJ's own deletion under D25 and sat in the checklist
    // naming a feature that no longer existed) and moves ahead of the
    // certificates: gross sales is the primary figure, certificates are a
    // credit applied on top, mirroring both the return itself and D26.
    // Waits on the client for the declared figure, like RECEIVE_2307
    // below, but carries no document slot: it links straight to the
    // income entry screen (/clients/[id]/income) and never blocks (D27).
    stepCode: "RECORD_SALES",
    sequence: 1,
    title: "Record quarterly sales",
    category: "PREP",
    isWaitingState: true,
    waitingOnLabel: "Client",
    expectedResponseDays: 10,
    requiredDocSlots: [],
  },
  {
    // Phase 2b P7: once a real workflow engine sets waitingSince for this
    // step automatically (Phase 3 — no such automation exists yet; today
    // waitingSince is only ever hand-set here in the seed), it must anchor
    // to the filing's certificatesExpectedBy, not the period's end date.
    // Certificates routinely aren't even due from the payor until weeks
    // after the period closes (SPEC.md 3.5, 3.6) — starting this clock at
    // period end would flag the bookkeeper as "waiting" long before a
    // certificate could reasonably have arrived.
    //
    // Brief #4b (D27/D34) — no step-level doc slot anymore: each
    // certificate row entered under this step carries its own scan
    // (Document.form2307Id), checked per-row rather than as one slot for
    // the whole step. Done once "all certificates received" is ticked
    // AND every row has its scan — the first blocking rule in Prepare.
    stepCode: "RECEIVE_2307",
    sequence: 2,
    title: "Receive Form 2307 from client",
    category: "PREP",
    isWaitingState: true,
    waitingOnLabel: "Client",
    expectedResponseDays: 5,
    requiredDocSlots: [],
  },
  {
    // Brief #4c removed the client-confirmation-evidence slot and the
    // source-of-figure field (bookkeeper's decision). Brief #4d then
    // removed the yes/no receipts acknowledgement itself — step 3 is now
    // just the computation sheet it generates itself, plus the usual
    // step controls.
    //
    // draft_computation is deliberately NOT a slot here — the app
    // writes its own computation sheet straight into the vault as a
    // side effect of completing this step (lib/documents/
    // computationSheet.ts, D27/rework brief §5.4), with no upload UI
    // and nothing for this list to gate on.
    stepCode: "PREPARE_RETURN",
    sequence: 3,
    title: "Prepare computation + 1701Q/1701A",
    category: "PREP",
    requiredDocSlots: [],
  },
  {
    // No slot at all (D27) — advising the client is an action the
    // bookkeeper performs elsewhere; asking her to prove it was rejected
    // outright ("No need for an email proof").
    //
    // Brief #5d §7 — not a waiting step: she sends the advice message
    // (its own copyable draft, lib/workflow/clientTaxAdviceMessage.ts) and
    // marks this done herself: no Start, no Mark waiting, no expected
    // response clock. It was never actually something the client responds
    // to in a way worth tracking.
    stepCode: "ADVISE_CLIENT",
    sequence: 4,
    title: "Advise client of tax payable",
    category: "CLIENT_COMM",
    requiredDocSlots: [],
  },
  {
    // D66 (brief #5k §3) -- she doesn't use eFPS; renamed from "File
    // return via eBIRForms/eFPS".
    stepCode: "FILE_RETURN",
    sequence: 5,
    title: "File return via eBIRForms",
    category: "FILING",
    requiredDocSlots: [],
  },
  {
    stepCode: "SAVE_SUBMISSION_SS",
    sequence: 6,
    title: "Save submission-page screenshot",
    category: "FILING",
    requiredDocSlots: [
      { slotCode: "submission_screenshot", label: "Submission-page screenshot", required: true, acceptedTypes: ["jpg", "png", "pdf"] },
    ],
  },
  {
    stepCode: "SAVE_FORM_COPY",
    sequence: 7,
    title: "Download and save filed form",
    category: "FILING",
    requiredDocSlots: [
      { slotCode: "filed_form", label: "Filed form PDF", required: true, acceptedTypes: ["pdf"] },
    ],
  },
  {
    stepCode: "MAKE_PAYMENT",
    sequence: 8,
    title: "Make payment",
    category: "PAYMENT",
    requiredDocSlots: [],
  },
  {
    stepCode: "SAVE_PROOF_PAYMENT",
    sequence: 9,
    title: "Save proof of payment",
    category: "PAYMENT",
    requiredDocSlots: [
      { slotCode: "proof", label: "Payment confirmation", required: true, acceptedTypes: ["pdf", "jpg", "png"] },
    ],
  },
  {
    stepCode: "RECEIVE_TRRC",
    sequence: 10,
    title: "Save TRRC email", // D90 (brief #5o) — was "Receive & save BIR confirmation (TRRC)"
    category: "FILING",
    isWaitingState: true,
    waitingOnLabel: "BIR",
    expectedResponseDays: 3,
    requiredDocSlots: [
      { slotCode: "trrc", label: "TRRC email/PDF", required: true, acceptedTypes: ["pdf", "eml"] },
    ],
  },
  {
    stepCode: "ALPHALIST_ENTRY",
    sequence: 11,
    title: "Alphalist data entry + validation",
    category: "SAWT",
    isConditional: true,
    conditionExpression: "requiresSawt == true",
    requiredDocSlots: [
      { slotCode: "generated_report", label: "Generated report", required: true, acceptedTypes: ["pdf", "xlsx"] },
      { slotCode: "dat_file", label: "DAT file", required: true, acceptedTypes: ["dat"] },
    ],
  },
  {
    // No slot (D27) — the DAT file itself is already captured at step 11;
    // this step needs nothing of its own.
    stepCode: "EMAIL_DAT",
    sequence: 12,
    title: "Email DAT file to BIR eSubmission",
    category: "SAWT",
    isConditional: true,
    conditionExpression: "requiresSawt == true",
    requiredDocSlots: [],
  },
  {
    stepCode: "SAWT_ACK",
    sequence: 13,
    title: "Receive & save acknowledgement email",
    category: "SAWT",
    isConditional: true,
    conditionExpression: "requiresSawt == true",
    isWaitingState: true,
    waitingOnLabel: "BIR",
    expectedResponseDays: 3,
    requiredDocSlots: [
      { slotCode: "acknowledgement", label: "Acknowledgement email", required: true, acceptedTypes: ["eml", "pdf"] },
    ],
  },
  {
    stepCode: "SAWT_VALIDATION",
    sequence: 14,
    title: "Save eAFS validation email", // D92 (brief #5o) — was "Receive & save validation email"
    category: "SAWT",
    isConditional: true,
    conditionExpression: "requiresSawt == true",
    isWaitingState: true,
    waitingOnLabel: "BIR",
    expectedResponseDays: 10,
    requiredDocSlots: [
      { slotCode: "validation_email", label: "Validation email", required: true, acceptedTypes: ["eml", "pdf"] },
    ],
  },
  {
    // D89 (brief #5o, her decision) — no document at all: the eAFS
    // confirmation is addressed to the client and she doesn't need it saved.
    // This retires D27's one documented exception (an optional slot).
    // D93 — conditional like 11-14: eAFS applies only when the filing has a
    // Form 2307. Mark done only (no Start, no Skip).
    stepCode: "EAFS_SUBMIT",
    sequence: 15,
    title: "Complete and submit eAFS",
    category: "ATTACHMENT",
    isConditional: true,
    conditionExpression: "requiresSawt == true",
    requiredDocSlots: [],
  },
  {
    // No slot (D27, §5) — replaced by a package download button and a
    // copyable client email draft on the step itself.
    stepCode: "SEND_CLIENT_PACKAGE",
    sequence: 16,
    title: "Email package to client",
    category: "CLIENT_COMM",
    requiredDocSlots: [],
  },
];

async function seedWorkflowStepTemplate() {
  for (const step of WORKFLOW_STEP_TEMPLATE) {
    const fields = {
      sequence: step.sequence,
      title: step.title,
      description: step.description,
      category: step.category,
      isConditional: step.isConditional ?? false,
      conditionExpression: step.conditionExpression,
      isWaitingState: step.isWaitingState ?? false,
      // Brief #5d — `?? null`, not a bare pass-through: an `undefined`
      // value in a Prisma `update` means "leave whatever's already
      // there," not "clear it" (unlike `create`, where it just omits the
      // field). Reseeding ADVISE_CLIENT's now-removed waitingOnLabel/
      // expectedResponseDays over an EXISTING database with `update:
      // fields` would otherwise silently keep the stale "Client"/5 values
      // forever — the same class of bug this file's own comment above
      // already flags for `update: {}`.
      waitingOnLabel: step.waitingOnLabel ?? null,
      expectedResponseDays: step.expectedResponseDays ?? null,
      requiredDocSlots: JSON.stringify(step.requiredDocSlots),
    };
    await prisma.workflowStepTemplate.upsert({
      where: { stepCode: step.stepCode },
      // update, not {}: this table has no settings UI of its own, so the
      // array above IS the source of truth. `update: {}` (this bug exists
      // on both branches this was reconciled from) meant reseeding over
      // an existing database silently kept whatever an earlier seed run
      // left behind — a step reorder or a required-flag change could be
      // committed and never actually take effect at runtime.
      update: fields,
      create: { stepCode: step.stepCode, ...fields },
    });
  }

  // A stepCode no longer in the array (e.g. the retired RECORD_CRJ) must
  // stop being active — generateFilingsForClientYear instantiates every
  // isActive template, and a stale row would silently grow every future
  // filing past 16 steps.
  const currentStepCodes = WORKFLOW_STEP_TEMPLATE.map((s) => s.stepCode);
  await prisma.workflowStepTemplate.updateMany({
    where: { stepCode: { notIn: currentStepCodes } },
    data: { isActive: false },
  });

  // D90/D92/D89/D93 (brief #5o) -- same class of bug as D66's: existing
  // WorkflowStep rows keep their own copy of title, doc slots and the
  // conditional flag. Backfilled so a plain reseed over an existing database
  // reaches them: the two renames, step 15 losing its slot and becoming
  // conditional, and step 15 going NA on a filing with no Form 2307 that
  // hasn't started it.
  await prisma.workflowStep.updateMany({
    where: { stepCode: "RECEIVE_TRRC", title: "Receive & save BIR confirmation (TRRC)" },
    data: { title: "Save TRRC email" },
  });
  await prisma.workflowStep.updateMany({
    where: { stepCode: "SAWT_VALIDATION", title: "Receive & save validation email" },
    data: { title: "Save eAFS validation email" },
  });
  await prisma.workflowStep.updateMany({
    where: { stepCode: "EAFS_SUBMIT" },
    data: { requiredDocSlots: "[]", isConditional: true, conditionExpression: "requiresSawt == true" },
  });
  await prisma.workflowStep.updateMany({
    where: { stepCode: "EAFS_SUBMIT", status: "PENDING", filing: { requiresSawt: false } },
    data: { status: "NA" },
  });

  // D66 (brief #5k §3) -- a WorkflowStep row keeps its own copy of title,
  // taken from the template only once, when it's first instantiated
  // (instantiateWorkflowSteps below). The template upsert above changes
  // FILE_RETURN's title for every FUTURE filing, but a filing already in
  // the database still carries the old "File return via eBIRForms/eFPS"
  // on its own row -- the same class of bug CLAUDE.md's "Database rules"
  // already flags for the WorkflowStepTemplate upsert itself. Backfilled
  // here so a plain reseed actually reaches already-created filings,
  // rather than only ever taking effect on a brand-new one.
  await prisma.workflowStep.updateMany({
    where: { stepCode: "FILE_RETURN", title: "File return via eBIRForms/eFPS" },
    data: { title: "File return via eBIRForms" },
  });
}

/**
 * Brief #5n Part 5 (D82) — the sample clients live in prisma/seedScenarios.ts,
 * driven through the app's own server actions. Server Actions call
 * revalidatePath, which throws outside a Next request, so it's stubbed here
 * (before anything imports an action — hence the dynamic import below).
 */
function stubNextCache() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function (request: string, ...rest: unknown[]) {
    if (request === "next/cache") return { revalidatePath() {}, revalidateTag() {} };
    return originalLoad.call(this, request, ...rest);
  };
}

async function main() {
  const user = await seedUser();
  await seedTaxRuleSets(user.id);
  await seedHolidays(user.id);
  await seedAtcCodes();
  await seedWorkflowStepTemplate();
  stubNextCache();
  const { seedScenarios } = await import("./seedScenarios");
  await seedScenarios(prisma, user.id);
  console.log("Seed complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
