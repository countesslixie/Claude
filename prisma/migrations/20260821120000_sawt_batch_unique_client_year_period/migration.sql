-- DropIndex
DROP INDEX "SawtBatch_clientId_taxableYear_period_idx";

-- CreateIndex
CREATE UNIQUE INDEX "SawtBatch_clientId_taxableYear_period_key" ON "SawtBatch"("clientId", "taxableYear", "period");
