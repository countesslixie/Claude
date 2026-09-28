/**
 * Seed data for local development and demos.
 *
 * - One seeded User (single-operator MVP; every mutation's actorId defaults
 *   to this row — SPEC.md section 2).
 * - TaxRuleSet rows for TY2025 (the seeded demo cycle) and TY2026 (current
 *   year), with only the figures given explicitly in SPEC.md section 3.
 *   Surcharge/interest rates are left null rather than guessed — confirm
 *   against the current BIR issuance before use (SPEC.md 3.7, 17).
 * - Holiday rows for 2025-2027 (the demo year plus current + next year,
 *   per SPEC.md 3.6). This is a starter list, not exhaustive — maintain it
 *   from Settings.
 * - A sparse, unverified AtcCode table (SPEC.md 3.5) — do not add codes
 *   here without confirming them against the current BIR ATC list.
 * - Brief #5a — a few "Customers / payors" entries per sample client
 *   (Payor table), matching the names already used above, so the picker
 *   isn't empty on a fresh database.
 * - The 16-step WorkflowStepTemplate (rework brief §5.1: advisory_evidence
 *   on ADVISE_CLIENT is optional, not required).
 * - Three fictitious clients spanning the full 2025 cycle (SPEC.md 14):
 *   one purely self-employed with 2307s (figures match SPEC.md Example A
 *   exactly), one purely self-employed without 2307s, and one mixed
 *   income. Declared sales are seeded as QuarterlySales rows (D26) — a
 *   Form 2307 is a credit record only and never contributes to them.
 * - A TY2026 Filing/WorkflowStep cycle for all three clients, positioned
 *   relative to today so the dashboard has something to show on first
 *   run: Q1 filed and COMPLETE, Q2 past its adjusted due date and not
 *   complete (two clients stuck waiting on BIR at different steps, one
 *   stalled with no external wait), Q3 NOT_STARTED with an upcoming due
 *   date. All tax figures are fixed and deterministic; only the waiting
 *   clocks (waitingSince, followUpCount) are computed relative to now,
 *   so the demo stays useful as real time passes. Document rows are NOT
 *   seeded here — the document vault is Phase 3 scope; WorkflowStep
 *   status is set directly rather than earned through upload, which a
 *   real workflow-engine action would enforce.
 */

import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import { deriveFilingStatus } from "../lib/workflow/status";
import { generateFilingsForClientYear } from "../lib/workflow/filingGeneration";

const prisma = new PrismaClient();
const MANILA_ZONE = "Asia/Manila";

const CENTS = (pesos: number) => Math.round(pesos * 100);
const QUARTER_LABELS = ["Q1", "Q2", "Q3", "Q4"] as const;

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
    title: "Receive & save BIR confirmation (TRRC)",
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
    title: "Receive & save validation email",
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
    // The one documented exception (D27): the eAFS confirmation is
    // addressed to the client, not the bookkeeper, and often never
    // reaches her — she can't obtain it on demand. Optional and hidden
    // behind a disclosure, never demanded, never blocking; she can still
    // save it when she has it.
    stepCode: "EAFS_SUBMIT",
    sequence: 15,
    title: "Complete and submit eAFS",
    category: "ATTACHMENT",
    requiredDocSlots: [
      { slotCode: "eafs_confirmation", label: "eAFS confirmation", required: false, acceptedTypes: ["pdf", "jpg"] },
    ],
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

async function seedClientA(actorId: string) {
  // Purely self-employed, WITH 2307s. Figures match SPEC.md section 6
  // Example A exactly (5% CWT on all receipts).
  const client = await prisma.client.upsert({
    where: { code: "dela-cruz-j" },
    update: {},
    create: {
      code: "dela-cruz-j",
      registeredName: "Juan Dela Cruz",
      tin: "123456789",
      branchCode: "000",
      rdoCode: "039",
      registeredAddress: "12 Kalayaan Ave, Quezon City, Metro Manila",
      email: "juan.delacruz@example.com",
      mobile: "0917-000-0001",
      taxpayerType: "PURELY_SELF_EMPLOYED",
      lineOfBusiness: "Management consulting services",
      civilStatus: "SINGLE",
      booksType: "MANUAL",
      swornDeclarationOnFile: true,
      swornDeclarationYear: 2025,
      defaultWithholdingRateBps: 500,
      recognitionBasis: "COLLECTION",
      engagedSince: new Date("2024-06-01T00:00:00.000Z"),
      actorId,
    },
  });

  await prisma.clientTaxYear.upsert({
    where: { clientId_taxableYear: { clientId: client.id, taxableYear: 2025 } },
    update: {},
    create: {
      clientId: client.id,
      taxableYear: 2025,
      regime: "RATE_8_PERCENT",
      electionStatus: "ELECTED",
      actorId,
    },
  });

  const existingSales = await prisma.quarterlySales.findFirst({ where: { clientId: client.id, taxableYear: 2025 } });
  if (existingSales) return;

  // whtCents is 5% of grossPesos*100, literal, hand-verified against §6
  // Example A — do not compute. (Left as a literal-math cross-check of the
  // tax engine's own applyBps(); routing it through applyBps() here would
  // make that cross-check tautological.)
  const quarters: Array<{ quarter: number; date: string; grossPesos: number; whtCents: number }> = [
    { quarter: 1, date: "2025-03-15", grossPesos: 450_000, whtCents: 2_250_000 },
    { quarter: 2, date: "2025-06-15", grossPesos: 600_000, whtCents: 3_000_000 },
    { quarter: 3, date: "2025-09-15", grossPesos: 500_000, whtCents: 2_500_000 },
    { quarter: 4, date: "2025-12-15", grossPesos: 550_000, whtCents: 2_750_000 },
  ];

  for (const q of quarters) {
    const grossCents = CENTS(q.grossPesos);
    const whtCents = q.whtCents;
    // Form2307 — a credit record only (D26); it never contributes to
    // declared gross sales, seeded separately as QuarterlySales below.
    await prisma.form2307.create({
      data: {
        clientId: client.id,
        taxableYear: 2025,
        payorName: "Acme Publishing Corp.",
        payorTin: "987654321",
        periodFrom: new Date(`2025-${String((q.quarter - 1) * 3 + 1).padStart(2, "0")}-01T00:00:00.000Z`),
        periodTo: new Date(`${q.date}T00:00:00.000Z`),
        quarterCovered: q.quarter,
        atcCode: "WI010",
        incomePaymentCents: grossCents,
        taxWithheldCents: whtCents,
        withholdingRateBps: 500,
        status: "RECORDED",
        actorId,
      },
    });

    await prisma.quarterlySales.create({
      data: {
        clientId: client.id,
        taxableYear: 2025,
        quarter: QUARTER_LABELS[q.quarter - 1],
        grossSalesCents: grossCents,
        finalizedAt: new Date(`${q.date}T00:00:00.000Z`),
        actorId,
        customers: { create: [{ customerName: "Acme Publishing Corp.", amountCents: grossCents }] },
      },
    });
  }
}

