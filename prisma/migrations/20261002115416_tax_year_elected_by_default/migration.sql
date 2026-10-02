-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ClientTaxYear" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "taxableYear" INTEGER NOT NULL,
    "regime" TEXT NOT NULL,
    "electionStatus" TEXT NOT NULL DEFAULT 'ELECTED',
    "electionEvidenceDocId" TEXT,
    "priorYearExcessCreditCents" INTEGER NOT NULL DEFAULT 0,
    "yearEndCreditElection" TEXT NOT NULL DEFAULT 'NA',
    "thresholdBreachedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "actorId" TEXT,
    CONSTRAINT "ClientTaxYear_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ClientTaxYear" ("actorId", "clientId", "createdAt", "electionEvidenceDocId", "electionStatus", "id", "priorYearExcessCreditCents", "regime", "taxableYear", "thresholdBreachedAt", "updatedAt", "yearEndCreditElection") SELECT "actorId", "clientId", "createdAt", "electionEvidenceDocId", "electionStatus", "id", "priorYearExcessCreditCents", "regime", "taxableYear", "thresholdBreachedAt", "updatedAt", "yearEndCreditElection" FROM "ClientTaxYear";
DROP TABLE "ClientTaxYear";
ALTER TABLE "new_ClientTaxYear" RENAME TO "ClientTaxYear";
CREATE INDEX "ClientTaxYear_taxableYear_idx" ON "ClientTaxYear"("taxableYear");
CREATE UNIQUE INDEX "ClientTaxYear_clientId_taxableYear_key" ON "ClientTaxYear"("clientId", "taxableYear");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- D136 — every existing tax year reads as 8% elected.
UPDATE "ClientTaxYear" SET "electionStatus" = 'ELECTED' WHERE "electionStatus" <> 'ELECTED';
