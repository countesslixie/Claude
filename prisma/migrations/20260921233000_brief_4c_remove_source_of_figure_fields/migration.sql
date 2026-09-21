-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "receiptsAcknowledgedAt" DATETIME,
    "receiptsAcknowledgedNote" TEXT,
    "completenessNoteDismissedAt" DATETIME,
    "notes" TEXT,
    "deletedAt" DATETIME,
    "deletedReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "actorId" TEXT,
    CONSTRAINT "Filing_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Filing" ("actorId", "adjustedDueDate", "amountPaidCents", "certificatesAllReceivedAt", "certificatesExpectedBy", "clientId", "completenessNoteDismissedAt", "computationSnapshot", "createdAt", "deletedAt", "deletedReason", "filedAt", "filingReferenceNumber", "formType", "id", "internalFilingTarget", "notes", "paymentChannel", "paymentDate", "period", "receiptsAcknowledgedAt", "receiptsAcknowledgedNote", "requiresSawt", "status", "statutoryDueDate", "taxableYear", "updatedAt") SELECT "actorId", "adjustedDueDate", "amountPaidCents", "certificatesAllReceivedAt", "certificatesExpectedBy", "clientId", "completenessNoteDismissedAt", "computationSnapshot", "createdAt", "deletedAt", "deletedReason", "filedAt", "filingReferenceNumber", "formType", "id", "internalFilingTarget", "notes", "paymentChannel", "paymentDate", "period", "receiptsAcknowledgedAt", "receiptsAcknowledgedNote", "requiresSawt", "status", "statutoryDueDate", "taxableYear", "updatedAt" FROM "Filing";
DROP TABLE "Filing";
ALTER TABLE "new_Filing" RENAME TO "Filing";
CREATE INDEX "Filing_clientId_taxableYear_idx" ON "Filing"("clientId", "taxableYear");
CREATE INDEX "Filing_adjustedDueDate_idx" ON "Filing"("adjustedDueDate");
CREATE UNIQUE INDEX "Filing_clientId_taxableYear_period_key" ON "Filing"("clientId", "taxableYear", "period");
CREATE TABLE "new_QuarterlySales" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "taxableYear" INTEGER NOT NULL,
    "quarter" TEXT NOT NULL,
    "grossSalesCents" INTEGER NOT NULL,
    "nonOperatingIncomeCents" INTEGER NOT NULL DEFAULT 0,
    "noSalesThisQuarter" BOOLEAN NOT NULL DEFAULT false,
    "finalizedAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "actorId" TEXT,
    CONSTRAINT "QuarterlySales_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_QuarterlySales" ("actorId", "clientId", "createdAt", "finalizedAt", "grossSalesCents", "id", "noSalesThisQuarter", "nonOperatingIncomeCents", "notes", "quarter", "taxableYear", "updatedAt") SELECT "actorId", "clientId", "createdAt", "finalizedAt", "grossSalesCents", "id", "noSalesThisQuarter", "nonOperatingIncomeCents", "notes", "quarter", "taxableYear", "updatedAt" FROM "QuarterlySales";
DROP TABLE "QuarterlySales";
ALTER TABLE "new_QuarterlySales" RENAME TO "QuarterlySales";
CREATE INDEX "QuarterlySales_clientId_taxableYear_idx" ON "QuarterlySales"("clientId", "taxableYear");
CREATE UNIQUE INDEX "QuarterlySales_clientId_taxableYear_quarter_key" ON "QuarterlySales"("clientId", "taxableYear", "quarter");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

