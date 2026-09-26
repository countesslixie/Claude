-- CreateTable
CREATE TABLE "Payor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tin" TEXT,
    "address" TEXT,
    "usualAtcCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "actorId" TEXT,
    CONSTRAINT "Payor_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Form2307" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "taxableYear" INTEGER NOT NULL,
    "payorName" TEXT NOT NULL,
    "payorTin" TEXT,
    "payorAddress" TEXT,
    "periodFrom" DATETIME NOT NULL,
    "periodTo" DATETIME NOT NULL,
    "quarterCovered" INTEGER NOT NULL,
    "atcCode" TEXT NOT NULL,
    "incomePaymentCents" INTEGER NOT NULL,
    "taxWithheldCents" INTEGER NOT NULL,
    "withholdingRateBps" INTEGER NOT NULL,
    "rateOverridden" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "documentId" TEXT,
    "claimedOnFilingId" TEXT,
    "sawtBatchId" TEXT,
    "notes" TEXT,
    "deletedAt" DATETIME,
    "deletedReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "actorId" TEXT,
    CONSTRAINT "Form2307_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Form2307_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Form2307_claimedOnFilingId_fkey" FOREIGN KEY ("claimedOnFilingId") REFERENCES "Filing" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Form2307_sawtBatchId_fkey" FOREIGN KEY ("sawtBatchId") REFERENCES "SawtBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Form2307" ("actorId", "atcCode", "claimedOnFilingId", "clientId", "createdAt", "deletedAt", "deletedReason", "documentId", "id", "incomePaymentCents", "notes", "payorAddress", "payorName", "payorTin", "periodFrom", "periodTo", "quarterCovered", "sawtBatchId", "status", "taxWithheldCents", "taxableYear", "updatedAt", "withholdingRateBps") SELECT "actorId", "atcCode", "claimedOnFilingId", "clientId", "createdAt", "deletedAt", "deletedReason", "documentId", "id", "incomePaymentCents", "notes", "payorAddress", "payorName", "payorTin", "periodFrom", "periodTo", "quarterCovered", "sawtBatchId", "status", "taxWithheldCents", "taxableYear", "updatedAt", "withholdingRateBps" FROM "Form2307";
DROP TABLE "Form2307";
ALTER TABLE "new_Form2307" RENAME TO "Form2307";
CREATE INDEX "Form2307_clientId_taxableYear_quarterCovered_idx" ON "Form2307"("clientId", "taxableYear", "quarterCovered");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Payor_clientId_isActive_idx" ON "Payor"("clientId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Payor_clientId_name_key" ON "Payor"("clientId", "name");
