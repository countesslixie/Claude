# SPEC: BIR 8% Freelancer Practice Manager (MVP)

> **How to use this file with Claude Code**
> Place this at the repo root as `SPEC.md`. Start with:
> `claude "Read SPEC.md. Build Phase 1 only. Ask me before deviating from the data model or the tax engine rules."`
> Build phase by phase. Do not let the agent build all phases in one pass.

---

## 1. Purpose

I am a bookkeeper serving multiple Philippine freelancers/professionals who elected the **8% income tax option**. Because only gross sales/receipts are taxed, the accounting is simple — but the **compliance choreography is not**. Each filing cycle spans 15+ steps, several of which stall for weeks waiting on BIR email responses.

**The problem this system solves is not arithmetic. It is state tracking.**

At any moment I must be able to answer, in under 10 seconds:
- Which client/period am I in the middle of?
- What is the next action, and is it blocked on me, the client, or BIR?
- Which required documents have I not yet saved?
- What has been waiting on BIR too long and needs a follow-up?

Secondary goals: replace the scattered per-client Excel files with one source of truth, auto-produce the 4 books of accounts, and compute quarterly/annual tax including Form 2307 creditable withholding.

**Primary success metric:** a single dashboard that makes "I'm lost as to which process I'm in" structurally impossible.

---

## 2. Users & Scope

**User:** one bookkeeper (me). Single-operator, local-first. Multi-user is out of scope; design the schema so it *could* be added (every mutation records an `actorId`, defaulted to a single seeded user).

### In scope (MVP)
- Client master file (registration details, tax regime, election status)
- Sales/receipt transaction recording
- Form 2307 register (creditable withholding tax certificates)
- Tax computation engine: 1701Q (Q1–Q3) and 1701A (annual)
- Filing workflow engine with per-step document slots and waiting-state aging
- Document vault with enforced naming convention
- 4 books of accounts, generated and printable
- SAWT / alphalist preparation worksheet
- Excel/CSV import from my existing files; XLSX export
- Dashboard, calendar, and per-client pipeline views

### Out of scope (MVP)
- Direct integration with eBIRForms, eFPS, eAFS, or BIR email systems. **There is no public API. Every BIR interaction stays manual — the system tracks and stores, it does not transmit.** Do not scaffold fake integrations.
- Automatic .DAT file generation for the Alphalist Data Entry Module. MVP produces a **keying worksheet** that mirrors the module's field order so manual entry is fast and error-free. (See §10 and Open Question 4.)
- Payroll, VAT, percentage tax returns, expanded withholding as a *withholding agent*
- Client-facing portal or login
- Automatic email sending or inbox scraping (Phase 5 candidate)

---

## 3. Domain Rules — Philippine 8% Income Tax

> **Implementation rule:** every number, rate, threshold, and deadline in this section must live in a **versioned configuration table with effectivity dates** (`TaxRuleSet`), never as a hardcoded literal in application code. Tax law changes. The engine reads the rule set applicable to the taxable year being computed.

### 3.1 Eligibility & election
- Available to self-employed individuals and professionals whose gross sales/receipts and other non-operating income for the year do **not exceed the VAT threshold of ₱3,000,000**.
- The 8% is **in lieu of** both the graduated income tax rates and the 3%/1% percentage tax under Sec. 116. A client on 8% does **not** file 2551Q.
- The option must be **elected each taxable year** (typically via the first-quarter return, or a registration update). If not validly elected, the taxpayer defaults to graduated rates.
- **System requirement:** the client record carries `electionStatus` per taxable year (`Elected` / `Not yet elected` / `Defaulted to graduated`) with an evidence document slot. The dashboard raises a **hard blocker** on any Q1 filing where election for that year is unconfirmed.

### 3.2 Computation

Let `TY` = taxable year, computed **cumulatively year-to-date** for every period.

```
cumulativeGrossSales        = sum of gross sales/receipts, Jan 1 → end of period
cumulativeNonOperating      = sum of other non-operating income, Jan 1 → end of period
cumulativeGross             = cumulativeGrossSales + cumulativeNonOperating
allowableDeduction          = ₱250,000  IF taxpayerType = PURELY_SELF_EMPLOYED
                            = ₱0        IF taxpayerType = MIXED_INCOME
taxableBase                 = MAX(0, cumulativeGross - allowableDeduction)
incomeTaxDue                = ROUND(taxableBase × 8%, 2)
cumulativeCWT               = sum of tax withheld per Form 2307, YTD, status ∈ {Recorded, Claimed}
priorPeriodPayments         = sum of tax actually paid on earlier returns for the same TY
priorYearExcessCredits      = carried-over excess credit elected as "carry over" (see 3.3)
taxPayable                  = incomeTaxDue
                              - cumulativeCWT
                              - priorPeriodPayments
                              - priorYearExcessCredits
```

