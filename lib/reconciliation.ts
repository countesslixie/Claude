import { prisma } from "@/lib/prisma";

/**
 * SPEC.md section 10 reconciliation, revised for the 2307-driven entry
 * workflow (the 2307 is now the source document for a transaction, not
 * an independent check on it — so "transaction CWT vs certificate CWT"
 * is no longer a meaningful comparison; one derives from the other).
 *
 * Replaced with:
 *   1. Transactions with no linked Form2307 — the real gap: receipts
 *      that might be missing a certificate, or genuinely have none.
 *   2. Certificates received for the period not yet converted into a
 *      transaction.
 *   3. Total CWT claimed on the filing vs. sum of certificates in the
 *      SAWT batch — kept, still a genuine cross-check against what
 *      actually gets filed.
 */
export async function getPeriodReconciliation(clientId: string, taxableYear: number, quarter: number) {
  const [certificates, transactions] = await Promise.all([
    prisma.form2307.findMany({
      where: { clientId, taxableYear, quarterCovered: quarter, deletedAt: null },
      orderBy: { dateReceived: "asc" },
    }),
    prisma.salesTransaction.findMany({
      where: { clientId, taxableYear, quarter, deletedAt: null },
      orderBy: { transactionDate: "asc" },
    }),
  ]);

  const transactionsWithoutForm2307 = transactions.filter((t) => !t.form2307Id);
  const transactionsWithoutForm2307TotalCents = transactionsWithoutForm2307.reduce(
    (sum, t) => sum + t.grossAmountCents,
    0,
  );

  const convertedCertificateIds = new Set(
    transactions.filter((t) => t.form2307Id).map((t) => t.form2307Id as string),
  );
  const certificatesNotYetConverted = certificates.filter((c) => !convertedCertificateIds.has(c.id));
  const certificatesNotYetConvertedTotalCents = certificatesNotYetConverted.reduce(
    (sum, c) => sum + c.taxWithheldCents,
    0,
  );

  const certificatesInSawtBatch = certificates.filter((c) => c.sawtBatchId);
  const sawtBatchCwtCents = certificatesInSawtBatch.reduce((sum, c) => sum + c.taxWithheldCents, 0);
  const hasSawtBatch = certificatesInSawtBatch.length > 0;

  return {
    transactionsWithoutForm2307,
    transactionsWithoutForm2307TotalCents,
    certificatesNotYetConverted,
    certificatesNotYetConvertedTotalCents,
    hasSawtBatch,
    sawtBatchCwtCents,
    certificatesInSawtBatchCount: certificatesInSawtBatch.length,
  };
}
