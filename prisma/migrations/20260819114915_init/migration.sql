-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "registeredName" TEXT NOT NULL,
    "tradeName" TEXT,
    "tin" TEXT NOT NULL,
    "branchCode" TEXT NOT NULL DEFAULT '000',
    "rdoCode" TEXT NOT NULL,
    "registeredAddress" TEXT NOT NULL,
    "email" TEXT,
    "mobile" TEXT,
    "taxpayerType" TEXT NOT NULL,
    "lineOfBusiness" TEXT,
    "psicCode" TEXT,
    "civilStatus" TEXT,
    "booksType" TEXT NOT NULL,
    "booksRegistrationDate" DATETIME,
    "booksPermitNumber" TEXT,
    "swornDeclarationOnFile" BOOLEAN NOT NULL DEFAULT false,
    "swornDeclarationYear" INTEGER,
    "eBIRFormsEmail" TEXT,
    "eFPSEnrolled" BOOLEAN NOT NULL DEFAULT false,
    "defaultWithholdingRateBps" INTEGER,
    "recognitionBasis" TEXT NOT NULL DEFAULT 'COLLECTION',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "engagedSince" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "actorId" TEXT
);

-- CreateTable
CREATE TABLE "ClientTaxYear" (
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

-- CreateTable
CREATE TABLE "SalesTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "transactionDate" DATETIME NOT NULL,
    "taxableYear" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "orNumber" TEXT,
    "payorName" TEXT NOT NULL,
    "payorTin" TEXT,
    "grossAmountCents" INTEGER NOT NULL,
    "withholdingTaxCents" INTEGER NOT NULL DEFAULT 0,
    "withholdingRateBps" INTEGER NOT NULL DEFAULT 0,
    "netReceivedCents" INTEGER NOT NULL,
    "incomeType" TEXT NOT NULL DEFAULT 'OPERATING',
    "description" TEXT,
    "form2307Id" TEXT,
    "sourceDocumentId" TEXT,
    "importBatchId" TEXT,
    "deletedAt" DATETIME,
    "deletedReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    CONSTRAINT "SalesTransaction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SalesTransaction_form2307Id_fkey" FOREIGN KEY ("form2307Id") REFERENCES "Form2307" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SalesTransaction_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SalesTransaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Form2307" (
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
    "dateReceived" DATETIME,
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

-- CreateTable
CREATE TABLE "Filing" (
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
    CONSTRAINT "Filing_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AmendmentAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filingId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "recomputedJson" JSONB NOT NULL,
    "deltaCents" INTEGER NOT NULL,
    "acknowledgedAt" DATETIME,
    "acknowledgedNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    CONSTRAINT "AmendmentAlert_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "Filing" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkflowStepTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stepCode" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "isConditional" BOOLEAN NOT NULL DEFAULT false,
    "conditionExpression" TEXT,
    "isWaitingState" BOOLEAN NOT NULL DEFAULT false,
    "waitingOnLabel" TEXT,
    "expectedResponseDays" INTEGER,
    "requiredDocSlots" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WorkflowStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filingId" TEXT NOT NULL,
    "stepCode" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "isConditional" BOOLEAN NOT NULL DEFAULT false,
    "conditionExpression" TEXT,
    "isWaitingState" BOOLEAN NOT NULL DEFAULT false,
    "expectedResponseDays" INTEGER,
    "waitingSince" DATETIME,
    "followUpCount" INTEGER NOT NULL DEFAULT 0,
    "requiredDocSlots" JSONB NOT NULL,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "skippedReason" TEXT,
    "notes" TEXT,
    "actorId" TEXT,
    CONSTRAINT "WorkflowStep_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "Filing" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "filingId" TEXT,
    "workflowStepId" TEXT,
    "docSlotCode" TEXT,
    "form2307Id" TEXT,
    "category" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "storedPath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "documentDate" DATETIME NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "notes" TEXT,
    "deletedAt" DATETIME,
    "deletedReason" TEXT,
    CONSTRAINT "Document_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Document_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "Filing" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Document_workflowStepId_fkey" FOREIGN KEY ("workflowStepId") REFERENCES "WorkflowStep" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Document_form2307Id_fkey" FOREIGN KEY ("form2307Id") REFERENCES "Form2307" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChartOfAccounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "entryType" TEXT NOT NULL DEFAULT 'GENERAL',
    "entryDate" DATETIME NOT NULL,
    "particulars" TEXT NOT NULL,
    "payee" TEXT,
    "memo" TEXT,
    "lockedAt" DATETIME,
    "deletedAt" DATETIME,
    "deletedReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    CONSTRAINT "JournalEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JournalEntryLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "journalEntryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debitCents" INTEGER NOT NULL DEFAULT 0,
    "creditCents" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    CONSTRAINT "JournalEntryLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JournalEntryLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ChartOfAccounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SawtBatch" (
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
    CONSTRAINT "SawtBatch_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaxRuleSet" (
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
    "surchargeRateBps" INTEGER,
    "interestRateBpsPerAnnum" INTEGER,
    "compromisePenaltySchedule" JSONB,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "actorId" TEXT
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'NATIONAL',
    "localScope" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT
);

-- CreateTable
CREATE TABLE "AtcCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "payeeType" TEXT,
    "verifiedAgainstIssuance" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ImportMappingProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "columnMapping" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImportMappingProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "sourceFilename" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "successRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "errorReport" JSONB,
    "committedAt" DATETIME,
    "rolledBackAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    CONSTRAINT "ImportBatch_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "actorId" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Client_code_key" ON "Client"("code");

-- CreateIndex
CREATE INDEX "Client_isActive_idx" ON "Client"("isActive");

-- CreateIndex
CREATE INDEX "ClientTaxYear_taxableYear_idx" ON "ClientTaxYear"("taxableYear");

-- CreateIndex
CREATE UNIQUE INDEX "ClientTaxYear_clientId_taxableYear_key" ON "ClientTaxYear"("clientId", "taxableYear");

-- CreateIndex
CREATE INDEX "SalesTransaction_clientId_taxableYear_quarter_idx" ON "SalesTransaction"("clientId", "taxableYear", "quarter");

-- CreateIndex
CREATE INDEX "SalesTransaction_clientId_transactionDate_idx" ON "SalesTransaction"("clientId", "transactionDate");

-- CreateIndex
CREATE UNIQUE INDEX "SalesTransaction_clientId_orNumber_key" ON "SalesTransaction"("clientId", "orNumber");

-- CreateIndex
CREATE INDEX "Form2307_clientId_taxableYear_quarterCovered_idx" ON "Form2307"("clientId", "taxableYear", "quarterCovered");

-- CreateIndex
CREATE INDEX "Filing_clientId_taxableYear_idx" ON "Filing"("clientId", "taxableYear");

-- CreateIndex
CREATE INDEX "Filing_adjustedDueDate_idx" ON "Filing"("adjustedDueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Filing_clientId_taxableYear_period_key" ON "Filing"("clientId", "taxableYear", "period");

-- CreateIndex
CREATE INDEX "AmendmentAlert_filingId_idx" ON "AmendmentAlert"("filingId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowStepTemplate_stepCode_key" ON "WorkflowStepTemplate"("stepCode");

-- CreateIndex
CREATE INDEX "WorkflowStep_filingId_sequence_idx" ON "WorkflowStep"("filingId", "sequence");

-- CreateIndex
CREATE INDEX "WorkflowStep_status_idx" ON "WorkflowStep"("status");

-- CreateIndex
CREATE INDEX "Document_clientId_idx" ON "Document"("clientId");

-- CreateIndex
CREATE INDEX "Document_filingId_idx" ON "Document"("filingId");

-- CreateIndex
CREATE INDEX "Document_sha256_idx" ON "Document"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "ChartOfAccounts_code_key" ON "ChartOfAccounts"("code");

-- CreateIndex
CREATE INDEX "JournalEntry_clientId_entryDate_idx" ON "JournalEntry"("clientId", "entryDate");

-- CreateIndex
CREATE INDEX "JournalEntryLine_journalEntryId_idx" ON "JournalEntryLine"("journalEntryId");

-- CreateIndex
CREATE INDEX "JournalEntryLine_accountId_idx" ON "JournalEntryLine"("accountId");

-- CreateIndex
CREATE INDEX "SawtBatch_clientId_taxableYear_period_idx" ON "SawtBatch"("clientId", "taxableYear", "period");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRuleSet_taxableYear_key" ON "TaxRuleSet"("taxableYear");

-- CreateIndex
CREATE INDEX "Holiday_date_idx" ON "Holiday"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_localScope_key" ON "Holiday"("date", "localScope");

-- CreateIndex
CREATE UNIQUE INDEX "AtcCode_code_key" ON "AtcCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ImportMappingProfile_clientId_name_key" ON "ImportMappingProfile"("clientId", "name");

-- CreateIndex
CREATE INDEX "ImportBatch_clientId_idx" ON "ImportBatch"("clientId");

-- CreateIndex
CREATE INDEX "ActivityLog_entityType_entityId_idx" ON "ActivityLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ActivityLog_at_idx" ON "ActivityLog"("at");
