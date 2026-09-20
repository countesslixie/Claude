# PROJECT_MASTER.md

*Permanent project memory. Update only when something long-lived genuinely changes.*
*Last reconciled: 2026-09-20, evening — branch reconciliation pass (brief #3).*

> Build status lives in CURRENT_STATE.md. This file is the intended application and the rules that govern it.

---

## Application

**BIR 8% Freelancer Practice Manager**

A local-first web application used by one bookkeeper to manage Philippine tax compliance for freelance and professional clients who have elected the 8% income tax option.

## What kind of application this is

**A filing manager, not an accounting system.** The question "accounting system or workflow board?" was settled on 2026-09-20 by removing the Cash Receipts Journal from scope (D25). The CRJ was the accounting leg; without it there is no ledger, only an income record sufficient to compute the return.

Four layers, with a strict rule about who authors what:

| Layer | Authored? | Role |
|---|---|---|
| Income record | Yes | One declared gross-sales figure per client per quarter. The only place money enters. |
| Computation | **Never** | Pure derivation. 8% cumulative. |
| Checklist | Marks only | A map of where you are. Blocks only on documents received from outside. |
| Document archive | Yes | Independently browsable. For a declared-income client, substantially the whole record. |

The hybrid is coherent because all four share one key: **client × taxable year × period**. That shared coordinate makes this one record with four faces rather than three applications stapled together.

**The Trello resemblance, bounded.** Take the legibility, refuse the flexibility. The filing cycle is identical every quarter for every client. No card creation, no custom steps, no drag-to-reorder, no board configuration. It is a flight checklist instantiated from a fixed template.

## Purpose

Track the full BIR filing cycle for each client and period, compute the tax, and hold every supporting document in one place so it can be retrieved years later.

## Business problem

Under the 8% regime the arithmetic is simple — only gross receipts are taxed. **The compliance choreography is not.** Each cycle runs sixteen steps, several of which stall for weeks waiting on BIR email responses.

Before this system the work lived across scattered per-client Excel files and folders, and weeks would pass without the bookkeeper being able to say which step a client was on.

**Primary success metric:** a dashboard that makes "I'm lost as to which process I'm in" structurally impossible. *Met — the dashboard answers this for all three clients at a glance.*

## Intended users

One bookkeeper, alone, on a single laptop. Not deployed. Not client-facing.

## Business rules that matter most

### Tax computation (8% regime)
- Computed **cumulatively year-to-date** for every period.
- `taxableBase = MAX(0, cumulativeGross − allowableDeduction)`; `incomeTaxDue = taxableBase × 8%`.
- `allowableDeduction` = ₱250,000 for `PURELY_SELF_EMPLOYED`, ₱0 for `MIXED_INCOME`.
- The ₱250,000 is applied **in full from Q1 onward**, never prorated.
- `taxPayable = incomeTaxDue − cumulativeCWT − priorPeriodPayments − priorYearExcessCredit`.
- `priorPeriodPayments` means amounts **actually remitted**, never computed liabilities.
- Negative result = **overpayment**; never rendered as negative tax due.
- **Prior-year excess credit appears in every cumulative period**, not only the first.
- Mixed income earners file **1701**, not 1701A.

### Income entry (D26)
- **Gross sales come from one place only: the client's declared figure for the quarter.** Certificates contribute nothing to it.
- **A 2307 is authoritative for the withholding and nothing else.** It reports what one payor paid and withheld, and only ever sees income from payors who are withholding agents. Income from non-withholding clients and direct consumers appears on no certificate. Some clients issue no 2307 at all and simply state a quarterly total.
- Income and credit are independent inputs, exactly as the 1701Q treats them.
- **`QuarterlySales.quarter` includes `Q4`; `Filing.period` does not.** There is no Q4 return — October–December income is picked up by the annual. Two types, two CHECK constraints. Do not merge them.
- Cumulative mapping: `Q1`→Q1; `Q2`→Q1+Q2; `Q3`→Q1+Q2+Q3; `ANNUAL`→Q1+Q2+Q3+Q4.
- A missing quarter is zero. A filing whose **own** quarter has no declared-sales row must **say so in words**, distinct from a cumulative total that happens to be zero from earlier quarters — a silent `₱0.00` reads as a real answer and it is not one.

### The `PREPARE_RETURN` acknowledgement — the only control in the system

Once income is declared-only, nothing in the system can be cross-checked against anything: the client's stated quarterly figure IS the income record, and the only surviving reconciliation (below) is annual and against certificates, not against the sales figure's own source. The acknowledgement at step 3 closes that gap the only way it can be closed for a self-reported number: by recording, in the bookkeeper's own words, **where the figure came from** (a required text field — "client's own summary, texted Sept 14," or similar) and giving her an **optional** place to attach the client's own confirming message or email, if one exists.

This is deliberately different in kind from the actions-she-performs slots D27 removed. The `advisory_evidence` slot she rejected asked her to prove she had *done* something (advised the client) — proof of her own work. This field records the *provenance of a number she is about to file* — evidence of the fact the number is based on, not evidence that she did her job. It must never block: some clients never send anything in writing at all, and stranding a filing on that would recreate exactly the demand-for-proof pattern D27 was written to eliminate.

### Creditable withholding (Form 2307)
- Certificates are claimed in the period whose **`certificateCutoffDate`** they fall within, keyed on **`dateReceived`** — not on the period the income economically covers, and **not on period end**.
- `certificateCutoffDate` = manual override if set, else `filedAt` if filed, else today (Manila).
- **No amended returns.** Late-arriving certificates flow into the next open period.
- The only reconciliation: certificate gross totals ≤ declared sales, **compared over the taxable year**, never per quarter — the cutoff rule deliberately shifts credits across quarter boundaries.

### Deadlines
- 1701Q: Q1 **May 15**, Q2 **Aug 15**, Q3 **Nov 15**. Annual: **Apr 15**.
- **There is no Q4 return.**
- Weekend/holiday due dates shift to the next working day via an editable `Holiday` table.
- eAFS = `adjustedDueDate + 15 days`, business-day shifted. Filing early does not move it earlier.
- Period boundaries: Q1 Jan 1–Mar 31, Q2 Apr 1–Jun 30, Q3 Jul 1–Sep 30, ANNUAL Jan 1–Dec 31.

### Working calendar (distinct from statutory deadlines)
- `certificatesExpectedBy` — when the client is expected to hand over 2307s.
- `internalFilingTarget` — quarterly: **equals the adjusted due date, no buffer by design**. Annual: **Mar 31**.

### Threshold
- VAT threshold ₱3,000,000. Warn at 80%, 95%, breach. **Flag only — never auto-compute a transition.**

### Workflow
- Sixteen steps. Step 1 **Record quarterly sales** (links to `/clients/[id]/income`), step 2 **Receive Form 2307 from client** (D28). Steps 11–14 (SAWT) conditional on `requiresSawt`.
- Filing status is **derived** from its steps, never hand-set: all `DONE`/`NA`/`SKIPPED` → `COMPLETE`.
- **`SKIPPED` requires a written reason** and stays visibly distinct from `NA`.

### Blocking — the rule (D27)

**The app blocks on documents it receives. It never asks the bookkeeper to prove she did something.**

| Category | Behaviour | Steps |
|---|---|---|
| Documents she **receives** from outside | Blocks `DONE` until attached | 6, 7, 9, 10, 11 (both slots), 13, 14 |
| Actions she **performs** elsewhere | No slot at all | 4, 12, 16 |
| A document delivered **to someone else** | Optional, hidden, never blocking | 15 only |

Step 15 (eAFS) is the documented exception: its confirmation goes to the client, not to her, and often never reaches her. Blocking would strand a filing on a file she cannot obtain. **Do not "fix" this inconsistency.**

**Step 16's conditional line.** The client email draft (`lib/workflow/clientPackageEmail.ts`) asks the client to forward the eAFS confirmation, but *only* when step 15's optional slot is still empty — the moment she's writing to that client anyway is the natural (and only) point in the cycle to ask for a document addressed to him rather than to her. Once the confirmation is on file, the line drops out and the package's contents list includes it directly instead.

The **election check is the one other hard block** and is unaffected — it guards a wrong tax rate, not a missing file.

### Waiting (D29)
Marking a step `WAITING` blocks nothing, with one exception: **waiting at step 13 blocks step 14**, because a validation email cannot arrive before the acknowledgement it follows. One explicit dependency edge, never a general rule.

### Books of accounts
- **This system generates no books at all** (D25). CRJ, CDJ, General Journal and General Ledger are the client's responsibility.
- Dropping the CRJ removes no obligation from the clients.

## Key workflows

**Quarterly cycle:** record the client's declared quarterly sales → receive and register 2307s → prepare computation (the app files its own computation sheet) → advise client → file → save submission screenshot → save form → pay → save proof → wait for TRRC → *(if certificates)* alphalist entry → email DAT → wait for acknowledgement → wait for validation → eAFS → email package to client.

**Completeness check:** income is client-declared, so the real risk is income the bookkeeper never hears about. The `PREPARE_RETURN` acknowledgement records that the client confirmed all receipts are accounted for, along with where the declared figure came from. **It is the only control in the system.**

## Technology stack

Next.js 15 App Router · TypeScript strict · Prisma + SQLite (`data/app.db`) · Tailwind CSS (a small custom component set in `components/ui/`, not built on Radix despite `@radix-ui/*` being installed unused) · Zod · Luxon pinned `Asia/Manila` · Decimal.js, money as integer centavos · Vitest · jszip · exceljs (SAWT keying worksheet export) · Server Actions for CRUD · documents on the local filesystem under `./storage`

## Storage architecture

- `data/app.db` — SQLite, everything relational
- `./storage/{client.code}/{taxableYear}/{period}/{stepCode}__{slotCode}__{YYYYMMDD}__{seq}.{ext}` — never DB blobs, SHA-256 on upload
- Both gitignored. `ActivityLog` append-only; no hard deletes on financial records.

**The archive must survive the application.** The folder tree plus a manifest is a complete, defensible record even if this codebase never runs again. The database is an index over it, not its container.

## Integrations

**None, by design.** There is no public BIR API. Every BIR interaction stays manual — the system tracks and stores, it does not transmit. Do not scaffold fake integrations.

## UI principles

- Centered container ~1100px. Tables with aligned columns, not edge-pinned cards. Row text 14px, secondary 13px. Empty panels collapse to one muted line. Rows navigate to detail. Filters persist across navigation.
- Status colours: grey pending, blue in progress, amber waiting, red overdue, green done.
- **Density is not the goal; being operable is.** "Dense over pretty" was read too literally and produced a first test drive that stopped at step 4.
- **The page leads with the work, not the output, two ways at once.** A next-action line and summary strip sit at the top of the filing page, answering "what do I do now" without a scroll — the first test drive's specific complaint ("I don't know what to do with it... I realized I need to scroll down"). Separately, the computation sheet, certificate cutoff, and client-confirmation panel live inside the step cards they belong to rather than as page-level panels at the bottom — the second test drive's complaint ("not sure what the bottom boxes are for"). These are two different fixes for two different findings; keep both.
- **A document belongs to its step, not to the page** (D30). Anything belonging to a step renders inside that step's card.
- **Never expose a raw step code** (`PREPARE_RETURN`) in a user-facing label.

## Data status and security

- **No real client data is in the application today.** The three clients are fictitious seed data. The Excel files remain the master for every live client. One real client's Q1 2026 figures exist only in `scripts/real-fixture.local.ts`, gitignored, never pushed.
- **Real data enters at the live Q3 cycle** — certificates expected early November 2026, 1701Q due November 16. The Data Privacy Act (RA 10173) applies from that moment.
- **While the data is seeded, schema changes may be destructive and reseeding is free.** No migration path needs preserving. This licence expires when the live cycle begins.
- Runs local only. No analytics, telemetry, error SDKs, CDN fonts, or outbound runtime requests.
- Auth is a single `.env` password — adequate for localhost, nothing more.
- `data/app.db` has no backup. Housekeeping now; a genuine single point of failure the day live data is entered. **Solve before November.**

## Do not change without discussing first

1. The 8% formula, the ₱250,000 rule, the cumulative approach
2. The CWT cutoff rule (`dateReceived` against `certificateCutoffDate`)
3. `computationSnapshot` immutability and the `AmendmentAlert` pattern
4. Money as integer centavos; no float arithmetic anywhere
5. Rates, thresholds and deadlines living in `TaxRuleSet`, never hardcoded
6. `/lib/tax/` purity — no database or I/O imports
7. The decision not to deploy, and the no-outbound-requests rule
8. Scope boundaries: no .DAT generation, **no books of accounts at all**, no BIR API integration
9. Adding any new dependency
10. The four-layer separation — in particular that the computation layer is never authored
11. The blocking rule (D27), including the eAFS exception and step 16's conditional forwarding line
12. The `Q4`-in-sales / no-`Q4`-in-filings distinction
13. The archive's independence from the database
14. The `PREPARE_RETURN` source-of-figure field — required text, optional attachment, never blocking
