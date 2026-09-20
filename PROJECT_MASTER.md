# PROJECT_MASTER.md

*Permanent project memory. Update only when something long-lived genuinely changes.*
*Last reconciled: 2026-09-20, evening.*

> Build status lives in `CURRENT_STATE.md`. This file is the **intended** application and the rules that govern it — including decisions (D25, D26) not yet implemented on `claude/laughing-darwin-wcnh8u`, the branch this file currently lives on. Where this file describes something as settled and `CURRENT_STATE.md` says it isn't built here, `CURRENT_STATE.md` is describing the code and this file is describing the target — both are correct, about different things. Read both.

---

## Application

**BIR 8% Freelancer Practice Manager**

A local-first web application used by one bookkeeper to manage Philippine tax compliance for freelance and professional clients who have elected the 8% income tax option.

## What kind of application this is

**A filing manager, not an accounting system.** The question "accounting system or workflow board?" was settled on 2026-09-20 by removing the Cash Receipts Journal from scope (D25). **This is a decision, not yet a fact in the code on every branch** — see `CURRENT_STATE.md`: `claude/laughing-darwin-wcnh8u` still generates the CRJ. The CRJ was the accounting leg; without it there is no ledger, only an income record sufficient to compute the return.

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

**Primary success metric:** a dashboard that makes "I'm lost as to which process I'm in" structurally impossible. *Met — the dashboard answers this for all three seeded clients at a glance.*

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
- Verified unaffected by every rework pass on every branch — this is the one part of the system no rework has touched.

### Income entry (D26) — **decided; built on `peaceful-goldberg` only, not on `laughing-darwin`**
- **Gross sales come from one place only: the client's declared figure for the quarter.** Certificates contribute nothing to it.
- **A 2307 is authoritative for the withholding and nothing else.** It reports what one payor paid and withheld, and only ever sees income from payors who are withholding agents. Income from non-withholding clients and direct consumers appears on no certificate. Some clients issue no 2307 at all and simply state a quarterly total.
- Income and credit are independent inputs, exactly as the 1701Q treats them.
- **`QuarterlySales.quarter` includes `Q4`; `Filing.period` does not.** There is no Q4 return — October–December income is picked up by the annual. Two types, two CHECK constraints. Do not merge them.
- Cumulative mapping: `Q1`→Q1; `Q2`→Q1+Q2; `Q3`→Q1+Q2+Q3; `ANNUAL`→Q1+Q2+Q3+Q4.
- A missing quarter is zero, and a filing with no recorded sales must **say so in words**. A silent `₱0.00` reads as a real answer and is not one. *(This last point is good practice regardless of which income model is running, and is worth applying even before `QuarterlySales` itself is built.)*
- **On `claude/laughing-darwin-wcnh8u` today, income is still entered as `SalesTransaction`** — via converting a Form 2307 or quick-entering a receipt with none. `QuarterlySales` does not exist there.

### Creditable withholding (Form 2307)
- Certificates are claimed in the period whose **`certificateCutoffDate`** they fall within, keyed on **`dateReceived`** — not on the period the income economically covers, and **not on period end**.
- `certificateCutoffDate` = manual override if set, else `filedAt` if filed, else today (Manila).
- **No amended returns.** Late-arriving certificates flow into the next open period.
- The only reconciliation *in the intended design*: certificate gross totals ≤ declared sales, **compared over the taxable year**, never per quarter. **On `laughing-darwin`, the reconciliation is still the original three checks** (unlinked transactions, unconverted certificates, CWT-vs-SAWT-batch variance) — see `lib/reconciliation.ts` and SPEC.md §10.

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
- Sixteen steps. Step 1 **Record quarterly sales**, step 2 **Receive Form 2307 from client** (D28). Steps 11–14 (SAWT) conditional on `requiresSawt`. **The step order and titles (D28) are built on `laughing-darwin`** — the step 1 link there goes to the existing `/clients/[id]/transactions` screen, not a new declared-sales entry form, since `QuarterlySales` isn't built there. On `peaceful-goldberg`, step 1 links to the newer `/clients/[id]/income`.
- Filing status is **derived** from its steps, never hand-set: all `DONE`/`NA`/`SKIPPED` → `COMPLETE`.
- **`SKIPPED` requires a written reason** and stays visibly distinct from `NA`.

### Blocking — the rule (D27) — **built on `laughing-darwin`**, verified against the tree

**The app blocks on documents it receives. It never asks the bookkeeper to prove she did something.**

