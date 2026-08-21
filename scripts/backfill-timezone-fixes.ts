/**
 * One-off backfill: re-derives stored fields that were computed by the
 * comparisons/extractions fixed in the UTC/Manila sweep (this session),
 * and reports what changed. Default is a DRY RUN (report only); pass
 * --apply to actually write corrections.
 *
 * Checks, in order:
 *
 *   1. SalesTransaction.taxableYear/quarter -- re-derived from
 *      transactionDate via deriveTaxableYearAndQuarter (lib/dates.ts).
 *      The old logic misfiled any transaction dated the 1st of a month
 *      into the wrong quarter, and Jan 1 into Q4 of the PREVIOUS taxable
 *      year (a period this app has no filing type for).
 *
 *   2. Filing.adjustedDueDate -- re-derived from statutoryDueDate + the
 *      current Holiday table via resolveAdjustedDueDate. Expected to
 *      show ZERO mismatches: every real caller in this codebase always
 *      passes a clean UTC-midnight statutoryDueDate (constructed via
 *      Date.UTC in lib/tax/deadlines.ts's parseMonthDay), and the old and
 *      new shiftToNextBusinessDay implementations agree for any
 *      already-midnight-aligned input -- this check exists to CONFIRM
 *      that empirically, not because a mismatch is expected.
 *
 *   3. Filing.status -- re-derived from its steps + adjustedDueDate +
 *      "now" via deriveFilingStatus. The old isPastDue used a raw
 *      instant comparison, which could have written BLOCKED prematurely
 *      for the Manila-08:00-to-midnight window of a filing's own due
 *      date. Recomputing now with the fixed comparison catches any
 *      filing whose stored status is currently wrong as a result. Note:
 *      status is inherently time-dependent (only refreshed when a
 *      workflow step action touches the filing), so a mismatch here
 *      isn't necessarily caused by the old bug specifically -- it can
 *      also be ordinary staleness. Either way this backfill brings the
 *      stored value in line with the current, correct computation.
 *
 *   4. AmendmentAlert.reason -- free text, not a derived field this
 *      script auto-rewrites (it's a historical audit record, and
 *      correcting it would require reconstructing the pre-edit
 *      transactionDate from ActivityLog, which is a judgment call for a
 *      human, not a safe automatic rewrite). REPORT ONLY: flags any
 *      reason string containing the "date X -> Y" edit-reason pattern
 *      (updateSalesTransaction's editReason, lib/actions/
 *      salesTransactions.ts) that predates this session's fix, so it can
 *      be reviewed by hand.
 *
 * Usage:
 *   npx tsx scripts/backfill-timezone-fixes.ts            (dry run)
 *   npx tsx scripts/backfill-timezone-fixes.ts --apply     (writes corrections)
 *   npm run backfill:timezone-fixes -- --apply
 */

import { prisma } from "../lib/prisma";
import { deriveTaxableYearAndQuarter } from "../lib/dates";
import { resolveAdjustedDueDate } from "../lib/tax/deadlines";
import { deriveFilingStatus, type StepForStatus } from "../lib/workflow/status";

const APPLY = process.argv.includes("--apply");

async function backfillSalesTransactions() {
  console.log("\n=== 1. SalesTransaction.taxableYear / quarter ===");
  const rows = await prisma.salesTransaction.findMany({
    select: { id: true, transactionDate: true, taxableYear: true, quarter: true, deletedAt: true },
  });
  console.log(`Checked ${rows.length} row(s).`);

  let mismatches = 0;
  for (const row of rows) {
    const correct = deriveTaxableYearAndQuarter(row.transactionDate);
    if (correct.taxableYear !== row.taxableYear || correct.quarter !== row.quarter) {
      mismatches++;
      console.log(
        `  MISMATCH ${row.id}${row.deletedAt ? " (soft-deleted)" : ""}: transactionDate=${row.transactionDate.toISOString()} stored=TY${row.taxableYear} Q${row.quarter} correct=TY${correct.taxableYear} Q${correct.quarter}`,
      );
      if (APPLY) {
        await prisma.salesTransaction.update({
          where: { id: row.id },
          data: { taxableYear: correct.taxableYear, quarter: correct.quarter },
        });
        console.log("    -> updated.");
      }
    }
  }
  console.log(
    mismatches === 0
      ? "No mismatches."
      : `${mismatches} mismatch(es)${APPLY ? " fixed." : " found (dry run -- pass --apply to fix)."}`,
  );
}

