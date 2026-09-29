/**
 * Brief #5n Part 5 (D82) — the labelled sample clients, one scenario each,
 * driven through the app's own server actions wherever feasible so the
 * database comes out exactly as the app itself would leave it: auto-waiting
 * (D68/D71), nothing-to-pay NA (D76), item 56 (D75) and the mid-year guard
 * (D78) all happen because the real code ran, not because a status was
 * typed in.
 *
 * Loaded by prisma/seed.ts via dynamic import AFTER it stubs `next/cache`
 * (revalidatePath throws outside a Next request) — never import this
 * statically.
 *
 * Set by hand, not through an action (and why):
 *   - Client, ClientTaxYear and Payor rows: the create actions redirect()
 *     into a page, which can't run outside Next.
 *   - waitingSince on steps 10/14 (and the completedAt of the step that
 *     started the wait): the app stamps "now" when a wait starts, so a
 *     seeded wait would always read 0 days. Back-dated here so the aging
 *     tags and colours have something to show. Ages are relative to seed
 *     time (D17's era note) and drift as real time passes.
 *   - No computationSnapshot is written: the production markStepDone has
 *     never frozen one (D76's implementation note), so a filed sample
 *     return is unfrozen exactly like one filed in the app today.
 *
 * Every client is fictitious. Do not reuse a name typed in during a
 * walkthrough — those may be real people and this file is committed.
 */

import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import { generateFilingsAction, savePayment, setAllCertificatesReceived } from "../lib/actions/filings";
import { saveQuarterlySales } from "../lib/actions/quarterlySales";
import { addCertificate } from "../lib/actions/form2307";
import { saveStartingFigures } from "../lib/actions/startingFigures";
import { uploadDocument } from "../lib/actions/documents";
import { markStepDone, skipStep } from "../lib/actions/workflowSteps";
import { assembleAndComputeFiling } from "../lib/filingComputation";
import { centsToPesos } from "../lib/money";
import type { Period } from "../lib/tax/types";

const MANILA_ZONE = "Asia/Manila";

export const SAMPLE_CLIENT_CODES = [
  "villamor-e", // A
  "pangilinan-a", // B
  "lacson-b", // C
  "mendoza-c", // D
  "garcia-r", // E
  "ocampo-f", // F
  "tolentino-g", // G
  "navarro-e", // H
] as const;

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function dateStr(daysAgo: number): string {
  return DateTime.now().setZone(MANILA_ZONE).minus({ days: daysAgo }).toFormat("yyyy-MM-dd");
}

/** A tiny valid one-page PDF reading "SAMPLE" plus a caption — no dependency, offsets computed, not typed. */
function samplePdf(caption: string): Buffer {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/—/g, "\\227");
  const stream = [
    `BT /F1 28 Tf 72 700 Td (SAMPLE) Tj ET`,
    `BT /F1 12 Tf 72 665 Td (${esc(caption)}) Tj ET`,
    `BT /F1 10 Tf 72 640 Td (Placeholder created by the seed - not a real document.) Tj ET`,
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> >> >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

function sampleFile(caption: string, filename: string, kind: "pdf" | "text" = "pdf"): File {
  return kind === "pdf"
    ? new File([new Uint8Array(samplePdf(caption))], filename, { type: "application/pdf" })
    : new File([`SAMPLE — ${caption}\nPlaceholder created by the seed - not a real document.\n`], filename, { type: "text/plain" });
}

function form(fields: Record<string, string | string[] | File | boolean>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((v) => fd.append(key, v));
    else if (typeof value === "boolean") {
      if (value) fd.append(key, "on");
    } else fd.append(key, value);
  }
  return fd;
}