- If `taxPayable < 0` → **overpayment**. Display as such; do not render a negative amount due. Do not net it against a later period *outside* the cumulative mechanism — the cumulative formula already carries it forward within the year automatically. Guard against double-counting: `priorPeriodPayments` means **amounts actually remitted**, never computed liabilities.
- The ₱250,000 deduction is a **once-per-year** figure and is applied in full from Q1 onward because the return is cumulative. It is **not** ₱62,500 per quarter. Add a unit test asserting this.
- **Mixed income earners get no ₱250,000 deduction** on the business portion (it is already embedded in the graduated table applied to their compensation). Also note: a mixed income earner files **BIR Form 1701**, not 1701A. The system must select the correct annual form from `taxpayerType`.

### 3.3 Year-end excess credit
On the annual return, if credits exceed tax due, the taxpayer elects one of: **refund**, **Tax Credit Certificate**, or **carry over to next year**. Store the election on the annual `Filing`; if `carryOver`, the amount becomes `priorYearExcessCredits` for the following taxable year.

### 3.4 Threshold monitoring
Continuously track `cumulativeGross` against ₱3,000,000. Emit escalating warnings at **80%**, **95%**, and **breach**. On breach the system must display a prominent, non-dismissible banner on the client record stating that the 8% option ceases to apply and the taxpayer becomes liable under the graduated rates with VAT registration consequences — and instructing me to consult the current BIR issuance. **Do not attempt to auto-compute the transition.** Flag only.

### 3.5 Form 2307 / creditable withholding
- Form 2307 = *Certificate of Creditable Tax Withheld at Source*, issued by the client's payor.
- Typical rate on professional fees to an individual payee: **5%** where the payee has furnished a sworn declaration that gross income will not exceed ₱3,000,000, otherwise **10%**. Store `withholdingRate` and `atcCode` per certificate; never infer the rate.
- Seed an **editable ATC reference table** (code, description, rate, payee type). Seed with the common professional-fee and contractor codes, each marked `verifiedAgainstIssuance: false` so I confirm them against the current BIR list before first live use. **Do not let the agent invent ATC codes it is unsure of** — leave the table sparse and editable rather than plausibly wrong.
- Certificate status lifecycle: `Received → Recorded → ClaimedOnReturn → IncludedInSAWT → Acknowledged → Validated`.
- **CWT cutoff rule.** A certificate is claimed in the period whose *cutoff* it falls within — not the period whose calendar dates it economically covers. The cutoff is resolved per filing (highest priority first): a manual override, if the bookkeeper has set one; otherwise the filing's actual `filedAt`, once filed; otherwise "today," for a live preview of an unfiled filing. Certificates routinely arrive weeks after the period they cover closes (e.g. a Q2 certificate arriving in early August, after the June 30 period end), so the period's own end date is never used as the cutoff. **The bookkeeper does not file amended returns** when a certificate arrives late — it is simply claimed on whichever filing is open (by cutoff) when it arrives.

### 3.6 Deadlines

| Return | Period | Statutory due date |
|---|---|---|
| 1701Q | Q1 (Jan–Mar) | May 15 |
| 1701Q | Q2 (Apr–Jun) | August 15 |
| 1701Q | Q3 (Jul–Sep) | November 15 |
| 1701A / 1701 | Annual | April 15 of the following year |

Each quarterly period runs the full calendar quarter (Q1 Jan 1–Mar 31, Q2 Apr 1–Jun 30, Q3 Jul 1–Sep 30); the annual period is the full taxable year, Jan 1–Dec 31 — not just Q4.