| Category | Behaviour | Steps |
|---|---|---|
| Documents she **receives** from outside | Blocks `DONE` until attached | 6, 7, 9, 10, 11 (both slots), 13, 14 |
| Actions she **performs** elsewhere | No slot at all | 4, 12, 16 |
| A document delivered **to someone else** | Optional, hidden, never blocking | 15 only |

Step 15 (eAFS) is the documented exception: its confirmation goes to the client, not to her, and often never reaches her. Blocking would strand a filing on a file she cannot obtain. **Do not "fix" this inconsistency.**

**The election check is decided to be the one other hard block, but is only actually implemented on `peaceful-goldberg`** (`lib/workflow/election.ts`). On `laughing-darwin`, nothing enforces it — see `CURRENT_STATE.md`.

### Waiting (D29) — **built on `laughing-darwin`**
Marking a step `WAITING` blocks nothing, with one exception: **waiting at step 13 blocks step 14**, because a validation email cannot arrive before the acknowledgement it follows. One explicit dependency edge, never a general rule.

### Books of accounts (D25) — **decided; not built on `laughing-darwin`**
- **The intended design generates no books at all.** CRJ, CDJ, General Journal and General Ledger are meant to become entirely the client's responsibility.
- **As of this pass, `claude/laughing-darwin-wcnh8u` still generates the Cash Receipts Journal** (`lib/books/`, exported as XLSX via `exceljs`). This decision has not been carried out on that branch. Whether it should be — given that `laughing-darwin` doesn't have the declared-sales model D25's reasoning depends on — is part of the branch-consolidation question raised alongside `CURRENT_STATE.md`.
- Dropping the CRJ removes no obligation from the clients, whenever it happens.

## Key workflows

**Quarterly cycle, as intended:** record the client's declared quarterly sales → receive and register 2307s → prepare computation (the app files its own computation sheet) → advise client → file → save submission screenshot → save form → pay → save proof → wait for TRRC → *(if certificates)* alphalist entry → email DAT → wait for acknowledgement → wait for validation → eAFS → email package to client.

*On `laughing-darwin`, "record the client's declared quarterly sales" is still "enter or convert a `SalesTransaction`" — the step exists and is first in order (D28), but its content is the pre-rework entry screen.*

**Completeness check, as intended:** income is client-declared, so the real risk is income the bookkeeper never hears about. The `PREPARE_RETURN` acknowledgement records that the client confirmed all receipts are accounted for. **It is the only control in the system**, once income entry is declared-only. On `laughing-darwin`, where `SalesTransaction` still exists, the three-check reconciliation (SPEC.md §10) is a second, independent control that the intended design retires.

## Technology stack

Next.js 15 App Router · TypeScript strict · Prisma + SQLite (`data/app.db`) · Tailwind CSS (a small custom component set in `components/ui/`, not built on Radix despite `@radix-ui/*` being installed — see `CURRENT_STATE.md`) · Zod · Luxon pinned `Asia/Manila` · Decimal.js, money as integer centavos · Vitest · jszip · exceljs · Server Actions for CRUD · documents on the local filesystem under `./storage`

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
- **Output belongs inside the work it derives from, not ahead of it.** Two branches solved this differently: `peaceful-goldberg` added a next-action-line-plus-summary-strip component ahead of the checklist; `laughing-darwin` moved the computation sheet, cutoff control, and confirmation panel inside the steps they belong to (D30) without adding a new summary widget. Both satisfy the underlying rule; they are not the same implementation.
- **A document belongs to its step, not to the page** (D30). Anything belonging to a step renders inside that step's card.
- **Never expose a raw step code** (`PREPARE_RETURN`) in a user-facing label.

## Data status and security

- **No real client data is in the application today, on either branch.** The three clients are fictitious seed data. The Excel files remain the master for every live client. One real client's Q1 2026 figures are said to exist in `scripts/real-fixture.local.ts`, gitignored — not present in the `laughing-darwin` checkout used for this pass.
- **Real data enters at the live Q3 cycle** — certificates expected early November 2026, 1701Q due November 16. The Data Privacy Act (RA 10173) applies from that moment.
- **While the data is seeded, schema changes may be destructive and reseeding is free.** This licence expires when the live cycle begins.
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
8. Scope boundaries: no .DAT generation, no BIR API integration
9. Adding any new dependency
10. The four-layer separation — in particular that the computation layer is never authored
11. The blocking rule (D27), including the eAFS exception — built on `laughing-darwin`
12. The `Q4`-in-sales / no-`Q4`-in-filings distinction — the type distinction is decided; `QuarterlySales` itself is only built on `peaceful-goldberg`
13. The archive's independence from the database
14. **Which branch is canonical** — not yet decided; do not merge or move `origin/HEAD` without the bookkeeper's say-so
