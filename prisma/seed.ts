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
 * - A minimal ChartOfAccounts (SPEC.md 9).
 * - The 16-step WorkflowStepTemplate (SPEC.md 7.1). Filing/WorkflowStep
 *   instantiation is Phase 3 work and is intentionally NOT seeded here.
 * - Three fictitious clients spanning the full 2025 cycle (SPEC.md 14):
 *   one purely self-employed with 2307s (figures match SPEC.md Example A
 *   exactly), one purely self-employed without 2307s, and one mixed income.
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
        q1DueMonthDay: "04-15",
        q2DueMonthDay: "08-15",
        q3DueMonthDay: "11-15",
        annualDueMonthDay: "04-15", // of the following year
        sawtDeadlineOffsetDays: 0,
        eafsDeadlineOffsetDays: 15,
        surchargeRateBps: null,
        interestRateBpsPerAnnum: null,
        compromisePenaltySchedule: undefined,
        notes:
          "Q1 due date and late-filing rates are unconfirmed placeholders — verify against the current BIR issuance before live use (SPEC.md Open Question 1, section 3.7).",
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
    "Confirm this code and rate against the current BIR Alphanumeric Tax Code (ATC) list before live use (SPEC.md 3.5, 17.6).";
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

async function seedChartOfAccounts() {
  const accounts: Array<{ code: string; name: string; type: "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE" }> = [
    { code: "1000", name: "Cash", type: "ASSET" },
    { code: "1010", name: "Accounts Receivable", type: "ASSET" },
    { code: "1020", name: "Creditable Withholding Tax", type: "ASSET" },
    { code: "3000", name: "Owner's Capital", type: "EQUITY" },
    { code: "3010", name: "Owner's Drawing", type: "EQUITY" },
    { code: "4000", name: "Service Income", type: "INCOME" },
    { code: "5000", name: "Rent Expense", type: "EXPENSE" },
    { code: "5010", name: "Utilities Expense", type: "EXPENSE" },
    { code: "5020", name: "Office Supplies Expense", type: "EXPENSE" },
    { code: "5090", name: "Miscellaneous Expense", type: "EXPENSE" },
  ];
  for (const a of accounts) {
    await prisma.chartOfAccounts.upsert({ where: { code: a.code }, update: {}, create: a });
  }
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
    stepCode: "RECEIVE_2307",
    sequence: 1,
    title: "Receive Form 2307 from client",
    category: "PREP",
    isWaitingState: true,
    waitingOnLabel: "Client",
    expectedResponseDays: 5,
    requiredDocSlots: [
      { slotCode: "form2307_scan", label: "2307 scan", required: true, acceptedTypes: ["pdf", "jpg", "png"] },
    ],
  },
  {
    stepCode: "RECORD_CRJ",
    sequence: 2,
    title: "Record transactions in Cash Receipts Journal",
    category: "PREP",
    requiredDocSlots: [
      { slotCode: "source_receipts", label: "Source ORs/invoices", required: false, acceptedTypes: ["pdf", "jpg", "png"] },
    ],
  },
  {
    stepCode: "PREPARE_RETURN",
    sequence: 3,
    title: "Prepare computation + 1701Q/1701A",
    category: "PREP",
    requiredDocSlots: [
      { slotCode: "draft_computation", label: "Draft computation sheet", required: true, acceptedTypes: ["pdf", "xlsx"] },
    ],
  },
  {
    stepCode: "ADVISE_CLIENT",
    sequence: 4,
    title: "Advise client of tax payable",
    category: "CLIENT_COMM",
    isWaitingState: true,
    waitingOnLabel: "Client",
    expectedResponseDays: 5,
    requiredDocSlots: [
      { slotCode: "advisory_evidence", label: "Advisory email/screenshot", required: true, acceptedTypes: ["pdf", "jpg", "png", "eml"] },
    ],
  },
  {
    stepCode: "FILE_RETURN",
    sequence: 5,
    title: "File return via eBIRForms/eFPS",
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
    stepCode: "EMAIL_DAT",
    sequence: 12,
    title: "Email DAT file to BIR eSubmission",
    category: "SAWT",
    isConditional: true,
    conditionExpression: "requiresSawt == true",
    requiredDocSlots: [
      { slotCode: "sent_email", label: "Sent-email evidence", required: true, acceptedTypes: ["eml", "pdf", "jpg"] },
    ],
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
    stepCode: "EAFS_SUBMIT",
    sequence: 15,
    title: "Complete and submit eAFS",
    category: "ATTACHMENT",
    requiredDocSlots: [
      { slotCode: "eafs_confirmation", label: "eAFS confirmation", required: true, acceptedTypes: ["pdf", "jpg"] },
    ],
  },
  {
    stepCode: "SEND_CLIENT_PACKAGE",
    sequence: 16,
    title: "Email package to client",
    category: "CLIENT_COMM",
    requiredDocSlots: [
      { slotCode: "sent_email", label: "Sent-email evidence", required: true, acceptedTypes: ["eml", "pdf", "jpg"] },
    ],
  },
];