- **There is no Q4 quarterly return.** The annual return covers the fourth quarter. Hardcoding a Q4 filing is a bug.
- **Business-day shifting:** if a due date falls on a Saturday, Sunday, or a holiday, it moves to the next working day. Implement against an **editable `Holiday` table** (regular + special non-working, national and local). Seed the current and next year; surface an admin screen to maintain it. Never compute holidays algorithmically.
- SAWT submission deadline is a **configurable offset** per `TaxRuleSet`, defaulting to *same day as the return deadline*. eAFS submission deadline is **derived**, never stored as a plain date: `eafsDueDate = (filedAt is null OR filedAt ≤ adjustedDueDate ? adjustedDueDate : filedAt) + eafsDeadlineOffsetDays` (offset configurable per `TaxRuleSet`, defaulting to 15 days), then business-day shifted. **Filing early never moves the eAFS deadline earlier** — only filing late (after the due date) pushes it out further, counted from the actual filing date instead of the due date.
- **Working calendar (practice targets, distinct from the statutory deadline above).** Per filing: `certificatesExpectedBy` (when the bookkeeper expects to have all certificates for the period in hand) and `internalFilingTarget` (when the bookkeeper aims to file), both independently editable and never authoritative — the statutory/adjusted due date above always governs. **Quarterly returns (Q1/Q2/Q3): `internalFilingTarget` is the ADJUSTED (business-day-shifted) due date itself — deliberately no internal buffer.** The bookkeeper works to the normal statutory deadline for quarterlies; e.g. Q2 2026's `internalFilingTarget` is Aug 17 (the adjusted date), not Aug 15 (the raw statutory date, a Saturday). `certificatesExpectedBy` is 10 days before the *statutory* due date (unshifted) regardless. One consequence of no buffer: for a quarterly filing, every prep-step row and the `FILE_RETURN` row show the *same* due date — the "Due" column carries one consistent meaning (the adjusted deadline) for that filing, not two different numbers depending on which step you're looking at. **The annual return keeps a real buffer instead**, reflecting the larger scope of the alphalist/SAWT compilation involved: `certificatesExpectedBy` Feb 15, `internalFilingTarget` Mar 31 (of the following year) — weeks ahead of the Apr 15 statutory/adjusted deadline. The `RECEIVE_2307` workflow step's waiting clock starts from `certificatesExpectedBy`, not the period's end date — certificates are often not even due from the payor until weeks after the period closes.
  - *Known limitation:* `internalFilingTarget` is a single value per filing, shared by every prep step's displayed due date (everything except `RECEIVE_2307` and `FILE_RETURN` itself) — so every prep row for a filing shows the same date rather than a date staggered per step. For quarterlies this is now intentional (see above); it remains a real limitation for the annual return, where a per-step staggering ahead of the Mar 31 target could be useful at scale. Not a bug; revisit if that granularity becomes useful.
- All date arithmetic uses timezone **Asia/Manila**. Store timestamps as UTC ISO strings; convert at the boundary. Never use the host's local timezone.

### 3.7 Late filing exposure (informational only)
Provide an optional calculator: surcharge, interest per annum, and compromise penalty — all **rates and the compromise schedule stored in `TaxRuleSet`, none hardcoded**. Every output must be labelled *"Estimate for internal planning only — confirm against the assessment issued by BIR."*

---

## 4. Technical Stack

Chosen for a single local operator who is not a developer.

- **Next.js 15 (App Router) + TypeScript**, strict mode
- **SQLite via Prisma** — a single `data/app.db` file makes backup a copy-paste operation
- **Tailwind CSS + shadcn/ui**
- **Zod** for all input validation, shared between client and server
- **Luxon** for dates, pinned to `Asia/Manila`
- **Decimal.js for all money.** Store money as **integer centavos** in SQLite. Floating-point arithmetic on currency is forbidden anywhere in the codebase; add an ESLint rule or a code-review note.
- **Vitest** for the tax engine (non-negotiable — see §16)
- **exceljs** for XLSX import/export
- Documents on the **local filesystem** under `./storage`, never as DB blobs
- Auth: single password from `.env`, session cookie. Adequate for a local prototype; do not deploy to a public host without revisiting.

**Repo layout**
```
/app                  routes
/lib/tax/             computation engine — PURE FUNCTIONS, zero I/O
/lib/workflow/        step template + state machine
/lib/documents/       storage, naming, hashing
/lib/books/           journal + ledger generation
/prisma/schema.prisma
/prisma/seed.ts
/storage/             gitignored document vault
/data/                gitignored sqlite db
/tests/
```

`/lib/tax/` must have **no database imports**. It takes a plain input object and returns a plain result object. This is what makes it testable and auditable.

---

## 5. Data Model

Prisma schema. Money fields are `Int` (centavos) with a `Cents` type alias in TypeScript.

