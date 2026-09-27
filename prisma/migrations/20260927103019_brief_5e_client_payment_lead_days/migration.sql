-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TaxRuleSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taxableYear" INTEGER NOT NULL,
    "effectiveFrom" DATETIME NOT NULL,
    "effectiveTo" DATETIME,
    "incomeTaxRateBps" INTEGER NOT NULL,
    "vatThresholdCents" INTEGER NOT NULL,
    "allowableDeductionCents" INTEGER NOT NULL,
    "q1DueMonthDay" TEXT NOT NULL,
    "q2DueMonthDay" TEXT NOT NULL,
    "q3DueMonthDay" TEXT NOT NULL,
    "annualDueMonthDay" TEXT NOT NULL,
    "sawtDeadlineOffsetDays" INTEGER NOT NULL DEFAULT 0,
    "eafsDeadlineOffsetDays" INTEGER NOT NULL DEFAULT 15,
    "clientPaymentLeadDays" INTEGER NOT NULL DEFAULT 10,
    "surchargeRateBps" INTEGER,
    "interestRateBpsPerAnnum" INTEGER,
    "compromisePenaltySchedule" JSONB,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "actorId" TEXT
);
INSERT INTO "new_TaxRuleSet" ("actorId", "allowableDeductionCents", "annualDueMonthDay", "compromisePenaltySchedule", "createdAt", "eafsDeadlineOffsetDays", "effectiveFrom", "effectiveTo", "id", "incomeTaxRateBps", "interestRateBpsPerAnnum", "notes", "q1DueMonthDay", "q2DueMonthDay", "q3DueMonthDay", "sawtDeadlineOffsetDays", "surchargeRateBps", "taxableYear", "updatedAt", "vatThresholdCents") SELECT "actorId", "allowableDeductionCents", "annualDueMonthDay", "compromisePenaltySchedule", "createdAt", "eafsDeadlineOffsetDays", "effectiveFrom", "effectiveTo", "id", "incomeTaxRateBps", "interestRateBpsPerAnnum", "notes", "q1DueMonthDay", "q2DueMonthDay", "q3DueMonthDay", "sawtDeadlineOffsetDays", "surchargeRateBps", "taxableYear", "updatedAt", "vatThresholdCents" FROM "TaxRuleSet";
DROP TABLE "TaxRuleSet";
ALTER TABLE "new_TaxRuleSet" RENAME TO "TaxRuleSet";
CREATE UNIQUE INDEX "TaxRuleSet_taxableYear_key" ON "TaxRuleSet"("taxableYear");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
