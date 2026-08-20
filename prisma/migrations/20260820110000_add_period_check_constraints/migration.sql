-- Hand-written migration (Phase 3, SPEC.md 16 item 6 / Phase 2b audit gap):
-- Prisma's `Period` enum has no SQLite-level enforcement — on SQLite every
-- Prisma enum column is just TEXT, validated only by the application layer.
-- ALL_PERIODS being the single source of truth for "no Q4" is only a
-- guarantee as long as every code path is disciplined about using it;
-- this migration makes the same guarantee true at the database level too,
-- independent of any application bug.
--
-- SQLite has no `ALTER TABLE ... ADD CONSTRAINT`, so a CHECK constraint
-- can only be added by rebuilding the table: create a new table with the
-- constraint, copy the data across, drop the old table, rename the new
-- one into place, then recreate its indexes.

PRAGMA foreign_keys=OFF;

-- Filing --------------------------------------------------------------------

CREATE TABLE "new_Filing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "taxableYear" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "formType" TEXT NOT NULL,
    "statutoryDueDate" DATETIME NOT NULL,
    "adjustedDueDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "requiresSawt" BOOLEAN NOT NULL DEFAULT false,
    "computationSnapshot" JSONB,
    "filedAt" DATETIME,
    "filingReferenceNumber" TEXT,
    "amountPaidCents" INTEGER,
    "paymentDate" DATETIME,
    "paymentChannel" TEXT,
    "notes" TEXT,
    "deletedAt" DATETIME,
    "deletedReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "actorId" TEXT,
    "receiptsAcknowledgedAt" DATETIME,
    "receiptsAcknowledgedNote" TEXT,
    "certificateCutoffOverride" DATETIME,
    "certificatesExpectedBy" DATETIME,
    "internalFilingTarget" DATETIME,
    CONSTRAINT "Filing_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Filing_period_check" CHECK ("period" IN ('Q1', 'Q2', 'Q3', 'ANNUAL'))
);

INSERT INTO "new_Filing" (
    "id", "clientId", "taxableYear", "period", "formType", "statutoryDueDate",
    "adjustedDueDate", "status", "requiresSawt", "computationSnapshot", "filedAt",
    "filingReferenceNumber", "amountPaidCents", "paymentDate", "paymentChannel",
    "notes", "deletedAt", "deletedReason", "createdAt", "updatedAt", "actorId",
    "receiptsAcknowledgedAt", "receiptsAcknowledgedNote", "certificateCutoffOverride",
    "certificatesExpectedBy", "internalFilingTarget"
)
SELECT
    "id", "clientId", "taxableYear", "period", "formType", "statutoryDueDate",
    "adjustedDueDate", "status", "requiresSawt", "computationSnapshot", "filedAt",
    "filingReferenceNumber", "amountPaidCents", "paymentDate", "paymentChannel",
    "notes", "deletedAt", "deletedReason", "createdAt", "updatedAt", "actorId",
    "receiptsAcknowledgedAt", "receiptsAcknowledgedNote", "certificateCutoffOverride",
    "certificatesExpectedBy", "internalFilingTarget"
FROM "Filing";

DROP TABLE "Filing";
ALTER TABLE "new_Filing" RENAME TO "Filing";

CREATE INDEX "Filing_clientId_taxableYear_idx" ON "Filing"("clientId", "taxableYear");
CREATE INDEX "Filing_adjustedDueDate_idx" ON "Filing"("adjustedDueDate");
CREATE UNIQUE INDEX "Filing_clientId_taxableYear_period_key" ON "Filing"("clientId", "taxableYear", "period");

-- SawtBatch -------------------------------------------------------------------

CREATE TABLE "new_SawtBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "taxableYear" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "generatedAt" DATETIME,
    "emailedAt" DATETIME,
    "acknowledgedAt" DATETIME,
    "validatedAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    CONSTRAINT "SawtBatch_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SawtBatch_period_check" CHECK ("period" IN ('Q1', 'Q2', 'Q3', 'ANNUAL'))
);

INSERT INTO "new_SawtBatch" (
    "id", "clientId", "taxableYear", "period", "status", "generatedAt",
    "emailedAt", "acknowledgedAt", "validatedAt", "notes", "createdAt", "actorId"
)
SELECT
    "id", "clientId", "taxableYear", "period", "status", "generatedAt",
    "emailedAt", "acknowledgedAt", "validatedAt", "notes", "createdAt", "actorId"
FROM "SawtBatch";

DROP TABLE "SawtBatch";
ALTER TABLE "new_SawtBatch" RENAME TO "SawtBatch";

CREATE INDEX "SawtBatch_clientId_taxableYear_period_idx" ON "SawtBatch"("clientId", "taxableYear", "period");

PRAGMA foreign_keys=ON;