async function seedClientB(actorId: string) {
  // Purely self-employed, WITHOUT 2307s — direct clients, no withholding.
  const client = await prisma.client.upsert({
    where: { code: "santos-m" },
    update: {},
    create: {
      code: "santos-m",
      registeredName: "Maria Santos",
      tin: "234567891",
      branchCode: "000",
      rdoCode: "044",
      registeredAddress: "45 Mabini St, Makati City, Metro Manila",
      email: "maria.santos@example.com",
      mobile: "0917-000-0002",
      taxpayerType: "PURELY_SELF_EMPLOYED",
      lineOfBusiness: "Freelance graphic design",
      civilStatus: "MARRIED",
      booksType: "MANUAL",
      swornDeclarationOnFile: false,
      recognitionBasis: "COLLECTION",
      engagedSince: new Date("2023-01-15T00:00:00.000Z"),
      actorId,
    },
  });

  await prisma.clientTaxYear.upsert({
    where: { clientId_taxableYear: { clientId: client.id, taxableYear: 2025 } },
    update: {},
    create: {
      clientId: client.id,
      taxableYear: 2025,
      regime: "RATE_8_PERCENT",
      electionStatus: "ELECTED",
      actorId,
    },
  });

  const existingSales = await prisma.quarterlySales.findFirst({ where: { clientId: client.id, taxableYear: 2025 } });
  if (existingSales) return;

  // No withholding agents — a client with an empty 2307 register (§5.5).
  // Brief #4b (D33) — declared per customer per quarter; Q1 demonstrates
  // two customer rows summing to one quarter total.
  const quarterlyCustomers: Record<(typeof QUARTER_LABELS)[number], Array<{ name: string; pesos: number }>> = {
    Q1: [
      { name: "Direct client — Reyes Bakery", pesos: 80_000 },
      { name: "Direct client — Villanueva Print Shop", pesos: 60_000 },
    ],
    Q2: [{ name: "Various direct clients", pesos: 90_000 }],
    Q3: [{ name: "Various direct clients", pesos: 75_000 }],
    Q4: [{ name: "Various direct clients", pesos: 100_000 }],
  };

  for (const quarter of QUARTER_LABELS) {
    const rows = quarterlyCustomers[quarter];
    const grossCents = rows.reduce((sum, r) => sum + CENTS(r.pesos), 0);
    await prisma.quarterlySales.create({
      data: {
        clientId: client.id,
        taxableYear: 2025,
        quarter,
        grossSalesCents: grossCents,
        finalizedAt: new Date(),
        actorId,
        customers: { create: rows.map((r) => ({ customerName: r.name, amountCents: CENTS(r.pesos) })) },
      },
    });
  }
}