### Client
```
id, code (short slug, used in file paths)
registeredName, tradeName
tin (9 digits), branchCode (default "000")
rdoCode
registeredAddress, email, mobile
taxpayerType          enum: PURELY_SELF_EMPLOYED | MIXED_INCOME
lineOfBusiness, psicCode
civilStatus
booksType             enum: MANUAL | LOOSE_LEAF | CAS
booksRegistrationDate, booksPermitNumber
swornDeclarationOnFile boolean, swornDeclarationYear
eBIRFormsEmail, eFPSEnrolled boolean
defaultWithholdingRate
isActive, engagedSince, notes
```

### ClientTaxYear
One row per client per taxable year. **This is the anchor for annual state.**
```
clientId, taxableYear
regime                enum: RATE_8_PERCENT | GRADUATED_OSD | GRADUATED_ITEMIZED
electionStatus        enum: ELECTED | NOT_YET_ELECTED | DEFAULTED_GRADUATED
electionEvidenceDocId
priorYearExcessCreditCents
yearEndCreditElection enum: REFUND | TCC | CARRY_OVER | NA
thresholdBreachedAt   nullable
```

### SalesTransaction
```
id, clientId, transactionDate, taxableYear, quarter (derived, indexed)
orNumber (unique per client, nullable for non-OR receipts)
payorName, payorTin
grossAmountCents
withholdingTaxCents, withholdingRate      -- expected WHT at point of receipt
netReceivedCents                          -- derived; validate = gross - wht
incomeType            enum: OPERATING | NON_OPERATING
description
form2307Id            nullable FK
sourceDocumentId      nullable FK
importBatchId         nullable
createdAt, actorId
```
Index on `(clientId, taxableYear, quarter)` and `(clientId, transactionDate)`.

### Form2307
```
id, clientId, taxableYear
payorName, payorTin, payorAddress
periodFrom, periodTo, quarterCovered
atcCode, incomePaymentCents, taxWithheldCents, withholdingRate
dateReceived
status                enum (see §3.5)
documentId
claimedOnFilingId     nullable FK
sawtBatchId           nullable FK
notes
```

### Filing
One row per client per period per taxable year.
```
id, clientId, taxableYear, period    enum: Q1 | Q2 | Q3 | ANNUAL
formType              enum: F1701Q | F1701A | F1701
statutoryDueDate, adjustedDueDate     -- after holiday shift
status                enum: NOT_STARTED | IN_PROGRESS | WAITING_CLIENT
                          | WAITING_BIR | BLOCKED | COMPLETE | NA
requiresSawt          boolean, derived: any Form2307 in period
computationSnapshot   JSON   -- FROZEN at time of filing
filedAt, filingReferenceNumber
amountPaidCents, paymentDate, paymentChannel
receiptsAcknowledgedAt, receiptsAcknowledgedNote   -- step 3 prompt, added 2026-08-20 (§7.1)
notes
```

**`computationSnapshot` is immutable once `filedAt` is set.** If a transaction is later edited for a filed period, the system must **not** silently rewrite the snapshot. It raises an `AmendmentAlert` on the filing showing the delta between the frozen snapshot and the live recomputation, and I decide whether to amend. This is the single most important integrity rule in the system.

### WorkflowStep
```
id, filingId, stepCode, sequence, title, description
category              enum: PREP | FILING | PAYMENT | SAWT | ATTACHMENT | CLIENT_COMM
status                enum: PENDING | IN_PROGRESS | WAITING_EXTERNAL | DONE | SKIPPED | NA
isConditional         boolean, conditionExpression   -- e.g. "requiresSawt == true"
isWaitingState        boolean
expectedResponseDays  nullable int
waitingSince          nullable datetime
followUpCount         int
requiredDocSlots      JSON  -- [{slotCode, label, required, acceptedTypes}]
startedAt, completedAt, skippedReason, notes, actorId
```

### Document
```
id, clientId, filingId?, workflowStepId?, docSlotCode?, form2307Id?
category              enum
originalFilename, storedPath, mimeType, sizeBytes
sha256                -- duplicate detection
documentDate          -- date on the document, not upload date
uploadedAt, actorId, notes
```

### Supporting tables
`JournalEntry` + `JournalEntryLine` (for manual/adjusting entries and the General Journal), `ChartOfAccounts`, `Holiday`, `TaxRuleSet`, `AtcCode`, `SawtBatch`, `ActivityLog`, `ImportBatch`, `User`.

