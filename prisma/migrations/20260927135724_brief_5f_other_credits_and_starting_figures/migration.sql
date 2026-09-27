/*
  Warnings:

  - You are about to drop the column `otherCreditsCents` on the `ClientTaxYear` table. All the data in the column will be lost.
  - You are about to drop the column `otherCreditsDescription` on the `ClientTaxYear` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "StartingFigures" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "taxableYear" INTEGER NOT NULL,
    "clientTaxYearId" TEXT NOT NULL,
    "latestOutsideReturn" TEXT NOT NULL,
    "priorYearExcessCreditCents" INTEGER NOT NULL DEFAULT 0,
    "cumulativeIncomeCents" INTEGER NOT NULL DEFAULT 0,
    "withholdingPreviousQuartersCents" INTEGER NOT NULL DEFAULT 0,
    "withholdingThisQuarterCents" INTEGER NOT NULL DEFAULT 0,
    "paymentsPreviousQuartersCents" INTEGER NOT NULL DEFAULT 0,
    "amountPaidThisReturnCents" INTEGER NOT NULL DEFAULT 0,
    "otherCreditsCents" INTEGER NOT NULL DEFAULT 0,
    "otherCreditsDescription" TEXT,
    "nonOperatingIncomeCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "actorId" TEXT,
    CONSTRAINT "StartingFigures_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StartingFigures_clientTaxYearId_fkey" FOREIGN KEY ("clientTaxYearId") REFERENCES "ClientTaxYear" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ClientTaxYear" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "taxableYear" INTEGER NOT NULL,
    "regime" TEXT NOT NULL,
    "electionStatus" TEXT NOT NULL DEFAULT 'NOT_YET_ELECTED',
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
CREATE TABLE "new_Filing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "taxableYear" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "formType" TEXT NOT NULL,
    "statutoryDueDate" DATETIME NOT NULL,
    "adjustedDueDate" DATETIME NOT NULL,
    "certificatesExpectedBy" DATETIME,
    "internalFilingTarget" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "requiresSawt" BOOLEAN NOT NULL DEFAULT false,
    "computationSnapshot" JSONB,
    "certificatesAllReceivedAt" DATETIME,
    "filedAt" DATETIME,
    "filingReferenceNumber" TEXT,
    "amountPaidCents" INTEGER,
    "paymentDate" DATETIME,
    "paymentChannel" TEXT,
    "completenessNoteDismissedAt" DATETIME,
    "adviceMessageSubject" TEXT,
    "adviceMessageBody" TEXT,
    "adviceMessageSavedAt" DATETIME,
    "otherCreditsCents" INTEGER,
    "otherCreditsDescription" TEXT,
    "filedOutsideApp" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "deletedAt" DATETIME,
    "deletedReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "actorId" TEXT,
    CONSTRAINT "Filing_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Filing" ("actorId", "adjustedDueDate", "adviceMessageBody", "adviceMessageSavedAt", "adviceMessageSubject", "amountPaidCents", "certificatesAllReceivedAt", "certificatesExpectedBy", "clientId", "completenessNoteDismissedAt", "computationSnapshot", "createdAt", "deletedAt", "deletedReason", "filedAt", "filingReferenceNumber", "formType", "id", "internalFilingTarget", "notes", "paymentChannel", "paymentDate", "period", "requiresSawt", "status", "statutoryDueDate", "taxableYear", "updatedAt") SELECT "actorId", "adjustedDueDate", "adviceMessageBody", "adviceMessageSavedAt", "adviceMessageSubject", "amountPaidCents", "certificatesAllReceivedAt", "certificatesExpectedBy", "clientId", "completenessNoteDismissedAt", "computationSnapshot", "createdAt", "deletedAt", "deletedReason", "filedAt", "filingReferenceNumber", "formType", "id", "internalFilingTarget", "notes", "paymentChannel", "paymentDate", "period", "requiresSawt", "status", "statutoryDueDate", "taxableYear", "updatedAt" FROM "Filing";
DROP TABLE "Filing";
ALTER TABLE "new_Filing" RENAME TO "Filing";
CREATE INDEX "Filing_clientId_taxableYear_idx" ON "Filing"("clientId", "taxableYear");
CREATE INDEX "Filing_adjustedDueDate_idx" ON "Filing"("adjustedDueDate");
CREATE UNIQUE INDEX "Filing_clientId_taxableYear_period_key" ON "Filing"("clientId", "taxableYear", "period");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "StartingFigures_clientTaxYearId_key" ON "StartingFigures"("clientTaxYearId");

-- CreateIndex
CREATE UNIQUE INDEX "StartingFigures_clientId_taxableYear_key" ON "StartingFigures"("clientId", "taxableYear");
