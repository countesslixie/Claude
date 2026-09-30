-- Brief #5s (D106): the client's document deadline is a day of the month
-- (default 20), replacing brief #5r's annual-only "MM-DD" column. Nothing from
-- the old column is carried forward.
ALTER TABLE "TaxRuleSet" DROP COLUMN "annualDocsDueMonthDay";
ALTER TABLE "TaxRuleSet" ADD COLUMN "clientDocsDueDay" INTEGER NOT NULL DEFAULT 20;