### ActivityLog
Append-only. Every create/update/delete of a Filing, WorkflowStep, Document, SalesTransaction, or Form2307 writes `{entityType, entityId, action, beforeJson, afterJson, actorId, at}`. Never hard-delete these records.

---

## 6. Tax Computation Engine

`/lib/tax/compute.ts` exposes:
```ts
computeFiling(input: FilingComputationInput): FilingComputationResult
```

**Input** (plain object, assembled by the caller): taxable year, period, taxpayer type, applicable `TaxRuleSet`, YTD operating and non-operating totals, YTD creditable withholding, prior-period payments, prior-year excess credit.

**Output**: every intermediate line item plus a `breakdown[]` array of `{label, amountCents, sourceNote}` so the UI can render a computation sheet that **shows its work line by line**. I need to be able to hand this to a client or defend it to an examiner. A bare total is not acceptable output.

### Worked examples — implement these as passing tests

**Example A — purely self-employed, 8%, all receipts subject to 5% CWT, TY2026**

| Period | Period receipts | Cumulative | Less ₱250K | × 8% | Cum. CWT | Prior payments | Payable |
|---|---|---|---|---|---|---|---|
| Q1 | 450,000 | 450,000 | 200,000 | 16,000 | 22,500 | 0 | **(6,500) overpayment → 0 due** |
| Q2 | 600,000 | 1,050,000 | 800,000 | 64,000 | 52,500 | 0 | **11,500** |
| Q3 | 500,000 | 1,550,000 | 1,300,000 | 104,000 | 77,500 | 11,500 | **15,000** |
| Annual | 550,000 | 2,100,000 | 1,850,000 | 148,000 | 105,000 | 26,500 | **16,500** |

Note how the Q1 overpayment is absorbed automatically by the cumulative mechanism — no manual carry-forward. Assert this explicitly.

**Example B — mixed income earner.** Gross business receipts ₱1,000,000, no ₱250,000 deduction → tax due ₱80,000. Assert `formType == F1701` for the annual period.

**Example C — below threshold.** Gross ₱200,000, CWT ₱10,000. Taxable base ₱0, tax due ₱0, overpayment ₱10,000. Assert the UI renders "Overpayment", never "-₱10,000 due".

**Example D — non-operating income.** Gross receipts ₱2,000,000 + non-operating ₱100,000 → both enter the base; assert cumulative gross ₱2,100,000.

**Example E — rounding.** Gross ₱333,333.33 → base ₱83,333.33 → tax ₱6,666.67. Assert half-up rounding to the centavo and that no floating-point drift appears across four cumulative periods.

---

## 7. Workflow Engine

### 7.1 Step template

Seeded as data in `WorkflowStepTemplate`, instantiated when a `Filing` is created. **Editable through the UI** — my process will change.

| # | Step code | Title | Category | Waiting? | Doc slots (R = required) |
|---|---|---|---|---|---|
| 1 | `RECEIVE_2307` | Receive Form 2307 from client | PREP | Client | 2307 scan (R, conditional) |
| 2 | `RECORD_CRJ` | Record transactions in Cash Receipts Journal | PREP | — | source ORs/invoices (optional) |
| 3 | `PREPARE_RETURN` | Prepare computation + 1701Q/1701A | PREP | — | draft computation sheet (R) |
| 4 | `ADVISE_CLIENT` | Advise client of tax payable | CLIENT_COMM | Client | advisory email/screenshot (R) |
| 5 | `FILE_RETURN` | File return via eBIRForms/eFPS | FILING | — | — |
| 6 | `SAVE_SUBMISSION_SS` | Save submission-page screenshot | FILING | — | screenshot (R) |
| 7 | `SAVE_FORM_COPY` | Download and save filed form | FILING | — | filed form PDF (R) |
| 8 | `MAKE_PAYMENT` | Make payment | PAYMENT | — | — |
| 9 | `SAVE_PROOF_PAYMENT` | Save proof of payment | PAYMENT | — | payment confirmation (R) |
| 10 | `RECEIVE_TRRC` | Receive & save BIR confirmation (TRRC) | FILING | **BIR** | TRRC email/PDF (R) |
| 11 | `ALPHALIST_ENTRY` | Alphalist data entry + validation | SAWT | — | generated report (R), DAT file (R) |
| 12 | `EMAIL_DAT` | Email DAT file to BIR eSubmission | SAWT | — | sent-email evidence (R) |
| 13 | `SAWT_ACK` | Receive & save acknowledgement email | SAWT | **BIR** | acknowledgement (R) |
| 14 | `SAWT_VALIDATION` | Receive & save validation email | SAWT | **BIR** | validation email (R) |
| 15 | `EAFS_SUBMIT` | Complete and submit eAFS | ATTACHMENT | — | eAFS confirmation (R) |
| 16 | `SEND_CLIENT_PACKAGE` | Email package to client | CLIENT_COMM | — | sent-email evidence (R) |

