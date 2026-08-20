-- DropIndex
DROP INDEX "SalesTransaction_clientId_orNumber_key";

-- CreateIndex
CREATE INDEX "SalesTransaction_clientId_orNumber_idx" ON "SalesTransaction"("clientId", "orNumber");
