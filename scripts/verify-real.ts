/**
 * Throwaway verification script — cross-checks a real return you filed
 * against what lib/tax/compute.ts computes, using figures you supply in
 * scripts/real-fixture.local.ts (gitignored, never committed).
 *
 * Read-only: this NEVER touches the database. It doesn't import
 * lib/prisma, doesn't create a Client/Filing/anything — it only calls
 * the pure computeFiling() engine with plain objects assembled from your
 * fixture, the same way lib/filingComputation.ts assembles them from the
 * database (SPEC.md 4, 6: lib/tax/ is plain-object in, plain-object out).
 *
 * Usage:
 *   npx tsx scripts/verify-real.ts
 *   (or: npm run verify:real)
 */

import { computeFiling } from "../lib/tax/compute";
import { sumCwtThroughPeriod, type CertificateForCwt } from "../lib/tax/cwt";
import { periodStartDate, periodEndDate } from "../lib/tax/periods";
import { manilaDateInputToJsDate, formatManilaDate } from "../lib/dates";
import { pesosToCents, centsToPesos } from "../lib/money";
import type { Period, TaxpayerType, BreakdownLine } from "../lib/tax/types";

// SPEC.md 3.2 — the 8% option's fixed rule figures. Not read from a
// TaxRuleSet row (this script never touches the database); update these
// by hand if the rule ever changes.
const INCOME_TAX_RATE_BPS = 800; // 8.00%
const ALLOWABLE_DEDUCTION_PESOS = 250_000;

export interface RealFixture {
  taxpayerType: TaxpayerType;
  taxableYear: number;
  period: Period;
  receipts: Array<{ date: string; grossPesos: number }>;
  certificates: Array<{ dateReceived: string; incomePaymentPesos: number; taxWithheldPesos: number }>;
  nonOperatingPesos: number;
  priorYearExcessCreditPesos: number;
  priorPeriodPaymentsPesos: number;
  certificateCutoffDate: string;
}

/**
 * BIR Form 1701Q Part IV ("Computation of Tax," 8% IT rate option) line
 * order, mapped to this engine's breakdown[] labels. The engine tracks
 * creditable withholding as a single YTD-cumulative figure rather than
 * splitting "previous quarter" vs. "this quarter" the way the printed
 * form does (SPEC.md 3.2) — that combined figure is placed where the
 * form's CWT lines are. Exact line numbers vary by form revision, so
 * this maps by description, not by printed item number — read the
 * labels, not a specific line number, when cross-checking.
 */
const FORM_1701Q_PART_IV_ORDER: Array<{ breakdownLabel: string; formLine: string }> = [
  { breakdownLabel: "Cumulative gross sales/receipts", formLine: "Sales/Revenues/Receipts/Fees" },
  { breakdownLabel: "Cumulative non-operating income", formLine: "Add: Non-Operating and Other Income" },
  { breakdownLabel: "Cumulative gross", formLine: "Total Sales/Receipts and Other Income" },
  {
    breakdownLabel: "Less: allowable deduction",
    formLine: "Less: Amount Allowed as Deduction (8% IT rate option)",
  },
  { breakdownLabel: "Taxable base", formLine: "Taxable Income" },
  { breakdownLabel: "Income tax due", formLine: "Tax Due (8% of Taxable Income)" },
  {
    breakdownLabel: "Less: prior-year excess credit",
    formLine: "Less Tax Credits/Payments — Prior Year's Excess Credits",
  },
  {
    breakdownLabel: "Less: prior-period payments",
    formLine: "Less Tax Credits/Payments — Tax Payment for Previous Quarter(s)",
  },
  {
    breakdownLabel: "Less: cumulative creditable withholding tax",
    formLine: "Less Tax Credits/Payments — Creditable Tax Withheld (Previous + This Quarter, combined)",
  },
];

function reorderForPartIV(breakdown: BreakdownLine[]): Array<{ formLine: string; line: BreakdownLine }> {
  const byLabel = new Map(breakdown.map((line) => [line.label, line]));
  const known = new Set(FORM_1701Q_PART_IV_ORDER.map((row) => row.breakdownLabel));

  const ordered = FORM_1701Q_PART_IV_ORDER.filter((row) => byLabel.has(row.breakdownLabel)).map((row) => ({
    formLine: row.formLine,
    line: byLabel.get(row.breakdownLabel)!,
  }));

  // Anything not in the map above (the final Tax Payable/Overpayment
  // line, whose label changes depending on the result) goes last, in
  // its original breakdown[] order.
  const remaining = breakdown
    .filter((line) => !known.has(line.label))
    .map((line) => ({ formLine: "Net Tax Payable / (Overpayment)", line }));

  return [...ordered, ...remaining];
}