async function backfillFilingAdjustedDueDate() {
  console.log("\n=== 2. Filing.adjustedDueDate ===");
  const [filings, holidays] = await Promise.all([
    prisma.filing.findMany({
      select: { id: true, taxableYear: true, period: true, statutoryDueDate: true, adjustedDueDate: true, deletedAt: true },
    }),
    prisma.holiday.findMany({ select: { date: true } }),
  ]);
  const holidayDates = holidays.map((h) => h.date);
  console.log(`Checked ${filings.length} row(s) against ${holidayDates.length} seeded holiday(s).`);

  let mismatches = 0;
  for (const f of filings) {
    const correct = resolveAdjustedDueDate(f.statutoryDueDate, holidayDates);
    if (correct.getTime() !== f.adjustedDueDate.getTime()) {
      mismatches++;
      console.log(
        `  MISMATCH ${f.id}${f.deletedAt ? " (soft-deleted)" : ""} TY${f.taxableYear} ${f.period}: statutory=${f.statutoryDueDate.toISOString()} stored adjusted=${f.adjustedDueDate.toISOString()} correct adjusted=${correct.toISOString()}`,
      );
      if (APPLY) {
        await prisma.filing.update({ where: { id: f.id }, data: { adjustedDueDate: correct } });
        console.log("    -> updated.");
      }
    }
  }
  console.log(
    mismatches === 0
      ? "No mismatches (expected -- every real caller always passes a clean UTC-midnight statutoryDueDate, so this fix could not have changed any already-stored value)."
      : `${mismatches} mismatch(es)${APPLY ? " fixed." : " found (dry run -- pass --apply to fix)."}`,
  );
}

async function backfillFilingStatus() {
  console.log("\n=== 3. Filing.status ===");
  const filings = await prisma.filing.findMany({
    select: {
      id: true,
      taxableYear: true,
      period: true,
      adjustedDueDate: true,
      status: true,
      deletedAt: true,
      workflowSteps: { select: { status: true, waitingOnLabel: true } },
    },
  });
  console.log(`Checked ${filings.length} row(s).`);

  const now = new Date();
  let mismatches = 0;
  for (const f of filings) {
    const steps: StepForStatus[] = f.workflowSteps.map((s) => ({ status: s.status, waitingOnLabel: s.waitingOnLabel }));
    const correct = deriveFilingStatus({ steps, adjustedDueDate: f.adjustedDueDate, now });
    if (correct !== f.status) {
      mismatches++;
      console.log(
        `  MISMATCH ${f.id}${f.deletedAt ? " (soft-deleted)" : ""} TY${f.taxableYear} ${f.period}: stored=${f.status} correct(as of now)=${correct}`,
      );
      if (APPLY) {
        await prisma.filing.update({ where: { id: f.id }, data: { status: correct } });
        console.log("    -> updated.");
      }
    }
  }
  console.log(
    mismatches === 0
      ? "No mismatches."
      : `${mismatches} mismatch(es)${APPLY ? " fixed." : " found (dry run -- pass --apply to fix)."} Note: status is inherently time-dependent, so this isn't necessarily bug-caused -- see the header comment.`,
  );
}

async function reportAmendmentAlertReasons() {
  console.log("\n=== 4. AmendmentAlert.reason (report only -- historical text is never auto-rewritten) ===");
  const alerts = await prisma.amendmentAlert.findMany({
    select: { id: true, filingId: true, reason: true, createdAt: true },
  });
  console.log(`Checked ${alerts.length} row(s).`);

  const editPattern = /date (\d{4}-\d{2}-\d{2}) -> (\d{4}-\d{2}-\d{2})/;
  let flagged = 0;
  for (const alert of alerts) {
    const match = alert.reason.match(editPattern);
    if (!match) continue; // not an edit-reason string (e.g. "new transaction added" reasons never used the buggy formatter)
    flagged++;
    console.log(`  FLAGGED ${alert.id} (filing ${alert.filingId}, ${alert.createdAt.toISOString()}): "${alert.reason}"`);
    console.log(
      `    Old date in reason: ${match[1]}. If this alert was created by an edit BEFORE this session's toISOString().split fix, that date may read one calendar day earlier than the real Manila transactionDate. Cross-check against ActivityLog's before-snapshot for this transaction and correct by hand if needed -- this script does not rewrite it automatically.`,
    );
  }
  console.log(flagged === 0 ? "No edit-reason strings found." : `${flagged} row(s) flagged for manual review.`);
}

async function main() {
  console.log(`UTC/Manila sweep backfill -- ${APPLY ? "APPLY mode (will write corrections)" : "DRY RUN (pass --apply to write corrections)"}`);
  await backfillSalesTransactions();
  await backfillFilingAdjustedDueDate();
  await backfillFilingStatus();
  await reportAmendmentAlertReasons();
  await prisma.$disconnect();
}

main();