export async function seedScenarios(prisma: PrismaClient, actorId: string): Promise<void> {
  const existing = await prisma.client.count({ where: { code: { in: [...SAMPLE_CLIENT_CODES] } } });
  if (existing === SAMPLE_CLIENT_CODES.length) {
    console.log("Sample scenario clients already present — leaving them as they are.");
    return;
  }
  if (existing > 0) {
    throw new Error(
      `Found ${existing} of ${SAMPLE_CLIENT_CODES.length} sample clients — a previous seed stopped part-way. ` +
        `Run "npx prisma migrate reset --force" to start clean.`,
    );
  }

  // -- action wrappers ------------------------------------------------------
  const stepOf = async (filingId: string, stepCode: string) =>
    prisma.workflowStep.findFirstOrThrow({ where: { filingId, stepCode } });

  async function done(filingId: string, stepCode: string) {
    const result = await markStepDone((await stepOf(filingId, stepCode)).id);
    if (!result.ok) throw new Error(`Seed: could not mark ${stepCode} done — ${result.error}`);
  }

  async function upload(filingId: string, stepCode: string, slotCode: string, file: File, documentDate: string) {
    const step = await stepOf(filingId, stepCode);
    const result = await uploadDocument(form({ file, workflowStepId: step.id, docSlotCode: slotCode, documentDate }));
    if (!result.ok) throw new Error(`Seed: could not upload ${slotCode} for ${stepCode} — ${result.error}`);
  }

  async function backdateWait(filingId: string, stepCode: string, days: number, alsoCompletedAtOf?: string) {
    const at = DateTime.now().minus({ days }).toJSDate();
    await prisma.workflowStep.updateMany({ where: { filingId, stepCode }, data: { waitingSince: at } });
    if (alsoCompletedAtOf) {
      await prisma.workflowStep.updateMany({ where: { filingId, stepCode: alsoCompletedAtOf }, data: { completedAt: at } });
    }
  }

  async function makeClient(data: {
    code: string;
    registeredName: string;
    tin: string;
    rdoCode: string;
    registeredAddress: string;
    taxpayerType: "PURELY_SELF_EMPLOYED" | "MIXED_INCOME";
    lineOfBusiness: string;
    withholdingBps: number | null;
    engagedSince: string;
    notes: string;
  }) {
    const n = SAMPLE_CLIENT_CODES.indexOf(data.code as (typeof SAMPLE_CLIENT_CODES)[number]) + 1;
    const client = await prisma.client.create({
      data: {
        code: data.code,
        registeredName: data.registeredName,
        tin: data.tin,
        branchCode: "000",
        rdoCode: data.rdoCode,
        registeredAddress: data.registeredAddress,
        email: `${data.code}@example.com`,
        mobile: `0917-000-010${n}`,
        taxpayerType: data.taxpayerType,
        lineOfBusiness: data.lineOfBusiness,
        civilStatus: "SINGLE",
        booksType: "MANUAL",
        swornDeclarationOnFile: true,
        swornDeclarationYear: 2026,
        defaultWithholdingRateBps: data.withholdingBps,
        recognitionBasis: "COLLECTION",
        engagedSince: new Date(`${data.engagedSince}T00:00:00.000Z`),
        notes: data.notes,
        actorId,
      },
    });
    await prisma.clientTaxYear.create({
      data: { clientId: client.id, taxableYear: 2026, regime: "RATE_8_PERCENT", electionStatus: "ELECTED", priorYearExcessCreditCents: 0, actorId },
    });
    return client;
  }

  async function startingFigures(
    clientId: string,
    latestOutsideReturn: "NONE" | "Q1" | "Q2" | "Q3",
    figures: Partial<Record<"cumulativeIncome" | "withholdingPreviousQuarters" | "withholdingThisQuarter" | "paymentsPreviousQuarters" | "amountPaidThisReturn", string>> = {},
  ) {
    const state = await saveStartingFigures(
      clientId,
      2026,
      {},
      form({
        latestOutsideReturn,
        priorYearExcessCredit: "0",
        cumulativeIncome: figures.cumulativeIncome ?? "0",
        withholdingPreviousQuarters: figures.withholdingPreviousQuarters ?? "0",
        withholdingThisQuarter: figures.withholdingThisQuarter ?? "0",
        paymentsPreviousQuarters: figures.paymentsPreviousQuarters ?? "0",
        amountPaidThisReturn: figures.amountPaidThisReturn ?? "0",
        otherCredits: "0",
        otherCreditsDescription: "",
        nonOperatingIncome: "0",
      }),
    );
    if (!state.saved) throw new Error(`Seed: starting figures for ${clientId} not saved — ${state.error ?? JSON.stringify(state.fieldErrors)}`);
  }

  async function generate(clientId: string) {
    const result = await generateFilingsAction(clientId, 2026);
    if (!result.ok) throw new Error(`Seed: generate failed — ${result.error}`);
  }

  async function filingOf(clientId: string, period: Period) {
    return prisma.filing.findUniqueOrThrow({
      where: { clientId_taxableYear_period: { clientId, taxableYear: 2026, period } },
    });
  }

  async function declareSales(clientId: string, quarter: "Q1" | "Q2" | "Q3", rows: Array<[string, string]>) {
    const state = await saveQuarterlySales(
      clientId,
      2026,
      quarter,
      {},
      form({ intent: "final", customerName: rows.map((r) => r[0]), amount: rows.map((r) => r[1]), nonOperatingIncome: "0", notes: "" }),
    );
    if (state.error || state.fieldErrors) throw new Error(`Seed: sales for ${quarter} not saved — ${state.error ?? JSON.stringify(state.fieldErrors)}`);
  }

  async function addCert(
    filingId: string,
    cert: { payor: string; tin: string; address: string; atc: string; income: string; withheld: string; from: string; to: string },
    caption: string,
    docDate: string,
  ) {
    const state = await addCertificate(
      filingId,
      {},
      form({
        payorName: cert.payor,
        payorTin: cert.tin,
        payorAddress: cert.address,
        periodFrom: cert.from,
        periodTo: cert.to,
        atcCode: cert.atc,
        incomePayment: cert.income,
        taxWithheld: cert.withheld,
        withholdingRatePercent: "",
        notes: "",
        documentDate: docDate,
        file: sampleFile(caption, "SAMPLE_2307.pdf"),
      }),
    );
    if (!state.saved) throw new Error(`Seed: certificate not saved — ${state.error ?? JSON.stringify(state.fieldErrors)}`);
  }

  async function payTaxPayable(filing: { id: string; clientId: string; period: Period }, date: string, channel: string) {
    const sheet = await assembleAndComputeFiling(filing.clientId, 2026, filing.period);
    const state = await savePayment(
      filing.id,
      {},
      form({ amountPaid: centsToPesos(sheet.taxPayableCents), paymentDate: date, paymentChannel: channel }),
    );
    if (!state.saved) throw new Error(`Seed: payment not saved — ${state.error ?? JSON.stringify(state.fieldErrors)}`);
  }

  const label = (clientName: string, period: string) => `${clientName}, ${period} 2026`;

  /**
   * A client with no withholding agents: step 2 is skipped by hand, the way she would. It has to
   * come AFTER the sales are saved — a figures-changing save un-skips step 2 on purpose (D61).
   */
  async function skipReceive2307(filingId: string) {
    const step = await stepOf(filingId, "RECEIVE_2307");
    const result = await skipStep(step.id, "No withholding agents — no Form 2307 expected for this client.");
    if (!result.ok) throw new Error(`Seed: could not skip step 2 — ${result.error}`);
  }

  /** Steps 3-5: sales (final), prepare, advise, file. Step 2 is left to the caller when the client has certificates. */
  async function prepareAdviseFile(filingId: string) {
    await done(filingId, "PREPARE_RETURN");
    await done(filingId, "ADVISE_CLIENT");
    await done(filingId, "FILE_RETURN");
  }

  async function saveFileEvidence(filingId: string, name: string, period: string, filedOn: string) {
    await upload(filingId, "SAVE_SUBMISSION_SS", "submission_screenshot", sampleFile(`Submission screenshot, ${label(name, period)}`, "SAMPLE_submission.pdf"), filedOn);
    await upload(filingId, "SAVE_FORM_COPY", "filed_form", sampleFile(`Filed form, ${label(name, period)}`, "SAMPLE_filed_form.pdf"), filedOn);
  }

  // =========================================================================
  // A — full-year client, Q1 and Q2 complete in the app, Q3 not started
  // =========================================================================
  const villamor = await makeClient({
    code: "villamor-e",
    registeredName: "Ernesto Villamor",
    tin: "201345678",
    rdoCode: "039",
    registeredAddress: "18 Maginhawa St, Quezon City, Metro Manila",
    taxpayerType: "PURELY_SELF_EMPLOYED",
    lineOfBusiness: "Video editing services",
    withholdingBps: null, // no withholding agents — no 2307 expected, steps 11-14 NA
    engagedSince: "2025-01-10",
    notes:
      "Sample A: full-year client. Q1 and Q2 are filed, paid and complete in the app; Q3 is not started — walk Prepare on Q3 (item 56 shows the real Q1+Q2 payments).",
  });
  await generate(villamor.id);

  const quarterDates = {
    Q1: { filed: "2026-05-12", paid: "2026-05-13", trrc: "2026-05-15" },
    Q2: { filed: "2026-08-11", paid: "2026-08-12", trrc: "2026-08-14" },
  } as const;
  const villamorSales: Record<"Q1" | "Q2", Array<[string, string]>> = {
    Q1: [
      ["Kalye Films Inc.", "250,000.00"],
      ["Direct client — Bituin Weddings", "150,000.00"],
    ],
    Q2: [
      ["Kalye Films Inc.", "200,000.00"],
      ["Direct client — Bituin Weddings", "100,000.00"],
    ],
  };
  for (const q of ["Q1", "Q2"] as const) {
    const d = quarterDates[q];
    await declareSales(villamor.id, q, villamorSales[q]);
    const filing = await filingOf(villamor.id, q);
    await skipReceive2307(filing.id);
    await prepareAdviseFile(filing.id);
    await saveFileEvidence(filing.id, villamor.registeredName, q, d.filed);
    await payTaxPayable(filing, d.paid, "GCash");
    await upload(filing.id, "SAVE_PROOF_PAYMENT", "proof", sampleFile(`Proof of payment, ${label(villamor.registeredName, q)}`, "SAMPLE_proof.pdf"), d.paid);
    await upload(filing.id, "RECEIVE_TRRC", "trrc", sampleFile(`TRRC, ${label(villamor.registeredName, q)}`, "SAMPLE_TRRC.pdf"), d.trrc);
    // no certificates -> the whole eAFS group is NA (D93), so there is no step 15 to do
    await done(filing.id, "SEND_CLIENT_PACKAGE");
  }

  // =========================================================================
  // B — mid-year joiner (July 1), starting figures saved (outside Q2); only Q3 + Annual exist
  // =========================================================================
  const pangilinan = await makeClient({
    code: "pangilinan-a",
    registeredName: "Analiza Pangilinan",
    tin: "202456789",
    rdoCode: "044",
    registeredAddress: "7 Bonifacio St, Pasig City, Metro Manila",
    taxpayerType: "PURELY_SELF_EMPLOYED",
    lineOfBusiness: "Online tutoring",
    withholdingBps: 500,
    engagedSince: "2026-07-01",
    notes: "Sample B: joined July 1, starting figures saved (latest outside return Q2). Only Q3 and Annual exist; Q3 is in Prepare, untouched.",
  });
  await startingFigures(pangilinan.id, "Q2", { cumulativeIncome: "350,000.00" });
  await generate(pangilinan.id);

  // =========================================================================
  // C — mid-year joiner (July 1), NO starting figures, no filings
  // =========================================================================
  await makeClient({
    code: "lacson-b",
    registeredName: "Benedicto Lacson",
    tin: "203567891",
    rdoCode: "050",
    registeredAddress: "22 Rizal Ave, Makati City, Metro Manila",
    taxpayerType: "PURELY_SELF_EMPLOYED",
    lineOfBusiness: "Photography",
    withholdingBps: null,
    engagedSince: "2026-07-01",
    notes:
      "Sample C: joined July 1, NO starting figures and no filings generated. Click Generate for 2026 on the client page to see the mid-year guard (D78); save starting figures and it runs.",
  });

  // =========================================================================
  // D — Q3 payable, filed and paid, proof saved, has certificates, eAFS untouched, TRRC waiting ~2 days
  // =========================================================================
  const mendoza = await makeClient({
    code: "mendoza-c",
    registeredName: "Corazon Mendoza",
    tin: "204678912",
    rdoCode: "039",
    registeredAddress: "5 Sampaguita St, Mandaluyong City, Metro Manila",
    taxpayerType: "PURELY_SELF_EMPLOYED",
    lineOfBusiness: "Freelance copywriting",
    withholdingBps: 500,
    engagedSince: "2026-01-20",
    notes:
      "Sample D: Q3 filed and paid, proof saved, has certificates, eAFS group untouched — the main eAFS walk (steps 11, 12, 13 and 15). TRRC waiting about 2 days.",
  });
  // Joined the app after Q2: Q1/Q2 came from her Excel, so they get no filing at all (D56).
  await startingFigures(mendoza.id, "Q2", {
    cumulativeIncome: "300,000.00",
    withholdingPreviousQuarters: "6,000.00",
    withholdingThisQuarter: "9,000.00",
  });
  await generate(mendoza.id);
  {
    const filing = await filingOf(mendoza.id, "Q3");
    await declareSales(mendoza.id, "Q3", [
      ["Bayanihan Media Group, Inc.", "300,000.00"],
      ["Direct client — Salonga Boutique", "100,000.00"],
    ]);
    await addCert(
      filing.id,
      {
        payor: "Bayanihan Media Group, Inc.",
        tin: "310-555-201-000",
        address: "9 Ayala Ave, Makati City",
        atc: "WI010",
        income: "300,000.00",
        withheld: "15,000.00",
        from: "2026-07-01",
        to: "2026-09-30",
      },
      `Form 2307, ${label(mendoza.registeredName, "Q3")}`,
      dateStr(6),
    );
    await setAllCertificatesReceived(filing.id, true);
    await prepareAdviseFile(filing.id);
    await saveFileEvidence(filing.id, mendoza.registeredName, "Q3", dateStr(2));
    await payTaxPayable(filing, dateStr(2), "Landbank LinkBiz");
    await upload(filing.id, "SAVE_PROOF_PAYMENT", "proof", sampleFile(`Proof of payment, ${label(mendoza.registeredName, "Q3")}`, "SAMPLE_proof.pdf"), dateStr(1));
    await backdateWait(filing.id, "RECEIVE_TRRC", 2, "FILE_RETURN");
  }

  // =========================================================================
  // E — Rosario Garcia: Q3 overpayment, filed, no certificates
  // =========================================================================
  const garcia = await makeClient({
    code: "garcia-r",
    registeredName: "Rosario Garcia",
    tin: "567891234",
    rdoCode: "044",
    registeredAddress: "34 Aguinaldo St, Marikina City, Metro Manila",
    taxpayerType: "PURELY_SELF_EMPLOYED",
    lineOfBusiness: "Graphic design services",
    withholdingBps: null, // no certificates: step 2 is skipped from the start, steps 11-14 NA
    engagedSince: "2026-01-15",
    notes:
      "Sample E: Q3 overpayment, filed, no certificates. Pay reads 'Nothing to pay — overpayment'; the eAFS group reads 'Not applicable — no Form 2307' (D93). Q1/Q2 were filed outside the app (starting figures).",
  });
  // Her latest return filed outside the app is Q2 (illustrative figures): item 51 ₱500,000,
  // items 57/58 ₱10,000 + ₱15,000, item 56 ₱2,000, ₱8,000 paid on Q2 itself.
  await startingFigures(garcia.id, "Q2", {
    cumulativeIncome: "500,000.00",
    withholdingPreviousQuarters: "10,000.00",
    withholdingThisQuarter: "15,000.00",
    paymentsPreviousQuarters: "2,000.00",
    amountPaidThisReturn: "8,000.00",
  });
  await generate(garcia.id);
  {
    const filing = await filingOf(garcia.id, "Q3");
    await declareSales(garcia.id, "Q3", [
      ["Luzviminda Studio", "50,000.00"],
      ["Kapitbahay Cafe", "35,000.00"],
    ]);
    await skipReceive2307(filing.id);
    await prepareAdviseFile(filing.id); // step 5 -> nothing to pay -> steps 8/9 go NA by themselves (D76)
    await saveFileEvidence(filing.id, garcia.registeredName, "Q3", dateStr(3));
    await backdateWait(filing.id, "RECEIVE_TRRC", 3, "FILE_RETURN");
  }

  // =========================================================================
  // F — Q3 filed (step 5 done), steps 6/7 not saved yet
  // =========================================================================
  const ocampo = await makeClient({
    code: "ocampo-f",
    registeredName: "Felipe Ocampo",
    tin: "205789123",
    rdoCode: "039",
    registeredAddress: "61 Luna St, San Juan City, Metro Manila",
    taxpayerType: "PURELY_SELF_EMPLOYED",
    lineOfBusiness: "Carpentry and fit-out",
    withholdingBps: 500,
    engagedSince: "2026-01-12",
    notes: "Sample F: Q3 filed (step 5 done) but the submission screenshot and filed form are not saved yet — File group mid-way, BIR Confirmations already waiting on the TRRC. Has a certificate, so the eAFS group is locked until Pay is done.",
  });
  await startingFigures(ocampo.id, "Q2", { cumulativeIncome: "300,000.00" });
  await generate(ocampo.id);
  {
    const filing = await filingOf(ocampo.id, "Q3");
    await declareSales(ocampo.id, "Q3", [
      ["Direct client — Dizon Residence", "120,000.00"],
      ["Direct client — Aquino Renovation", "80,000.00"],
    ]);
    await addCert(
      filing.id,
      {
        payor: "Ilustre Builders, Inc.",
        tin: "330-555-603-000",
        address: "8 Ortigas Ave, Pasig City",
        atc: "WI010",
        income: "120,000.00",
        withheld: "6,000.00",
        from: "2026-07-01",
        to: "2026-09-30",
      },
      `Form 2307, ${label(ocampo.registeredName, "Q3")}`,
      dateStr(4),
    );
    await setAllCertificatesReceived(filing.id, true);
    await prepareAdviseFile(filing.id);
    await backdateWait(filing.id, "RECEIVE_TRRC", 1, "FILE_RETURN");
  }

  // =========================================================================
  // G — Q3 everything of hers done incl. eAFS; TRRC waiting ~8 days (red)
  // =========================================================================
  const tolentino = await makeClient({
    code: "tolentino-g",
    registeredName: "Gloria Tolentino",
    tin: "206891234",
    rdoCode: "044",
    registeredAddress: "3 Mabini St, Taguig City, Metro Manila",
    taxpayerType: "PURELY_SELF_EMPLOYED",
    lineOfBusiness: "Interior styling",
    withholdingBps: 500,
    engagedSince: "2026-01-18",
    notes:
      "Sample G: Q3 — everything of hers is done including eAFS; TRRC waiting about 8 days (red) and SAWT validation waiting. The card sits in BIR Confirmations.",
  });
  await startingFigures(tolentino.id, "Q2", {
    cumulativeIncome: "300,000.00",
    withholdingPreviousQuarters: "6,000.00",
    withholdingThisQuarter: "9,000.00",
  });
  await generate(tolentino.id);
  {
    const filing = await filingOf(tolentino.id, "Q3");
    const name = tolentino.registeredName;
    await declareSales(tolentino.id, "Q3", [
      ["Sampaguita Trading Corp.", "250,000.00"],
      ["Direct client — Ilagan Cafe", "50,000.00"],
    ]);
    await addCert(
      filing.id,
      {
        payor: "Sampaguita Trading Corp.",
        tin: "320-555-402-000",
        address: "14 Shaw Blvd, Pasig City",
        atc: "WI010",
        income: "250,000.00",
        withheld: "12,500.00",
        from: "2026-07-01",
        to: "2026-09-30",
      },
      `Form 2307, ${label(name, "Q3")}`,
      dateStr(14),
    );
    await setAllCertificatesReceived(filing.id, true);
    await prepareAdviseFile(filing.id);
    await saveFileEvidence(filing.id, name, "Q3", dateStr(9));
    await payTaxPayable(filing, dateStr(9), "BDO Online");
    await upload(filing.id, "SAVE_PROOF_PAYMENT", "proof", sampleFile(`Proof of payment, ${label(name, "Q3")}`, "SAMPLE_proof.pdf"), dateStr(9));
    // eAFS group: steps 11, 12, 13, 15 — all of hers.
    await upload(filing.id, "ALPHALIST_ENTRY", "generated_report", sampleFile(`Alphalist report, ${label(name, "Q3")}`, "SAMPLE_alphalist.pdf"), dateStr(8));
    await upload(filing.id, "ALPHALIST_ENTRY", "dat_file", sampleFile(`DAT file, ${label(name, "Q3")}`, "SAMPLE_alphalist.dat", "text"), dateStr(8));
    // step 11 completed itself once BOTH files were in (D86); step 12 is Mark done (saves the email draft, D87)
    // and starts step 13's wait (D88); uploading the acknowledgement completes 13 and starts step 14's wait (D71).
    await done(filing.id, "EMAIL_DAT");
    await upload(filing.id, "SAWT_ACK", "acknowledgement", sampleFile(`Acknowledgement email, ${label(name, "Q3")}`, "SAMPLE_ack.pdf"), dateStr(6));
    await done(filing.id, "EAFS_SUBMIT"); // step 15: Mark done only, no file (D89)
    await backdateWait(filing.id, "RECEIVE_TRRC", 8, "FILE_RETURN");
    await backdateWait(filing.id, "SAWT_VALIDATION", 3, "SAWT_ACK");
  }

  // =========================================================================
  // H — the mixed-income sample (D49): Annual only, not started
  // =========================================================================
  const navarro = await makeClient({
    code: "navarro-e",
    registeredName: "Estrella Navarro",
    tin: "207912345",
    rdoCode: "039",
    registeredAddress: "40 Katipunan Ave, Quezon City, Metro Manila",
    taxpayerType: "MIXED_INCOME",
    lineOfBusiness: "Employee with a side consulting business",
    withholdingBps: 1000,
    engagedSince: "2026-01-05",
    notes:
      "Sample H: the mixed-income sample, kept for the day a mixed-income client arrives (Form 1701 has no computation sheet — D49). Annual only, not started.",
  });
  await startingFigures(navarro.id, "Q3", {
    cumulativeIncome: "450,000.00",
    withholdingPreviousQuarters: "30,000.00",
    withholdingThisQuarter: "15,000.00",
    paymentsPreviousQuarters: "4,000.00",
    amountPaidThisReturn: "3,000.00",
  });
  await generate(navarro.id);

  // -- a small "Customers / payors" list so the picker isn't empty ----------
  const payors: Array<{ clientId: string; name: string; tin?: string; address?: string; usualAtcCode?: string }> = [
    { clientId: villamor.id, name: "Kalye Films Inc." },
    { clientId: villamor.id, name: "Direct client — Bituin Weddings" },
    { clientId: mendoza.id, name: "Bayanihan Media Group, Inc.", tin: "310-555-201-000", address: "9 Ayala Ave, Makati City", usualAtcCode: "WI010" },
    { clientId: tolentino.id, name: "Sampaguita Trading Corp.", tin: "320-555-402-000", address: "14 Shaw Blvd, Pasig City", usualAtcCode: "WI010" },
  ];
  for (const p of payors) {
    await prisma.payor.create({
      data: { clientId: p.clientId, name: p.name, tin: p.tin ?? null, address: p.address ?? null, usualAtcCode: p.usualAtcCode ?? null, actorId },
    });
  }

  const q3 = await assembleAndComputeFiling(garcia.id, 2026, "Q3");
  console.log(`Sample check — Rosario Garcia TY2026 Q3 overpayment: ${centsToPesos(q3.overpaymentCents, { withSymbol: true })}`);
}
