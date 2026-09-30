-- AlterTable
ALTER TABLE "Filing" ADD COLUMN "clientPackageEmailBody" TEXT;
ALTER TABLE "Filing" ADD COLUMN "clientPackageEmailSavedAt" DATETIME;
ALTER TABLE "Filing" ADD COLUMN "clientPackageEmailSubject" TEXT;
ALTER TABLE "Filing" ADD COLUMN "clientPackageEmailTo" TEXT;

-- AlterTable
ALTER TABLE "TaxRuleSet" ADD COLUMN "annualDocsDueMonthDay" TEXT NOT NULL DEFAULT '02-15';