**Steps 11–14 are conditional** on `requiresSawt`. When false they are auto-set to `NA` and hidden from the active view — but remain visible in a "show skipped" toggle so nothing silently disappears.

**Step 3 (`PREPARE_RETURN`), added 2026-08-20:** since transaction entry is now driven by the client's 2307s (the 2307 is the source document for the transaction row, not an independent check on it — see the transaction-entry workflow change), the computation sheet can be internally consistent while still missing receipts that never had a 2307 in the first place. Step 3 therefore prompts: *"Have you confirmed with the client that all receipts for this quarter are accounted for, including any without a 2307?"* The acknowledgement is recorded on the `Filing` with a timestamp (`receiptsAcknowledgedAt`, `receiptsAcknowledgedNote`) — a one-time confirmation, not a per-transaction check, and not itself a doc slot.

Step 16's package contents (filed form, proof of payment, TRRC, validation email) are **assembled by the system from the documents already saved against steps 7, 9, 10, and 14**. If any is missing, step 16 cannot be marked DONE — it displays exactly which document is absent. This is the check that closes the loop on "what have I not saved yet."

### 7.2 Rules
- Steps are **ordered but not rigidly gated**. Warn on out-of-order completion; do not block. Real practice is messier than any template.
- A step with unfilled **required** doc slots cannot reach `DONE`. It can reach `WAITING_EXTERNAL` or stay `IN_PROGRESS`.
- Setting a waiting step to `WAITING_EXTERNAL` stamps `waitingSince`. Aging is computed from that stamp.
- **Aging thresholds** (per step, configurable — defaults): green < `expectedResponseDays`; amber at 1×; red at 2×. Red items surface at the top of the dashboard with a **"Log follow-up"** action that increments `followUpCount` and re-stamps the clock. Defaults: TRRC 3 days, SAWT acknowledgement 3 days, SAWT validation 10 days, client response 5 days.
- A step may be `SKIPPED` only with a written `skippedReason`. No silent skips.
- Filing status is **derived** from its steps, never set by hand:
  - all `DONE`/`NA` → `COMPLETE`
  - any `WAITING_EXTERNAL` on a BIR step → `WAITING_BIR`
  - any `WAITING_EXTERNAL` on a client step → `WAITING_CLIENT`
  - past `adjustedDueDate` and not complete → `BLOCKED` (rendered red)

---

## 8. Document Management

**Storage path**
```
/storage/{client.code}/{taxableYear}/{period}/{stepCode}__{slotCode}__{YYYYMMDD}__{seq}.{ext}
```
Example: `/storage/dela-cruz-j/2026/Q2/SAVE_PROOF_PAYMENT__proof__20260812__01.pdf`

- Original filename preserved in the DB and restored on download/export.
- SHA-256 on upload; warn on duplicates within the same client.
- **Bulk import of my existing folders:** point the tool at a directory, it lists files with a proposed `{client, year, period, step, slot}` mapping inferred from path and filename, I correct the mappings in a review grid, then confirm. **Never auto-file without my confirmation.**
- **Export:** "Download period package" → zip of all documents for a filing, in step order, with a manifest PDF listing every document, its slot, and its date — plus any slots still empty.
- Every document row has a `documentDate` distinct from `uploadedAt`. BIR emails arrive weeks late; the document's own date is what matters for the record.

---

## 9. Books of Accounts

Generate all four sets as printable, columnar reports with the taxpayer's registered name, TIN, and period in the header, page numbering, and a monthly totals line.

1. **Cash Receipts Journal** — primary book. Columns: date, OR no., payor, particulars, gross receipts, creditable withholding tax, cash received. Sourced from `SalesTransaction`.
2. **Cash Disbursements Journal** — sourced from `JournalEntry` lines flagged as disbursements. Under 8% no expense substantiation is required for the tax computation, but the book must still exist and be maintained. Keep entry lightweight: date, payee, particulars, amount, account.
3. **General Journal** — manual and adjusting entries.
4. **General Ledger** — posted from CRJ, CDJ, and GJ against a seeded `ChartOfAccounts`. Minimal chart: Cash, Accounts Receivable, Creditable Withholding Tax, Owner's Capital, Owner's Drawing, Service Income, and a small expense group.