function pad(str: string, width: number): string {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

function padStart(str: string, width: number): string {
  return str.length >= width ? str : " ".repeat(width - str.length) + str;
}

async function main() {
  const { fixture } = await import("./real-fixture.local");
  const f = fixture;

  if (!f.receipts?.length && !f.certificates?.length) {
    console.warn("WARNING: no receipts and no certificates in the fixture — did you forget to fill it in?");
  }

  const periodStart = periodStartDate(f.taxableYear, f.period);
  const periodEnd = periodEndDate(f.taxableYear, f.period);
  const cutoff = manilaDateInputToJsDate(f.certificateCutoffDate);

  // Gross sales: same window the real assembly layer uses
  // (lib/filingComputation.ts) — Jan 1 through this period's end.
  // Anything outside that window is excluded and flagged, not silently
  // summed in.
  const inWindowReceipts = f.receipts.filter((r) => {
    const d = manilaDateInputToJsDate(r.date);
    return d.getTime() >= periodStart.getTime() && d.getTime() <= periodEnd.getTime();
  });
  const excludedReceipts = f.receipts.filter((r) => !inWindowReceipts.includes(r));
  if (excludedReceipts.length > 0) {
    console.warn(
      `WARNING: ${excludedReceipts.length} receipt(s) fall outside ${f.period} ${f.taxableYear} ` +
        `(${formatManilaDate(periodStart)}–${formatManilaDate(periodEnd)}) and were excluded:`,
    );
    for (const r of excludedReceipts) console.warn(`  - ${r.date}: ₱${r.grossPesos.toLocaleString()}`);
  }
  const cumulativeGrossSalesCents = inWindowReceipts.reduce(
    (sum, r) => sum + pesosToCents(r.grossPesos),
    0,
  );

  // CWT: cutoff-based, per SPEC.md 3.5 — NOT period end. Reuses the same
  // sumCwtThroughPeriod() the real engine uses, so dedup/status filtering
  // behave identically here.
  const certsForCwt: CertificateForCwt[] = f.certificates.map((c, i) => ({
    id: `fixture-${i}`,
    taxWithheldCents: pesosToCents(c.taxWithheldPesos),
    dateReceived: manilaDateInputToJsDate(c.dateReceived),
    status: "RECORDED",
  }));
  const excludedCerts = f.certificates.filter(
    (c) => manilaDateInputToJsDate(c.dateReceived).getTime() > cutoff.getTime(),
  );
  if (excludedCerts.length > 0) {
    console.warn(
      `WARNING: ${excludedCerts.length} certificate(s) received after the cutoff ` +
        `(${formatManilaDate(cutoff)}) and were excluded — they belong on a later filing:`,
    );
    for (const c of excludedCerts) {
      console.warn(`  - received ${c.dateReceived}: ₱${c.taxWithheldPesos.toLocaleString()} withheld`);
    }
  }
  const cumulativeCwtCents = sumCwtThroughPeriod(certsForCwt, cutoff);

  const result = computeFiling({
    taxableYear: f.taxableYear,
    period: f.period,
    taxpayerType: f.taxpayerType,
    ruleSet: {
      incomeTaxRateBps: INCOME_TAX_RATE_BPS,
      allowableDeductionCents: pesosToCents(ALLOWABLE_DEDUCTION_PESOS),
    },
    cumulativeGrossSalesCents,
    cumulativeNonOperatingCents: pesosToCents(f.nonOperatingPesos),
    cumulativeCwtCents,
    priorPeriodPaymentsCents: pesosToCents(f.priorPeriodPaymentsPesos),
    priorYearExcessCreditCents: pesosToCents(f.priorYearExcessCreditPesos),
    certificateCutoffDate: cutoff,
    certificateCutoffSource: "MANUAL_OVERRIDE",
  });

  console.log("");
  console.log(`${f.taxpayerType} — TY${f.taxableYear} ${f.period} — Form ${result.formType}`);
  console.log(
    `Period: ${formatManilaDate(periodStart)} – ${formatManilaDate(periodEnd)}   ` +
      `Certificate cutoff: ${formatManilaDate(cutoff)}`,
  );
  console.log("Compare row-by-row against BIR Form 1701Q Part IV on the return you filed.");
  console.log("");

  const rows = reorderForPartIV(result.breakdown);
  const formLineWidth = Math.max(...rows.map((r) => r.formLine.length), "Form 1701Q line".length);
  const amountWidth = 16;

  console.log(`${pad("Form 1701Q line", formLineWidth)}  ${padStart("Amount (PHP)", amountWidth)}  Engine detail`);
  console.log("-".repeat(formLineWidth + amountWidth + 20));
  for (const { formLine, line } of rows) {
    const amount = centsToPesos(line.amountCents, { withSymbol: false });
    console.log(`${pad(formLine, formLineWidth)}  ${padStart(amount, amountWidth)}  ${line.sourceNote}`);
  }
  console.log("");

  if (result.isOverpayment) {
    console.log(`OVERPAYMENT: ${centsToPesos(result.overpaymentCents, { withSymbol: true })}`);
  } else {
    console.log(`NET TAX PAYABLE: ${centsToPesos(result.taxPayableCents, { withSymbol: true })}`);
  }
  console.log("");
  console.log("This is a preparation aid only — the filed return and BIR's own assessment govern.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