async function seedWorkflowStepTemplate() {
  for (const step of WORKFLOW_STEP_TEMPLATE) {
    await prisma.workflowStepTemplate.upsert({
      where: { stepCode: step.stepCode },
      update: {},
      create: {
        stepCode: step.stepCode,
        sequence: step.sequence,
        title: step.title,
        description: step.description,
        category: step.category,
        isConditional: step.isConditional ?? false,
        conditionExpression: step.conditionExpression,
        isWaitingState: step.isWaitingState ?? false,
        waitingOnLabel: step.waitingOnLabel,
        expectedResponseDays: step.expectedResponseDays,
        requiredDocSlots: JSON.stringify(step.requiredDocSlots),
      },
    });
  }
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

  const existingTx = await prisma.salesTransaction.findFirst({ where: { clientId: client.id } });
  if (existingTx) return;

  const quarters: Array<{ quarter: number; date: string; grossPesos: number }> = [
    { quarter: 1, date: "2025-03-15", grossPesos: 450_000 },
    { quarter: 2, date: "2025-06-15", grossPesos: 600_000 },
    { quarter: 3, date: "2025-09-15", grossPesos: 500_000 },
    { quarter: 4, date: "2025-12-15", grossPesos: 550_000 },
  ];

  for (const q of quarters) {
    const grossCents = CENTS(q.grossPesos);
    const whtCents = Math.round(grossCents * 0.05);
    const form2307 = await prisma.form2307.create({
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
        dateReceived: new Date(`${q.date}T00:00:00.000Z`),
        status: "RECORDED",
        actorId,
      },
    });

    await prisma.salesTransaction.create({
      data: {
        clientId: client.id,
        transactionDate: new Date(`${q.date}T00:00:00.000Z`),
        taxableYear: 2025,
        quarter: q.quarter,
        orNumber: `OR-2025-Q${q.quarter}-001`,
        payorName: "Acme Publishing Corp.",
        payorTin: "987654321",
        grossAmountCents: grossCents,
        withholdingTaxCents: whtCents,
        withholdingRateBps: 500,
        netReceivedCents: grossCents - whtCents,
        incomeType: "OPERATING",
        description: "Consulting retainer",
        form2307Id: form2307.id,
        actorId,
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

  const existingTx = await prisma.salesTransaction.findFirst({ where: { clientId: client.id } });
  if (existingTx) return;

  const rows: Array<{ quarter: number; date: string; grossPesos: number; payor: string; or: string }> = [
    { quarter: 1, date: "2025-02-10", grossPesos: 80_000, payor: "Various direct clients", or: "OR-2025-0001" },
    { quarter: 1, date: "2025-03-20", grossPesos: 60_000, payor: "Various direct clients", or: "OR-2025-0002" },
    { quarter: 2, date: "2025-05-05", grossPesos: 90_000, payor: "Various direct clients", or: "OR-2025-0003" },
    { quarter: 3, date: "2025-08-18", grossPesos: 75_000, payor: "Various direct clients", or: "OR-2025-0004" },
    { quarter: 4, date: "2025-11-22", grossPesos: 100_000, payor: "Various direct clients", or: "OR-2025-0005" },
  ];

  for (const r of rows) {
    const grossCents = CENTS(r.grossPesos);
    await prisma.salesTransaction.create({
      data: {
        clientId: client.id,
        transactionDate: new Date(`${r.date}T00:00:00.000Z`),
        taxableYear: 2025,
        quarter: r.quarter,
        orNumber: r.or,
        payorName: r.payor,
        grossAmountCents: grossCents,
        withholdingTaxCents: 0,
        withholdingRateBps: 0,
        netReceivedCents: grossCents,
        incomeType: "OPERATING",
        description: "Design project fee",
        actorId,
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

  const existingTx = await prisma.salesTransaction.findFirst({ where: { clientId: client.id } });
  if (existingTx) return;

  const rows: Array<{ quarter: number; date: string; grossPesos: number }> = [
    { quarter: 1, date: "2025-03-25", grossPesos: 200_000 },
    { quarter: 2, date: "2025-06-25", grossPesos: 250_000 },
    { quarter: 3, date: "2025-09-25", grossPesos: 250_000 },
    { quarter: 4, date: "2025-12-20", grossPesos: 300_000 },
  ];

  for (const r of rows) {
    const grossCents = CENTS(r.grossPesos);
    const whtCents = Math.round(grossCents * 0.1);
    const form2307 = await prisma.form2307.create({
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
        dateReceived: new Date(`${r.date}T00:00:00.000Z`),
        status: "RECORDED",
        actorId,
      },
    });

    await prisma.salesTransaction.create({
      data: {
        clientId: client.id,
        transactionDate: new Date(`${r.date}T00:00:00.000Z`),
        taxableYear: 2025,
        quarter: r.quarter,
        orNumber: `OR-2025-Q${r.quarter}-NG`,
        payorName: "Northgate Solutions Inc.",
        payorTin: "456789123",
        grossAmountCents: grossCents,
        withholdingTaxCents: whtCents,
        withholdingRateBps: 1000,
        netReceivedCents: grossCents - whtCents,
        incomeType: "OPERATING",
        description: "IT consulting project",
        form2307Id: form2307.id,
        actorId,
      },
    });
  }
}

async function main() {
  const user = await seedUser();
  await seedTaxRuleSets(user.id);
  await seedHolidays(user.id);
  await seedAtcCodes();
  await seedChartOfAccounts();
  await seedWorkflowStepTemplate();
  await seedClientA(user.id);
  await seedClientB(user.id);
  await seedClientC(user.id);
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