async function seedClientC(actorId: string) {
  // Mixed income earner — no ₱250,000 deduction on the business portion,
  // files 1701 (not 1701A) at year-end (SPEC.md 3.2, Example B).
  const client = await prisma.client.upsert({
    where: { code: "reyes-p" },
    update: {},
    create: {
      code: "reyes-p",
      registeredName: "Pedro Reyes",
      tin: "345678912",
      branchCode: "000",
      rdoCode: "050",
      registeredAddress: "78 Rizal Blvd, Pasig City, Metro Manila",
      email: "pedro.reyes@example.com",
      mobile: "0917-000-0003",
      taxpayerType: "MIXED_INCOME",
      lineOfBusiness: "IT consulting (side business); also employed full-time",
      civilStatus: "MARRIED",
      booksType: "MANUAL",
      swornDeclarationOnFile: true,
      swornDeclarationYear: 2025,
      defaultWithholdingRateBps: 1000,
      recognitionBasis: "COLLECTION",
      engagedSince: new Date("2025-01-10T00:00:00.000Z"),
      actorId,
    },
  });

  await prisma.clientTaxYear.upsert({
    where: { clientId_taxableYear: { clientId: client.id, taxableYear: 2025 } },
    update: {},
    create: {
      clientId: client.id,
      taxableYear: 2025,
      regime: "RATE_8_PERCENT",
      electionStatus: "ELECTED",
      actorId,
    },
  });

  const existingSales = await prisma.quarterlySales.findFirst({ where: { clientId: client.id, taxableYear: 2025 } });
  if (existingSales) return;

  // whtCents is 10% of grossPesos*100, literal, hand-verified against §6
  // Example A — do not compute. (See the Client A quarters comment above
  // for why this stays a literal cross-check instead of applyBps().)
  const rows: Array<{ quarter: number; date: string; grossPesos: number; whtCents: number }> = [
    { quarter: 1, date: "2025-03-25", grossPesos: 200_000, whtCents: 2_000_000 },
    { quarter: 2, date: "2025-06-25", grossPesos: 250_000, whtCents: 2_500_000 },
    { quarter: 3, date: "2025-09-25", grossPesos: 250_000, whtCents: 2_500_000 },
    { quarter: 4, date: "2025-12-20", grossPesos: 300_000, whtCents: 3_000_000 },
  ];

  for (const r of rows) {
    const grossCents = CENTS(r.grossPesos);
    const whtCents = r.whtCents;
    // Form2307 — a credit record only (D26); it never contributes to
    // declared gross sales, seeded separately as QuarterlySales below.
    await prisma.form2307.create({
      data: {
        clientId: client.id,
        taxableYear: 2025,
        payorName: "Northgate Solutions Inc.",
        payorTin: "456789123",
        periodFrom: new Date(`2025-${String((r.quarter - 1) * 3 + 1).padStart(2, "0")}-01T00:00:00.000Z`),
        periodTo: new Date(`${r.date}T00:00:00.000Z`),
        quarterCovered: r.quarter,
        atcCode: "WI011",
        incomePaymentCents: grossCents,
        taxWithheldCents: whtCents,
        withholdingRateBps: 1000,
        status: "RECORDED",
        actorId,
      },
    });

    await prisma.quarterlySales.create({
      data: {
        clientId: client.id,
        taxableYear: 2025,
        quarter: QUARTER_LABELS[r.quarter - 1],
        grossSalesCents: grossCents,
        finalizedAt: new Date(`${r.date}T00:00:00.000Z`),
        actorId,
        customers: { create: [{ customerName: "Northgate Solutions Inc.", amountCents: grossCents }] },
      },
    });
  }
}

/**
 * Brief #5f §8 — a fourth sample client joining the app mid-year, for
 * TY2026 only (no TY2025 history — she's new to the practice this year).
 * Her latest return filed outside the app is Q2, so Q3 is the first
 * return done in the app; Q1 and Q2 get no Filing row at all
 * (generateFilingsForClientYear skips them once StartingFigures exists —
 * this is the "outside the app" representation this brief chose). Round,
 * illustrative figures, matching what her latest outside 1701Q would have
 * shown:
 *   - Item 55 (prior year's excess credit): ₱0
 *   - Item 51 (cumulative income through Q2): ₱500,000
 *   - Item 57 (CWT for previous quarters, i.e. Q1's): ₱10,000
 *   - Item 58 (CWT for that quarter, i.e. Q2's own): ₱15,000
 *   - Item 56 (payments for previous quarters, i.e. what was paid on Q1): ₱2,000
 *   - Amount paid for Q2 itself: ₱8,000
 *   - Item 61 (other tax credits/payments): ₱0
 *   - Non-operating income so far this year: ₱0
 * Q3 itself is left entirely fresh (no sales, no certificates) so the Q3
 * filing is walkable end to end from a live walkthrough, same as the
 * three existing clients' own fresh Q3 filings above.
 */
async function seedClientD(actorId: string) {
  const client = await prisma.client.upsert({
    where: { code: "garcia-r" },
    update: {},
    create: {
      code: "garcia-r",
      registeredName: "Rosario Garcia",
      tin: "567891234",
      branchCode: "000",
      rdoCode: "044",
      registeredAddress: "34 Aguinaldo St, Marikina City, Metro Manila",
      email: "rosario.garcia@example.com",
      mobile: "0917-000-0004",
      taxpayerType: "PURELY_SELF_EMPLOYED",
      lineOfBusiness: "Graphic design services",
      civilStatus: "SINGLE",
      booksType: "MANUAL",
      swornDeclarationOnFile: true,
      swornDeclarationYear: 2026,
      defaultWithholdingRateBps: 500,
      recognitionBasis: "COLLECTION",
      engagedSince: new Date("2026-01-15T00:00:00.000Z"),
      actorId,
    },
  });

  const taxYear = await prisma.clientTaxYear.upsert({
    where: { clientId_taxableYear: { clientId: client.id, taxableYear: 2026 } },
    update: {},
    create: {
      clientId: client.id,
      taxableYear: 2026,
      regime: "RATE_8_PERCENT",
      electionStatus: "ELECTED",
      priorYearExcessCreditCents: 0,
      actorId,
    },
  });

  await prisma.startingFigures.upsert({
    where: { clientId_taxableYear: { clientId: client.id, taxableYear: 2026 } },
    update: {},
    create: {
      clientId: client.id,
      taxableYear: 2026,
      clientTaxYearId: taxYear.id,
      latestOutsideReturn: "Q2",
      priorYearExcessCreditCents: 0,
      cumulativeIncomeCents: CENTS(500_000),
      withholdingPreviousQuartersCents: CENTS(10_000),
      withholdingThisQuarterCents: CENTS(15_000),
      paymentsPreviousQuartersCents: CENTS(2_000),
      amountPaidThisReturnCents: CENTS(8_000),
      otherCreditsCents: 0,
      otherCreditsDescription: null,
      nonOperatingIncomeCents: 0,
      actorId,
    },
  });

  // Reuses the exact production filing-generation code path — it skips
  // Q1/Q2 automatically now that StartingFigures names them outside the
  // app, and generates fresh Q3/ANNUAL filings the same way any other
  // client's filings are generated.
  await generateFilingsForClientYear(client.id, 2026);
}

