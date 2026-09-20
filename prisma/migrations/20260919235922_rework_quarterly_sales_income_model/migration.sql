/*
  Warnings:

  - You are about to drop the `ChartOfAccounts` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ImportBatch` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ImportMappingProfile` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `JournalEntry` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `JournalEntryLine` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SalesTransaction` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "Filing" ADD COLUMN "completenessNoteDismissedAt" DATETIME;
ALTER TABLE "Filing" ADD COLUMN "receiptsAcknowledgedSourceNote" TEXT;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ChartOfAccounts";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ImportBatch";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ImportMappingProfile";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "JournalEntry";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "JournalEntryLine";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "SalesTransaction";
PRAGMA foreign_keys=on;

-- CreateTable
-- QuarterlySales_quarter_check: SQLite enum columns are plain TEXT with no
-- native enforcement (see 20260820110000_add_period_check_constraints for
-- why Filing/SawtBatch.period got the same treatment). QuarterlySales.quarter
-- is a genuinely different four-value set from Filing.period (SPEC.md 3.1 —
-- sales quarters include Q4, filing periods never do), so it gets its own
-- CHECK naming its own four values rather than reusing Period's.
CREATE TABLE "QuarterlySales" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "taxableYear" INTEGER NOT NULL,
    "quarter" TEXT NOT NULL,
    "grossSalesCents" INTEGER NOT NULL,
    "nonOperatingIncomeCents" INTEGER NOT NULL DEFAULT 0,
    "sourceNote" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "actorId" TEXT,
    CONSTRAINT "QuarterlySales_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QuarterlySales_quarter_check" CHECK ("quarter" IN ('Q1', 'Q2', 'Q3', 'Q4'))
);

-- CreateIndex
CREATE INDEX "QuarterlySales_clientId_taxableYear_idx" ON "QuarterlySales"("clientId", "taxableYear");

-- CreateIndex
CREATE UNIQUE INDEX "QuarterlySales_clientId_taxableYear_quarter_key" ON "QuarterlySales"("clientId", "taxableYear", "quarter");