Export as XLSX (for loose-leaf submission) and print-to-PDF-friendly HTML. Include a per-book "as of" lock so a printed period is not silently altered afterward — same amendment-alert pattern as §5.

---

## 10. SAWT / Alphalist Module

- Register all `Form2307` records for a period.
- **Reconciliation report, revised (2026-08-20):** with transaction entry driven by 2307s (§7.1 step 1 / the transaction record's `form2307Id`), "transaction CWT vs certificate CWT" is no longer a meaningful comparison — one derives from the other by construction, so a hand-entry-vs-hand-entry cross-check would just be comparing a number against itself. Replaced with three checks that catch real gaps instead:
  1. **Transactions with no linked `form2307Id`** — listed individually, with count and total. This is the real gap: a receipt that might be missing its certificate, or genuinely has none.
  2. **Certificates received for the period not yet converted into a transaction** — listed individually, with count and total.
  3. **Total CWT claimed on the filing vs. sum of certificates in the SAWT batch** — kept unchanged. Still a genuine cross-check against what actually gets filed, since the SAWT batch is an independent downstream artifact, not derived from the same entry action as the transaction.
- Produce a **keying worksheet** (screen + XLSX) with columns in the exact field order of the Alphalist Data Entry Module, so I can key it in quickly and check it off row by row. Include a running row count and total to verify against the module's own totals after entry.
- Track the batch through `Generated → Emailed → Acknowledged → Validated`, with a document slot at each stage, wired to steps 11–14.

---

## 11. Screens

1. **Dashboard (`/`)** — the answer to "where am I?"
   - Row 1: **Needs my action now** — steps assigned to me, sorted by adjusted due date
   - Row 2: **Waiting on BIR** — with aging badges, red first, each with a one-click "Log follow-up"
   - Row 3: **Waiting on client**
   - Row 4: **Upcoming deadlines**, next 45 days
   - Row 5: **Missing documents** across all in-progress filings, grouped by client
   - Row 6: threshold and election alerts
2. **Filing cycle board (`/filings`)** — kanban with columns = the 16 steps, cards = client-period. This is the visual "which process am I in" view. Filter by client, year, period, status.
3. **Client list / Client detail** — profile, tax years, filings timeline, transactions, 2307s, documents, books.
4. **Filing detail** — computation sheet (line-by-line breakdown), step checklist with inline upload per slot, document list, notes, amendment alerts.
5. **Transactions** — fast keyboard-first entry grid, inline edit, bulk import.
6. **2307 register.**
7. **Books** — select client, book, period → view/print/export.
8. **Calendar** — deadlines and expected BIR response dates.
9. **Settings** — tax rule sets, holidays, ATC codes, workflow template, chart of accounts, backup.

**Design note:** dense over pretty. This is a working tool. Status colours must be legible at a glance: grey pending, blue in progress, amber waiting, red overdue, green done. Every list view supports filtering by client and taxable year, and those filters persist across navigation.

---

## 12. Import / Export

- **Import:** XLSX/CSV of sales transactions. Column-mapping UI (my existing files differ per client — save a mapping profile per client and reuse it). Preview with per-row validation, reject-and-report on bad rows, all-or-nothing commit per batch, `ImportBatch` record with rollback.
- **Export:** any grid to XLSX; books to XLSX; filing package to zip; full database backup to a timestamped copy of the SQLite file plus a `storage/` archive, triggered from Settings.

---

## 13. Reminders

MVP is **in-app only** — no email/SMS infrastructure. Dashboard badges, aging colours, and an optional daily digest rendered on screen at login: what's due in 7 days, what's waiting past threshold, what's missing documents.

Phase 5 candidate (explicitly deferred): IMAP polling of my mailbox to auto-detect BIR acknowledgement/validation emails and attach them. Do not build in MVP.

---

## 14. Non-Functional

- **Data privacy:** this system holds TINs, addresses, and income data of real taxpayers, covered by the Data Privacy Act. Runs local. No third-party analytics, no telemetry, no external API calls at runtime. Do not add a CDN font, an error-reporting SDK, or any outbound request.
- **Backup:** one-click backup from Settings; on-screen reminder if the last backup is more than 7 days old.
- **Audit:** append-only `ActivityLog`; no hard deletes on financial records — soft-delete with reason.
- **Integrity:** money as integer centavos throughout; frozen computation snapshots; amendment alerts.
- **Performance:** target ~30 clients × 5 years — trivial for SQLite. Do not over-engineer for scale.
- **Seed data:** three fictitious clients across the full 2025 cycle — one purely self-employed with 2307s, one purely self-employed without, one mixed income — so every path is demonstrable on first run.

---

## 15. Build Phases

**Do not build ahead. Stop at the end of each phase for review.**

| Phase | Deliverable | Definition of done |
|---|---|---|
| **1** | Foundation | Schema, migrations, seed data, client CRUD, settings (rule sets, holidays), auth |
| **2** | Money in | Transaction entry + import, 2307 register, tax engine with **all §16 tests passing**, computation sheet |
| **3** | The point of the whole thing | Workflow engine, filing generation with correct deadlines, step board, document vault, dashboard |
| **4** | Compliance outputs | 4 books of accounts, SAWT module + reconciliation, exports, filing package zip |
| **5** | Deferred | Email integration, multi-user, .DAT generation — build nothing here without a new spec |

Phase 3 is the reason this system exists. If time is short, cut Phase 4 scope, not Phase 3.

---

## 16. Acceptance Tests

**Tax engine (Vitest, `/tests/tax/`) — these must pass before Phase 2 is accepted:**

1. Examples A–E from §6, exact to the centavo
2. ₱250,000 applied in full from Q1, not prorated per quarter
3. Mixed income: zero deduction, `formType == F1701`
4. Negative payable renders as overpayment, never negative tax due
5. Cumulative CWT never double-counts a certificate across periods
6. No Q4 `Filing` is ever generated
7. Prior-year carry-over credit appears in every cumulative period (Q1, Q2, Q3, ANNUAL) of the following year, not only the first — "once" means it is never double-counted against the same liability, not that it is applied in a single period
8. Rounding is stable across four cumulative periods (no float drift)

**Deadlines:**

9. A due date landing on a Sunday shifts to Monday
10. A due date landing on a seeded holiday shifts to the next working day
11. All computation is timezone-correct at 23:59 Asia/Manila on a due date

**Workflow:**

12. A filing with zero 2307s auto-marks steps 11–14 as `NA` and excludes them from progress %
13. A step with an empty required doc slot cannot be set `DONE`
14. `SEND_CLIENT_PACKAGE` blocks and names the specific missing document when any of steps 7/9/10/14 lacks its document
15. A step in `WAITING_EXTERNAL` for 2× its expected days appears in the dashboard red list
16. Editing a transaction in a filed period raises an `AmendmentAlert` and does **not** mutate `computationSnapshot`

**Documents:**

17. Upload writes to the exact §8 path and records SHA-256
18. Duplicate hash within a client triggers a warning, not a silent overwrite
19. Filing package zip contains every document plus a manifest listing empty slots

**End-to-end:**

20. Seeded client with 2307s can be driven from step 1 to step 16 with all documents attached and finishes at `COMPLETE`

---

## 17. Assumptions Requiring Confirmation

The agent must surface these in the UI as configurable settings rather than baking them in, and must not silently pick a side.

1. **Revenue recognition basis.** Assumed *collection* basis, consistent with maintaining a Cash Receipts Journal. Recent legislation has shifted services toward recognition on billing. Provide a per-client `recognitionBasis` toggle (`COLLECTION` | `BILLING`); if `BILLING`, additionally track billed-but-uncollected amounts. Default `COLLECTION` for now.
2. **eAFS on quarterly filings.** Step 15 is included for all periods per my current practice, but is marked skippable per filing.
3. **SAWT deadline offset.** Defaulted to the return deadline; configurable.
4. **.DAT file generation.** Out of scope — the module's format is proprietary and version-sensitive, and a malformed file gets rejected by BIR. Worksheet-assisted manual entry only.
5. **ATC codes.** Seeded sparse and unverified. I must confirm each against the current BIR list before first live use.
6. All computed figures are **preparation aids**. The filed return and BIR's own assessment govern. Every computation sheet must carry that statement in the footer.

*(Formerly item 1, "Q1 1701Q due date," is resolved: May 15, per §3.6 — TaxRuleSet remains the source of truth, so it stays configurable, but it is no longer an open question.)*