/**
 * Brief #5a — a few starter "Customers / payors" entries per sample
 * client, so the picker isn't empty on a fresh database. Matches the
 * names already seeded as Form2307 payors / QuarterlySalesCustomer rows
 * above, but this list is purely a shared reference of names/details —
 * it isn't read by, and doesn't feed, either of those.
 */
async function seedPayors(actorId: string) {
  const clientA = await prisma.client.findUniqueOrThrow({ where: { code: "dela-cruz-j" } });
  const clientB = await prisma.client.findUniqueOrThrow({ where: { code: "santos-m" } });
  const clientC = await prisma.client.findUniqueOrThrow({ where: { code: "reyes-p" } });

  const rows: Array<{ clientId: string; name: string; tin?: string; address?: string; usualAtcCode?: string }> = [
    { clientId: clientA.id, name: "Acme Publishing Corp.", tin: "987654321", usualAtcCode: "WI010" },
    { clientId: clientB.id, name: "Direct client — Reyes Bakery" },
    { clientId: clientB.id, name: "Direct client — Villanueva Print Shop" },
    { clientId: clientC.id, name: "Northgate Solutions Inc.", tin: "456789123", usualAtcCode: "WI011" },
  ];

  for (const r of rows) {
    await prisma.payor.upsert({
      where: { clientId_name: { clientId: r.clientId, name: r.name } },
      update: {},
      create: {
        clientId: r.clientId,
        name: r.name,
        tin: r.tin ?? null,
        address: r.address ?? null,
        usualAtcCode: r.usualAtcCode ?? null,
        actorId,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// TY2026 Filing/WorkflowStep cycle — dashboard-ready demo state
// ---------------------------------------------------------------------------

/**
 * Hand-builds a frozen computationSnapshot JSON matching the shape
 * lib/tax/compute.ts's FilingComputationResult produces. incomeTaxDueCents
 * is supplied by the caller as a literal, hand-verified against §6 Example
 * A — do not compute it here. This snapshot stays an independent,
 * literal-math cross-check of the real engine; routing it through the
 * engine's own rate arithmetic would make that cross-check tautological.
 */
function buildSnapshot(params: {
  formType: string;
  cumulativeGrossSalesCents: number;
  cumulativeNonOperatingCents: number;
  allowableDeductionCents: number;
  incomeTaxRateBps: number;
  incomeTaxDueCents: number;
  cumulativeCwtCents: number;
  priorPeriodPaymentsCents: number;
  priorYearExcessCreditCents: number;
}) {
  const cumulativeGrossCents = params.cumulativeGrossSalesCents + params.cumulativeNonOperatingCents;
  const taxableBaseCents = Math.max(0, cumulativeGrossCents - params.allowableDeductionCents);
  const incomeTaxDueCents = params.incomeTaxDueCents;
  const rawPayable =
    incomeTaxDueCents -
    params.cumulativeCwtCents -
    params.priorPeriodPaymentsCents -
    params.priorYearExcessCreditCents;
  const taxPayableCents = Math.max(0, rawPayable);
  const overpaymentCents = rawPayable < 0 ? -rawPayable : 0;

  return {
    formType: params.formType,
    cumulativeGrossSalesCents: params.cumulativeGrossSalesCents,
    cumulativeNonOperatingCents: params.cumulativeNonOperatingCents,
    cumulativeGrossCents,
    allowableDeductionCents: params.allowableDeductionCents,
    taxableBaseCents,
    incomeTaxDueCents,
    cumulativeCwtCents: params.cumulativeCwtCents,
    priorPeriodPaymentsCents: params.priorPeriodPaymentsCents,
    priorYearExcessCreditCents: params.priorYearExcessCreditCents,
    taxPayableCents,
    isOverpayment: overpaymentCents > 0,
    overpaymentCents,
    breakdown: [
      { label: "Cumulative gross sales/receipts", amountCents: params.cumulativeGrossSalesCents, sourceNote: "YTD operating income" },
      { label: "Cumulative non-operating income", amountCents: params.cumulativeNonOperatingCents, sourceNote: "YTD non-operating income" },
      { label: "Cumulative gross", amountCents: cumulativeGrossCents, sourceNote: "Sum of the above" },
      {
        label: "Less: allowable deduction",
        amountCents: -params.allowableDeductionCents,
        sourceNote:
          params.allowableDeductionCents > 0
            ? "PHP 250,000, purely self-employed, applied in full from Q1"
            : "None — mixed income earner (SPEC.md 3.2)",
      },
      { label: "Taxable base", amountCents: taxableBaseCents, sourceNote: "MAX(0, cumulative gross - deduction)" },
      {
        label: "Income tax due",
        amountCents: incomeTaxDueCents,
        sourceNote: `${(params.incomeTaxRateBps / 100).toFixed(2)}% of taxable base`,
      },
      {
        label: "Less: cumulative creditable withholding tax",
        amountCents: -params.cumulativeCwtCents,
        sourceNote: "Sum of Form 2307 certificates, status Recorded/Claimed, year-to-date",
      },
      {
        label: "Less: prior-period payments",
        amountCents: -params.priorPeriodPaymentsCents,
        sourceNote: "Amounts actually remitted on earlier returns this taxable year",
      },
      {
        label: "Less: prior-year excess credit",
        amountCents: -params.priorYearExcessCreditCents,
        sourceNote: "Carried over from the prior taxable year's election, if any",
      },
      {
        label: overpaymentCents > 0 ? "Overpayment" : "Tax payable",
        amountCents: overpaymentCents > 0 ? overpaymentCents : taxPayableCents,
        sourceNote: "This is a preparation aid. The filed return and BIR's own assessment govern (SPEC.md 17.6).",
      },
    ],
  };
}

async function instantiateWorkflowSteps(
  filingId: string,
  opts: {
    requiresSawt: boolean;
    doneThroughSequence: number;
    waitingAtStepCode?: string;
    waitingSince?: Date;
    followUpCount?: number;
  },
): Promise<{ status: "PENDING" | "DONE" | "WAITING_EXTERNAL" | "SKIPPED" | "NA"; waitingOnLabel: string | null }[]> {
  const created: { status: "PENDING" | "DONE" | "WAITING_EXTERNAL" | "SKIPPED" | "NA"; waitingOnLabel: string | null }[] =
    [];
  for (const step of WORKFLOW_STEP_TEMPLATE) {
    const isSawtStep = step.isConditional === true;
    let status: "PENDING" | "DONE" | "WAITING_EXTERNAL" | "SKIPPED" | "NA" = "PENDING";
    let skippedReason: string | null = null;
    let waitingSince: Date | null = null;
    let followUpCount = 0;

    if (isSawtStep && !opts.requiresSawt) {
      status = "NA";
    } else if (
      step.stepCode === "RECEIVE_2307" &&
      !opts.requiresSawt &&
      step.sequence <= opts.doneThroughSequence
    ) {
      status = "SKIPPED";
      skippedReason = "No withholding agents / no Form 2307 expected for this client this period.";
    } else if (opts.waitingAtStepCode === step.stepCode) {
      status = "WAITING_EXTERNAL";
      waitingSince = opts.waitingSince ?? null;
      followUpCount = opts.followUpCount ?? 0;
    } else if (step.sequence <= opts.doneThroughSequence) {
      status = "DONE";
    } else if (step.stepCode === "RECORD_SALES" || step.stepCode === "RECEIVE_2307") {
      // Brief #4b — both self-complete and read "Waiting on client" until then.
      status = "WAITING_EXTERNAL";
    }

    await prisma.workflowStep.create({
      data: {
        filingId,
        stepCode: step.stepCode,
        sequence: step.sequence,
        title: step.title,
        description: step.description,
        category: step.category,
        status,
        isConditional: step.isConditional ?? false,
        conditionExpression: step.conditionExpression,
        isWaitingState: step.isWaitingState ?? false,
        waitingOnLabel: step.waitingOnLabel,
        expectedResponseDays: step.expectedResponseDays,
        waitingSince,
        followUpCount,
        requiredDocSlots: JSON.stringify(step.requiredDocSlots),
        skippedReason,
      },
    });
    created.push({ status, waitingOnLabel: step.waitingOnLabel ?? null });
  }
  return created;
}

async function seedTY2026Cycle(actorId: string) {
  const nowManila = DateTime.now().setZone(MANILA_ZONE);

  // Statutory due dates from the seeded TY2026 TaxRuleSet (05-15/08-15/11-15,
  // per SPEC.md 3.6 — Q1 resolved to May 15, formerly Open Question 1),
  // business-day-shifted by hand against the seeded Holiday table — never
  // computed algorithmically (SPEC.md 3.6). Verified for TY2026:
  //   May 15, 2026 = Friday   -> no shift
  //   Aug 15, 2026 = Saturday -> shifts to Mon Aug 17, 2026
  //   Nov 15, 2026 = Sunday   -> shifts to Mon Nov 16, 2026
  const DUE = {
    Q1: { statutory: "2026-05-15", adjusted: "2026-05-15" },
    Q2: { statutory: "2026-08-15", adjusted: "2026-08-17" },
    Q3: { statutory: "2026-11-15", adjusted: "2026-11-16" },
  };

  // Working calendar (SPEC.md 3.6, Phase 2b P7) — the bookkeeper's own
  // practice targets, distinct from and editable independent of the
  // statutory/adjusted due dates above. Actual practice for quarterly
  // returns: internalFilingTarget is the ADJUSTED (business-day-shifted)
  // due date itself — no internal buffer by design, the bookkeeper works
  // to the normal deadline for quarterlies — and certificatesExpectedBy is
  // 10 days before the STATUTORY due date (unshifted), giving a window to
  // chase late certificates before the filing target. Q1's adjusted date
  // equals its statutory date (May 15, 2026 is a Friday, no shift), so
  // its internalFilingTarget is unaffected either way. (The ANNUAL return
  // keeps a real buffer instead — certificatesExpectedBy Feb 15,
  // internalFilingTarget Mar 31, of the following year, ahead of the Apr
  // 15 statutory/adjusted deadline — but no ANNUAL filing is seeded in
  // this demo cycle, so it isn't instantiated here.)
  const WORKING_CALENDAR = {
    Q1: { certificatesExpectedBy: "2026-05-05", internalFilingTarget: DUE.Q1.adjusted },
    Q2: { certificatesExpectedBy: "2026-08-05", internalFilingTarget: DUE.Q2.adjusted },
    Q3: { certificatesExpectedBy: "2026-11-05", internalFilingTarget: DUE.Q3.adjusted },
  };

  type ClientCycleConfig = {
    clientCode: string;
    taxpayerType: "PURELY_SELF_EMPLOYED" | "MIXED_INCOME";
    requiresSawt: boolean;
    payorName: string;
    payorTin: string;
    atcCode: string;
    whtRateBps: number;
    q1GrossPesos: number;
    q2GrossPesos: number;
    // literal, hand-verified against §6 Example A — do not compute.
    q1WhtCents: number;
    q2WhtCents: number;
    q1IncomeTaxDueCents: number;
    q2IncomeTaxDueCents: number;
    q2: {
      // How far Q2's workflow progressed before getting stuck / staying idle.
      doneThroughSequence: number;
      waitingAtStepCode?: string;
      waitingDaysAgo?: number;
      followUpCount?: number;
      filed: boolean; // whether FILE_RETURN (and payment, if any) already happened
    };
  };

  const clients: ClientCycleConfig[] = [
    {
      // Matches SPEC.md Example A exactly (5% CWT), so Q2's ₱11,500 payable
      // can be eyeballed directly against the spec table.
      clientCode: "dela-cruz-j",
      taxpayerType: "PURELY_SELF_EMPLOYED",
      requiresSawt: true,
      payorName: "Acme Publishing Corp.",
      payorTin: "987654321",
      atcCode: "WI010",
      whtRateBps: 500,
      q1GrossPesos: 450_000,
      q2GrossPesos: 600_000,
      q1WhtCents: 2_250_000, // 5% of 450,000
      q2WhtCents: 3_000_000, // 5% of 600,000
      q1IncomeTaxDueCents: 1_600_000, // 8% of (450,000 - 250,000 deduction)
      q2IncomeTaxDueCents: 6_400_000, // 8% of (1,050,000 cumulative - 250,000 deduction) — matches §6 Example A
      q2: {
        doneThroughSequence: 9, // filed, paid; waiting on BIR's TRRC (step 10)
        waitingAtStepCode: "RECEIVE_TRRC",
        waitingDaysAgo: 12,
        followUpCount: 1,
        filed: true,
      },
    },
    {
      clientCode: "santos-m",
      taxpayerType: "PURELY_SELF_EMPLOYED",
      requiresSawt: false,
      payorName: "",
      payorTin: "",
      atcCode: "",
      whtRateBps: 0,
      q1GrossPesos: 150_000,
      q2GrossPesos: 180_000,
      q1WhtCents: 0, // no withholding — no 2307
      q2WhtCents: 0,
      q1IncomeTaxDueCents: 0, // taxable base is MAX(0, 150,000 - 250,000 deduction) = 0
      q2IncomeTaxDueCents: 640_000, // 8% of (330,000 cumulative - 250,000 deduction)
      q2: {
        doneThroughSequence: 3, // computation prepared, but never filed — stalled, no one to follow up with
        filed: false,
      },
    },
    {
      clientCode: "reyes-p",
      taxpayerType: "MIXED_INCOME",
      requiresSawt: true,
      payorName: "Northgate Solutions Inc.",
      payorTin: "456789123",
      atcCode: "WI011",
      whtRateBps: 1000,
      q1GrossPesos: 220_000,
      q2GrossPesos: 260_000,
      q1WhtCents: 2_200_000, // 10% of 220,000
      q2WhtCents: 2_600_000, // 10% of 260,000
      q1IncomeTaxDueCents: 1_760_000, // 8% of 220,000 — mixed income earner, no deduction (SPEC.md 3.2)
      q2IncomeTaxDueCents: 3_840_000, // 8% of (480,000 cumulative) — mixed income earner, no deduction
      q2: {
        doneThroughSequence: 13, // filed; TRRC and SAWT ack received; waiting on SAWT validation (step 14)
        waitingAtStepCode: "SAWT_VALIDATION",
        waitingDaysAgo: 21,
        followUpCount: 2,
        filed: true,
      },
    },
  ];

  for (const cfg of clients) {
    const client = await prisma.client.findUniqueOrThrow({ where: { code: cfg.clientCode } });

    await prisma.clientTaxYear.upsert({
      where: { clientId_taxableYear: { clientId: client.id, taxableYear: 2026 } },
      update: {},
      create: {
        clientId: client.id,
        taxableYear: 2026,
        regime: "RATE_8_PERCENT",
        electionStatus: "ELECTED",
        actorId,
      },
    });

    const allowableDeductionCents = cfg.taxpayerType === "PURELY_SELF_EMPLOYED" ? CENTS(250_000) : 0;

    // --- Q1: closed quarter, filed and COMPLETE ---
    const existingQ1 = await prisma.filing.findUnique({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q1" } },
    });
    if (!existingQ1) {
      const q1GrossCents = CENTS(cfg.q1GrossPesos);
      const q1WhtCents = cfg.q1WhtCents;

      const q1Snapshot = buildSnapshot({
        formType: "F1701Q",
        cumulativeGrossSalesCents: q1GrossCents,
        cumulativeNonOperatingCents: 0,
        allowableDeductionCents,
        incomeTaxRateBps: 800,
        incomeTaxDueCents: cfg.q1IncomeTaxDueCents,
        cumulativeCwtCents: q1WhtCents,
        priorPeriodPaymentsCents: 0,
        priorYearExcessCreditCents: 0,
      });

      // Brief #4b (D34) — Filing created before its Form2307s so each
      // certificate's claimedOnFilingId can point at it: that's what
      // decides the certificate's credit period now, not dateReceived
      // against a cutoff. Sequence 1 (RECORD_SALES) and 2 (RECEIVE_2307)
      // are both DONE for this closed, fully-filed quarter, so
      // certificatesAllReceivedAt is set to match.
      const q1Filing = await prisma.filing.create({
        data: {
          clientId: client.id,
          taxableYear: 2026,
          period: "Q1",
          formType: "F1701Q",
          statutoryDueDate: new Date(`${DUE.Q1.statutory}T00:00:00.000Z`),
          adjustedDueDate: new Date(`${DUE.Q1.adjusted}T00:00:00.000Z`),
          certificatesExpectedBy: new Date(`${WORKING_CALENDAR.Q1.certificatesExpectedBy}T00:00:00.000Z`),
          internalFilingTarget: new Date(`${WORKING_CALENDAR.Q1.internalFilingTarget}T00:00:00.000Z`),
          certificatesAllReceivedAt: new Date(`${DUE.Q1.adjusted}T00:00:00.000Z`),
          // status is derived below from the steps this filing actually
          // ends up with, once instantiateWorkflowSteps has created them —
          // never hand-typed (SPEC.md 7.2: a hardcoded literal here is
          // exactly how the seed and deriveFilingStatus went out of sync).
          requiresSawt: cfg.requiresSawt,
          computationSnapshot: JSON.stringify(q1Snapshot),
          filedAt: new Date(`${DUE.Q1.adjusted}T00:00:00.000Z`),
          filingReferenceNumber: `EBIR-2026Q1-${cfg.clientCode.toUpperCase()}`,
          amountPaidCents: q1Snapshot.taxPayableCents,
          paymentDate: q1Snapshot.taxPayableCents > 0 ? new Date(`${DUE.Q1.adjusted}T00:00:00.000Z`) : null,
          paymentChannel: q1Snapshot.taxPayableCents > 0 ? "GCash" : null,
          actorId,
        },
      });

      // Form2307 — a credit record only (D26); declared sales are seeded
      // separately as QuarterlySales below, independent of it.
      if (cfg.requiresSawt) {
        await prisma.form2307.create({
          data: {
            clientId: client.id,
            taxableYear: 2026,
            payorName: cfg.payorName,
            payorTin: cfg.payorTin,
            periodFrom: new Date("2026-01-01T00:00:00.000Z"),
            periodTo: new Date("2026-03-15T00:00:00.000Z"),
            quarterCovered: 1,
            atcCode: cfg.atcCode,
            incomePaymentCents: q1GrossCents,
            taxWithheldCents: q1WhtCents,
            withholdingRateBps: cfg.whtRateBps,
            status: "CLAIMED_ON_RETURN",
            claimedOnFilingId: q1Filing.id,
            actorId,
          },
        });
      }

      await prisma.quarterlySales.create({
        data: {
          clientId: client.id,
          taxableYear: 2026,
          quarter: "Q1",
          grossSalesCents: q1GrossCents,
          finalizedAt: new Date(`${DUE.Q1.adjusted}T00:00:00.000Z`),
          actorId,
          customers: {
            create: [
              {
                customerName: cfg.requiresSawt ? cfg.payorName : "Various direct clients",
                amountCents: q1GrossCents,
              },
            ],
          },
        },
      });

      const q1Steps = await instantiateWorkflowSteps(q1Filing.id, {
        requiresSawt: cfg.requiresSawt,
        doneThroughSequence: 16,
      });
      await prisma.filing.update({
        where: { id: q1Filing.id },
        data: {
          status: deriveFilingStatus({
            steps: q1Steps,
            adjustedDueDate: q1Filing.adjustedDueDate,
            now: nowManila.toJSDate(),
          }),
        },
      });
    }

    // --- Q2: closed quarter, past its adjusted due date, NOT complete ---
    const existingQ2 = await prisma.filing.findUnique({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q2" } },
    });
    if (!existingQ2) {
      const q1GrossCents = CENTS(cfg.q1GrossPesos);
      const q2GrossCents = CENTS(cfg.q2GrossPesos);
      const q2WhtCents = cfg.q2WhtCents;
      const q1WhtCents = cfg.q1WhtCents;
      const cumGrossQ2 = q1GrossCents + q2GrossCents;
      const cumCwtQ2 = q1WhtCents + q2WhtCents;

      // Q1's actual payment (0 if it was an overpayment) becomes Q2's priorPeriodPayments.
      const q1Snapshot = buildSnapshot({
        formType: "F1701Q",
        cumulativeGrossSalesCents: q1GrossCents,
        cumulativeNonOperatingCents: 0,
        allowableDeductionCents,
        incomeTaxRateBps: 800,
        incomeTaxDueCents: cfg.q1IncomeTaxDueCents,
        cumulativeCwtCents: q1WhtCents,
        priorPeriodPaymentsCents: 0,
        priorYearExcessCreditCents: 0,
      });

      const q2Snapshot = buildSnapshot({
        formType: "F1701Q",
        cumulativeGrossSalesCents: cumGrossQ2,
        cumulativeNonOperatingCents: 0,
        allowableDeductionCents,
        incomeTaxRateBps: 800,
        incomeTaxDueCents: cfg.q2IncomeTaxDueCents,
        cumulativeCwtCents: cumCwtQ2,
        priorPeriodPaymentsCents: q1Snapshot.taxPayableCents,
        priorYearExcessCreditCents: 0,
      });

      const waitingSinceDate = cfg.q2.waitingDaysAgo
        ? nowManila.minus({ days: cfg.q2.waitingDaysAgo }).toJSDate()
        : undefined;

      const q2Filing = await prisma.filing.create({
        data: {
          clientId: client.id,
          taxableYear: 2026,
          period: "Q2",
          formType: "F1701Q",
          statutoryDueDate: new Date(`${DUE.Q2.statutory}T00:00:00.000Z`),
          adjustedDueDate: new Date(`${DUE.Q2.adjusted}T00:00:00.000Z`),
          certificatesExpectedBy: new Date(`${WORKING_CALENDAR.Q2.certificatesExpectedBy}T00:00:00.000Z`),
          internalFilingTarget: new Date(`${WORKING_CALENDAR.Q2.internalFilingTarget}T00:00:00.000Z`),
          // status is derived below, not hand-typed — see the Q1 comment above.
          requiresSawt: cfg.requiresSawt,
          computationSnapshot: cfg.q2.filed ? JSON.stringify(q2Snapshot) : undefined,
          filedAt: cfg.q2.filed ? new Date(`${DUE.Q2.adjusted}T00:00:00.000Z`) : null,
          filingReferenceNumber: cfg.q2.filed ? `EBIR-2026Q2-${cfg.clientCode.toUpperCase()}` : null,
          amountPaidCents: cfg.q2.filed ? q2Snapshot.taxPayableCents : null,
          paymentDate:
            cfg.q2.filed && q2Snapshot.taxPayableCents > 0
              ? new Date(`${DUE.Q2.adjusted}T00:00:00.000Z`)
              : null,
          paymentChannel: cfg.q2.filed && q2Snapshot.taxPayableCents > 0 ? "GCash" : null,
          // Brief #4b — steps 1 and 2 (sequence 1, 2) are DONE for every
          // client's Q2 here (doneThroughSequence is always >= 3), so
          // certificatesAllReceivedAt is set to match, independent of
          // whether the return itself (cfg.q2.filed) has been filed yet.
          certificatesAllReceivedAt: new Date(`${WORKING_CALENDAR.Q2.certificatesExpectedBy}T00:00:00.000Z`),
          actorId,
        },
      });

      // Form2307 — a credit record only (D26); declared sales are seeded
      // separately as QuarterlySales below, independent of it. Entered
      // under Q2's step 2 (D34): claimedOnFilingId points at q2Filing.
      if (cfg.requiresSawt) {
        await prisma.form2307.create({
          data: {
            clientId: client.id,
            taxableYear: 2026,
            payorName: cfg.payorName,
            payorTin: cfg.payorTin,
            periodFrom: new Date("2026-04-01T00:00:00.000Z"),
            periodTo: new Date("2026-06-15T00:00:00.000Z"),
            quarterCovered: 2,
            atcCode: cfg.atcCode,
            incomePaymentCents: q2GrossCents,
            taxWithheldCents: q2WhtCents,
            withholdingRateBps: cfg.whtRateBps,
            status: cfg.q2.filed ? "CLAIMED_ON_RETURN" : "RECORDED",
            claimedOnFilingId: q2Filing.id,
            actorId,
          },
        });
      }

      await prisma.quarterlySales.create({
        data: {
          clientId: client.id,
          taxableYear: 2026,
          quarter: "Q2",
          grossSalesCents: q2GrossCents,
          finalizedAt: new Date(`${WORKING_CALENDAR.Q2.certificatesExpectedBy}T00:00:00.000Z`),
          actorId,
          customers: {
            create: [
              {
                customerName: cfg.requiresSawt ? cfg.payorName : "Various direct clients",
                amountCents: q2GrossCents,
              },
            ],
          },
        },
      });

      const q2Steps = await instantiateWorkflowSteps(q2Filing.id, {
        requiresSawt: cfg.requiresSawt,
        doneThroughSequence: cfg.q2.doneThroughSequence,
        waitingAtStepCode: cfg.q2.waitingAtStepCode,
        waitingSince: waitingSinceDate,
        followUpCount: cfg.q2.followUpCount,
      });
      await prisma.filing.update({
        where: { id: q2Filing.id },
        data: {
          status: deriveFilingStatus({
            steps: q2Steps,
            adjustedDueDate: q2Filing.adjustedDueDate,
            now: nowManila.toJSDate(),
          }),
        },
      });
    }

    // --- Q3: period not yet closed as of today — no transactions yet, filing shell NOT_STARTED ---
    const existingQ3 = await prisma.filing.findUnique({
      where: { clientId_taxableYear_period: { clientId: client.id, taxableYear: 2026, period: "Q3" } },
    });
    if (!existingQ3) {
      const q3Filing = await prisma.filing.create({
        data: {
          clientId: client.id,
          taxableYear: 2026,
          period: "Q3",
          formType: "F1701Q",
          statutoryDueDate: new Date(`${DUE.Q3.statutory}T00:00:00.000Z`),
          adjustedDueDate: new Date(`${DUE.Q3.adjusted}T00:00:00.000Z`),
          certificatesExpectedBy: new Date(`${WORKING_CALENDAR.Q3.certificatesExpectedBy}T00:00:00.000Z`),
          internalFilingTarget: new Date(`${WORKING_CALENDAR.Q3.internalFilingTarget}T00:00:00.000Z`),
          // status is derived below, not hand-typed — see the Q1 comment above.
          requiresSawt: cfg.requiresSawt,
          actorId,
        },
      });

      const q3Steps = await instantiateWorkflowSteps(q3Filing.id, {
        requiresSawt: cfg.requiresSawt,
        doneThroughSequence: 0,
      });
      await prisma.filing.update({
        where: { id: q3Filing.id },
        data: {
          status: deriveFilingStatus({
            steps: q3Steps,
            adjustedDueDate: q3Filing.adjustedDueDate,
            now: nowManila.toJSDate(),
          }),
        },
      });
    }
  }
}

async function main() {
  const user = await seedUser();
  await seedTaxRuleSets(user.id);
  await seedHolidays(user.id);
  await seedAtcCodes();
  await seedWorkflowStepTemplate();
  await seedClientA(user.id);
  await seedClientB(user.id);
  await seedClientC(user.id);
  await seedPayors(user.id);
  await seedTY2026Cycle(user.id);
  await seedClientD(user.id);
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
