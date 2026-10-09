# PROJECT_MASTER.md

*Permanent project memory: the intended application and the rules that govern it, stated as they stand today. History lives in DECISIONS.md; build status in CURRENT_STATE.md. Decision numbers in brackets trace each rule.*
*Last reconciled: 2026-10-09 — brief #6k (D181: BIR Logins as a table, ORUS added, Notes and Copy removed), on top of brief #6j (D180: the BIR Logins page under Settings), on top of brief #6i (D179: the Starting figures page heading on two lines, no grey explanation paragraph), on top of brief #6h (D174–D178: the bordered button's edge, every database page always-dynamic, the backup time recorded reliably, tests on their own database and storage, the clean start), on top of brief #6g (D170–D173), on top of brief #6f (D166–D169), on top of brief #6e (D162–D165), on top of brief #6d (D155–D161), on top of brief #6c (D151–D154: the Complete lock, step 2 starting open, the client page), brief #6b (D143–D150) and brief #6a's documentation pass (checked against the tree at brief #5z's tip `e761a74`, covering D115–D142).*

---


## Application

**BIR 8% Freelancer Practice Manager** — on screen (the left-side menu, D58) it reads **"BIR Filing Manager"**, subtitled **"8% Tax Rate."**

A local-first web application used by one bookkeeper to manage Philippine tax compliance for freelance and professional clients on the 8% income tax option. **Every client is treated as 8% elected: there is no election and no regime to record or check (D136/D142).**

## What kind of application this is

**A filing manager, not an accounting system.** The question "accounting system or workflow board?" was settled on 2026-09-20 by removing the Cash Receipts Journal from scope (D25). The CRJ was the accounting leg; without it there is no ledger, only an income record sufficient to compute the return.

Four layers, with a strict rule about who authors what:

| Layer | Authored? | Role |
|---|---|---|
| Income record | Yes | The client's declared gross sales per quarter — the sum of per-payor rows, derived, never typed directly (D33; called "Payor" on screen, D48 — the underlying `QuarterlySalesCustomer` model and `customerName` field keep their original names, deliberately). The only place money enters. |
| Computation | **Never** | Pure derivation. 8% cumulative. |
| Checklist | Marks only | A map of where you are. Blocks only on documents received from outside (D27). |
| Document archive | Yes | Independently browsable. For a declared-income client, substantially the whole record. |

The hybrid is coherent because all four share one key: **client × taxable year × period**. That shared coordinate makes this one record with four faces rather than three applications stapled together.

**The Trello resemblance, bounded.** Take the legibility, refuse the flexibility. The filing cycle is identical every quarter for every client. No card creation, no custom steps, no drag-to-reorder, no board configuration. It is a flight checklist instantiated from a fixed template.

## Purpose

Track the full BIR filing cycle for each client and period, compute the tax, and hold every supporting document in one place so it can be retrieved years later.

## Business problem

Under the 8% regime the arithmetic is simple — only gross receipts are taxed. **The compliance choreography is not.** Each cycle runs sixteen steps, several of which stall for weeks waiting on BIR email responses.

Before this system the work lived across scattered per-client Excel files and folders, and weeks would pass without the bookkeeper being able to say which step a client was on.

**Primary success metric:** a dashboard that makes "I'm lost as to which process I'm in" structurally impossible. *Met — the dashboard answers this for every client at a glance.*

## Intended users

One bookkeeper, alone, on a single laptop. Not deployed. Not client-facing.

## Business rules that matter most

### Tax computation (8% regime)
- Computed **cumulatively year-to-date** for every period.
- `taxableBase = MAX(0, cumulativeGross − allowableDeduction)`; `incomeTaxDue = taxableBase × 8%`.
- `allowableDeduction` = ₱250,000 for `PURELY_SELF_EMPLOYED`, ₱0 for `MIXED_INCOME`, applied **in full from Q1**, never prorated.
- `taxPayable = incomeTaxDue − cumulativeCWT − priorPeriodPayments − priorYearExcessCredit − otherCredits`; `priorPeriodPayments` means amounts **actually remitted** (`Filing.amountPaidCents`, D75), never computed liabilities.
- A negative result is an **overpayment**, never a negative tax due; on the computation sheet's final row it reads "(₱X) … — overpayment" (D59).
- **Prior-year excess credit appears in every cumulative period**, not only the first (D12).
- Mixed income earners file **1701**, not 1701A.
- **The sheet follows the BIR form's own line items and whole-peso rounding (D49, her decision).** `computeQuarterlyForm` (1701Q, items 47–58, 61–63) and `computeAnnualForm` (1701A column A) round half-up to the whole peso at exactly the items eBIRForms rounds; money is still stored as integer centavos. **Only the 1701Q and 1701A are built this way** — `MIXED_INCOME`'s Form 1701 has no sheet and stays on the old unrounded `computeFiling`. The VAT threshold monitor and the annual certificates-vs-sales check still compare unrounded figures.
- **A filed return is frozen (D6, D83).** Marking step 5 Done writes the full computation to `Filing.computationSnapshot` in the same transaction; it is never rewritten. Every reader of a filing's own figures uses it. If a later change would make a live recomputation differ, an `AmendmentAlert` is raised (informational — D11). **Later returns still read real data:** Q3's item 56 is Q1 and Q2's actual payments, not their snapshots.

### Income entry (D26, D33)
- **Gross sales come from one place only: the client's declared figure for the quarter.** Certificates contribute nothing to it.
- **A quarter's declared figure is the sum of per-customer rows** (name + amount, added and removed freely); `QuarterlySales.grossSalesCents` is derived on every save, never typed. `/lib/tax/` receives one summed gross figure per quarter.
- **A 2307 is authoritative for the withholding and nothing else.** It sees only income from withholding agents; income from other clients and direct consumers appears on no certificate, and some clients issue none.
- Income and credit are independent inputs, exactly as the 1701Q treats them.
- **`QuarterlySales.quarter` includes `Q4`; `Filing.period` does not.** There is no Q4 return — October–December income is picked up by the annual. Two types, two CHECK constraints; do not merge them.
- Cumulative mapping: `Q1`→Q1; `Q2`→Q1+Q2; `Q3`→Q1+Q2+Q3; `ANNUAL`→Q1+Q2+Q3+Q4. A missing quarter is zero; a filing whose **own** quarter has no row must **say so in words**, never a silent `₱0.00`.
- **"No sales this quarter" is a deliberate ₱0** (`noSalesThisQuarter`), distinct from no row at all.
- **Draft vs. Save, and Edit (D33/D40):** a draft stores the rows without completing step 1; a final Save does both. A final quarter opens read-only with Edit/Cancel; saving an edited final quarter as a draft reverts step 1 to open. A quarter stays editable until its own filing's step 5 is Done. A final Save returns to the filing page; a draft stays on the income page.

### There is no control over a declared income figure — say so plainly
The client's stated quarterly figure IS the income record and is accepted as given (D37). The per-quarter Notes field is free text, not a control. The only reconciliation left is the annual certificates-vs-declared-sales check, which only catches certificates that, summed, exceed what was declared.

### The client record (D145–D147)
- **Every client is purely self-employed** — the ₱250,000 deduction and the 1701A. The form doesn't ask for taxpayer type, recognition basis, civil status, default WHT rate or books details; the columns are kept and new clients get fixed values (`PURELY_SELF_EMPLOYED`, `COLLECTION`, manual books). Editing never changes them.
- **Birthday is required** (New and Edit), stored as a Manila calendar date, shown as "January 5, 1990".
- **Client code** is suggested from the registered name on New client (last word + "-" + first word, lowercased, accents and punctuation removed) and is otherwise an ordinary field validated as before; Edit never auto-fills it.
- **The Clients list** shows Code · Registered name · TIN · RDO · Status, centred.
- **The client page (D154):** after the header row, two same-height cards side by side (stacked on a narrow window) — Registration (TIN · Branch code · RDO code; Trade name; Registered address; Birthday · Client code) and Contact & business (Email · Mobile phone number; Line of business · PSIC code; Engaged since · Notes) — then Taxable years and Filings. Taxpayer type, civil status, default WHT rate, revenue recognition and Books & compliance are not shown (columns kept). Engaged since, Active and Notes stay at the bottom of the form (D151).

### Starting figures for a client joining mid-year (D56)
Every current client's Q1 and Q2 2026 were filed from Excel, so at go-live each joins mid-year. `StartingFigures` (one row per client-year) holds `latestOutsideReturn` (`NONE`/`Q1`/`Q2`/`Q3`) and the figures typed once from that outside return: items 55, 51, 57, 58, 56, the amount paid on it, item 61 with a description, and optional non-operating income (which can't exceed cumulative income). Read-only after Save with Edit; locked once the year's first in-app return is filed.

A period `latestOutsideReturn` names as filed gets **no `Filing` row at all** — that absence is what keeps it off the board, the dashboard and every overdue check. `Filing.filedOutsideApp` covers the rarer row that already existed; it renders as "Filed outside the app". Saving starting figures reclassifies existing rows and reopens inheriting filings; it does not create a newly-inside period's row (re-run Generate).

**Order for a new client: add the client → add the tax year → starting figures → generate filings — and the app enforces it (D78).** Generate refuses, before creating anything, when the client's `engagedSince` is inside the year after January 1, at least one quarter had already ended before that date, and no starting-figures row exists; the message names the client, date and quarters and links to the screen. Starting figures remain the only thing that decides which quarters were filed outside the app; **`engagedSince` never excludes a quarter itself.** Any saved row, including "none", satisfies the guard. Clients engaged on or before January 1, with no date, or (say) February 10 (no quarter had ended) are unaffected.

### Credits: items 55, 56 and 61 (D55, D75)
- **Item 61 (1701Q) / 63 (1701A) is one figure per return** (`Filing.otherCreditsCents`/`otherCreditsDescription`), inheriting the previous return's value (or the starting figures') until saved; locked once that return's step 5 is Done. A saved change reopens this filing and later ones still inheriting.
- **Item 55 (1701Q) / 57 (1701A) — prior year's excess credit — is display-only on step 3**, entered once in the starting figures; it appears in full on every return of the year (D12). Automatic carry-over of a client's *own* Annual overpayment into the next year's starting figure is **not built** (first matters at 2026→2027).
- **Item 56 (1701Q) / 58 (1701A) — payments for earlier quarters — is real**: the sum of `Filing.amountPaidCents` on this year's earlier in-app returns (written by step 8's save, D75) plus the starting figures' base. A payment is editable until the NEXT return of the year is filed (D75/D94).

### Creditable withholding (Form 2307)
- **A certificate counts in the filing whose step 2 it was entered under (D34)**; `Form2307.claimedOnFilingId` is set once and never reassigned. Its list is locked once that filing's step 5 is Done; a late certificate goes under the next open filing. No amended returns (D11) is what makes this safe.
- **Step 2 always starts open (D152):** every client's step 2 is generated Waiting on client, never Skipped, whatever the client's default WHT rate (which nothing reads any more); she clicks Skip herself when a client has no certificates that quarter (no typed reason; it reads "No Form 2307 received from this client.", D157). Filings generated before D152 are left as they are.
- **Step 2's checkbox appears only once a certificate row exists (D39);** with none, step 2 offers Add certificate and Skip. **Add/Remove are hidden while "all received" is ticked** (D47, enforced server-side).
- Cumulative crediting: a certificate claimed on period P counts toward P and every later period of the year.
- **Required fields (D45):** payor name, TIN, address, ATC code, income, tax withheld, period covered, validated server-side. **The ATC code is a picker of maintained `AtcCode` rows and the rate comes from it (D43); there is no Rate field on the certificate form (D132)** — the chosen code's rate is saved with the certificate, and tax withheld is typed and summed as given. The form's layout is fixed (D131): payor name · payor address · TIN + ATC code · income + tax withheld · period from + to · scan. **There is no scan date either — the upload day is recorded (D122).** Never invent a code or a rate (D19). **The ATC form has no Payee type (new codes save Individual) and no verified checkbox; the app shows no verified/unverified state anywhere — checking a code against the current BIR list is her job, outside the app (D164/D165).**
- **The scan is part of saving a certificate (D46):** none can be created without one; the only scan action afterward is a one-for-one Replace (old scan soft-deleted).
- **"Payors" (D44/D48):** a saved per-client list (name, TIN, address, usual ATC, active flag) shared by step 1's and step 2's payor fields. Picking an entry fills only that row/certificate. **No foreign key from `QuarterlySalesCustomer` or `Form2307` to `Payor`, ever.** "Save … to payors" opens a dialog (native `<dialog>`); a certificate can offer to fill a blank payor field back (`fillPayorDetail`), never overwriting one.
- The only reconciliation: certificate totals ≤ declared sales, **compared over the taxable year**.
- The SAWT keying worksheet (`lib/sawt/`) sorts by payor name, TIN as tie-breaker (D38).

### Deadlines
- 1701Q: Q1 **May 15**, Q2 **Aug 15**, Q3 **Nov 15**. Annual: **Apr 15**. **There is no Q4 return.**
- Weekend/holiday due dates shift to the next working day via an editable `Holiday` table.
- eAFS = `adjustedDueDate + 15 days`, business-day shifted; filing early does not move it earlier.
- Period boundaries: Q1 Jan 1–Mar 31, Q2 Apr 1–Jun 30, Q3 Jul 1–Sep 30, ANNUAL Jan 1–Dec 31.

### Working calendar (distinct from statutory deadlines)
`certificatesExpectedBy` — **the client's document deadline (D106)**, from her engagement letter: the 20th of the month after the period ends (Q1 Apr 20, Q2 Jul 20, Q3 Oct 20, Annual Jan 20 of the next year). The day comes from `TaxRuleSet.clientDocsDueDay` (default 20), with no weekend or holiday shift, and it is what the client's email asks for ("Please send required documents by …"), what starts step 2's waiting clock, and what the dashboard's step 2 dates build on. The field keeps its old name; on screen it reads "documents due from client". `internalFilingTarget` — her own filing target, unrelated: quarterly equals the adjusted due date, no buffer by design; Annual: Mar 31.

### Threshold
VAT threshold ₱3,000,000 (includes starting income, D56). The dashboard's **"3M Threshold Alert" (D137)** lists a client at **80% or more** and says **BREACHED at 100% or more** — there is no 95% step (the earlier "80%, 95%, breach" was the original design and was never built that way). **Flag only — never auto-compute a transition.**

## Workflow

Sixteen steps in six groups, instantiated per filing from a fixed template. **The step-by-step table — group, controls, unlock, completion, auto-wait, NA — lives once, in CURRENT_STATE.md's "How each group works today"**, so this file states the rules and that table states the steps.

### Groups (D70)

| Group | Steps |
|---|---|
| 1 Prepare | 1 Record quarterly sales · 2 Receive Form 2307 from client · 3 Prepare computation · 4 Advise client |
| 2 File | 5 File return via eBIRForms · 6 Save submission-page screenshot · 7 Save filed form |
| 3 Pay | 8 Make payment · 9 Save proof of payment |
| 4 eAFS | 11 Alphalist data entry + validation · 12 Email DAT file to BIR eSubmission · 13 Save SAWT acknowledgement email (D96) · 15 Complete and submit eAFS |
| 5 BIR Confirmations | 10 Save TRRC email (D90) · 14 Save SAWT validation email (D96) |
| 6 Client package | 16 Email package to client |

Steps 13 and 14 carry the titles "Save SAWT acknowledgement email" and "Save SAWT validation email" (D96, built brief #5q); the BIR short names read "SAWT validation" on the board and in headers.

- **Why six (D70).** The TRRC (10) and the validation email (14) are the only things she just WAITS to receive from BIR, and nothing downstream depends on either (D29). Inside File and SAWT they made finished work look unfinished; in their own group, every other group is entirely her own work. "eAFS" is her own name for group 4 though it holds the SAWT steps; she declined renaming it.
- **Step numbers are never renumbered to make groups contiguous (D70).** Numbers record when things happen, groups record what they belong to. A filing sitting at BIR Confirmations after every other group is done is normal and raises no warning.
- **Group membership is a fixed lookup (`lib/workflow/groups.ts`), not `category` repurposed.**
- **A group has no "Mark done" (D62).** It finishes when its own steps do; the header shows Pending (tooltip names the open steps) or Done. The counter counts Done + Skipped, excludes NA, is hidden when every step is NA, and never shows a skipped count (D60/D81/D124). Every header is two fixed columns — status pill, then Expand/Collapse — shared with the tax payable line (D116).
- **Header text names only steps actually waiting, with fixed plain names (D73);** a group whose every step is NA has no Expand, just its note (D91), beside a **grey "Not applicable" pill, never a green Done**: Pay "Nothing to pay — overpayment ₱X" (D76/D81/D135); eAFS "No Form 2307" (D93/D134), which reads a grey "Pending" until step 2 is Done or Skipped.
- **Filing status is derived** from its steps, never hand-set: all `DONE`/`NA`/`SKIPPED` → `COMPLETE` (past due and incomplete reads Blocked).
- **`SKIPPED` requires a written reason, stays visible in its group in step order, and can be undone (D60);** in practice **only step 2** offers Skip — steps 1 and 4 are refused Start and Skip server-side (D98), step 3 too (D54), and steps 5–16 are refused server-side (step 16: D101).
- **The "waiting on …" label shows only for a step actually waiting now (D52).**

### Per-step behaviour that is a rule
- **Steps 1 and 2 are self-completing (D33/D35).** Step 1 is Done on a final Save of the quarter; step 2 once "all received" is ticked and every certificate has its scan.
- **Step 3 cannot be started or skipped (D54)** — Mark done only, gated on steps 1 and 2 resolved (server-side). **Step 4 is Mark done only, gated on step 3 Done (D51), and cannot be started or skipped (D98);** its message (three versions) is saved as sent when marked Done. The payable version asks when she plans to pay and offers no advance (D107); every version that has a summary prints the year-to-date lines shared with step 16 (D114).
- **Steps 5–16 have no Start and no Skip (D65/D75/D86–D89/D101), enforced server-side.** Step 5 is Mark done only and has **two locks (D100, D95):** all of Prepare must be resolved first ("Finish Prepare first."), and every earlier quarter of the year must be filed ("File Q1 2026 first."; quarters filed outside the app count). There is no election check (D136).
- **Steps 6, 7, 9, 10, 11, 13 and 14 are self-completing behind a lock (D67/D71/D75/D86/D88):** upload box shown directly once the gating step is Done; the upload completes the step; a new upload is a one-for-one Replace; the lock is enforced in `saveDocumentForStep`. Step 11 has two required files and completes only when both are present (D86).
- **Steps 10, 13 and 14 wait on BIR automatically (D68/D71/D88):** the moment step 5 (for 10), 12 (for 13) or 13 (for 14) is Done, the step moves to Waiting with `waitingSince` set to that instant; removing the only file returns it to Waiting, the clock reset to the gating step's `completedAt`. No manual Mark waiting, and **no Log follow-up on any BIR wait (D72)**. One "Waiting on BIR · N days" pill (days are always spelled out, D117): amber, red past twice the expected days, never green. Step 13 blocks step 14 (D29) — one explicit edge, never generalised.
- **Pay opens only once all of File is Done (D75).** Step 8 collects amount paid (defaulting to the frozen return's payable), date and paid-through in one save that marks it Done; step 9 unlocks on step 8 and never enters a waiting state. **An overpayment or exactly ₱0 payable makes steps 8 and 9 NA the instant step 5 is Done (D76).**
- **eAFS opens only once File and Pay are Done (D85);** Pay counts as done when "nothing to pay." Step 12 is Mark done only and shows the eSubmission email draft — To = `TaxRuleSet.eSubmissionEmail`, subject `SAWT {1701Q|1701A|1701} {period end MMDDYYYY} {REGISTERED NAME IN CAPITALS} {12-digit TIN}`, body Name/TIN/RDO/Period — saved on the filing when marked Done (D87). Step 15 has no document and no Skip (D89).
- **The whole eAFS group and step 14 are NA when no Form 2307 is saved on the filing (D93):** eAFS applies only when there are certificates. The NA state follows the live certificate list until step 5, then is fixed.
- **A change to the figures behind a prepared computation reopens steps 3 and 4 while the filing is unfiled (D50):** a figures-changing save of step 1, a draft save of a previously-final step 1, adding/removing a certificate, a saved item 61, a saved payment on an earlier return, or a starting-figures change. The same step-1 saves un-skip a Skipped step 2 (D61). A filed filing is never reopened.
- **"Next" (D84)** is the first open step, in group order, that is her work — skipping locked steps and steps waiting on BIR; only when nothing of hers is left does it read "waiting on BIR — TRRC, 3 days", with no button. One helper serves the filing page's banner, the slim bar (D80) and the dashboard's "Needs my action". The banner never offers a control the step's own card lacks (D77).
- **The dashboard (D74/D84/D126–D130/D137):** four collapsible sections in one centred layout — Needs my action now; Waiting on client; Waiting on BIR (every step 10/13/14 waiting, independent of what else is open); 3M Threshold Alert. Open when it has entries, closed when empty; sorted by due date then client. A client wait's Due is the documents-due-from-client date, and a filing appears under Waiting on client only once its period has ended (D130). No Log follow-up (D128); Upcoming deadlines, Missing documents and election rows are gone.
- **The board — the Kanban (D70/D79/D138/D139/D141):** six group columns, no Complete column and no filters; a card sits in its earliest incomplete group and appears only once its period has ended. Outside BIR Confirmations a card shows each BIR wait as grey text at the bottom right ("TRRC · 2 days"); inside, its wait line goes red past twice the expected days. The board fills the window with its scroll bar at the bottom.
- **The status pill (D97):** "In progress" while any of her own work remains; "Waiting on BIR" only when nothing of hers is left — the pill and Next always agree.
- **Step 16 (D101–D114):** Mark done only. Unlocks when steps 7, 9, 10 and 13 are each saved or NA — not 14, which is never sent to the client (D109); the lock message names only what's missing (D113). The package is five kinds of document — filed return, proof of payment, TRRC, SAWT acknowledgement, Form 2307 scans (D108) — in a flat zip with standard file names and no manifest (D103/D111). The email opens "Hi [first name],", lists documents by name (D110), prints the same summary as step 4 from the frozen sheet so it adds up (D114), ends "Next filing: … due [date]. Please send required documents by [date]." (D106), then "Thank you!" (D112). Mark done saves the exact email on the filing and collapses the card.

### A Complete filing is read-only for good (D153)
- **Once a filing is Complete (all sixteen steps resolved, the green pill) nothing on its page can change it (and no Copy button, and read-only message texts — D156), and there is no Unlock or Reopen, not even a hidden one.** Every control that changes something is left out of the page (not greyed): Undo skip, Skip, Mark done, upload/Replace/Remove, Add certificate, the "all received" tick, payment and item 61 edits, "Go to income entry". Opening a saved document, Show/Hide, Collapse/Expand, Back to client and "Filing details" still work.
- **Enforced on the server:** every action that changes a filing, its steps, its documents or its certificates refuses with "This filing is complete and locked." This overrides D75/D94's "payment editable until the next return is filed". The amber amendment alert's Dismiss is the one thing that stays (it changes none of those).

### Blocking — the rule (D27, D35)
**The app blocks on documents it receives. It never asks the bookkeeper to prove she did something.**

| Category | Behaviour | Steps |
|---|---|---|
| Documents she **receives** from outside | Blocks `DONE` until attached | 2, 6, 7, 9, 10, 11 (both slots), 13, 14 |
| Actions she **performs** elsewhere | No slot at all | 4, 12, 15, 16 |

There is no longer a third category: step 15's optional eAFS-confirmation slot was removed (D89), and step 16's client email no longer asks the client to forward one. Steps 11–15 apply only when the filing has certificates (D93). Step 2 blocks on its own terms (D35); there is no other hard block.

### Books of accounts
This system generates no books at all (D25). CRJ, CDJ, General Journal and General Ledger are the client's responsibility; dropping the CRJ removes no obligation from the clients.

## Key workflows

**Quarterly cycle:** record the client's declared sales → receive and register 2307s → prepare computation → advise client → file → save submission screenshot and filed form → pay → save proof → *(if certificates)* alphalist entry → email DAT → acknowledgement (waited for) → eAFS → email package to client, which also tells her the next filing's due date and the date the client's documents are due (the 20th of the month after the period, D106); TRRC and validation email arrive from BIR independently.

**Completeness check:** income is client-declared, so the real risk is income the bookkeeper never hears about; nothing in the system guards against it (D37).

## Technology stack

Next.js 15 App Router · TypeScript strict · Prisma + SQLite (`data/app.db`) · **Tailwind CSS v4** (`@theme inline`, no `tailwind.config.*` — a small custom component set in `components/ui/`, not built on Radix despite `@radix-ui/*` being installed unused) · Zod · Luxon pinned `Asia/Manila` · Decimal.js, money as integer centavos · Vitest · jszip · exceljs (SAWT keying worksheet export) · Server Actions for CRUD · documents on the local filesystem under `./storage` · **Plus Jakarta Sans**, committed into the repo (`app/fonts/`) and loaded via `next/font/local` — never `next/font/google` (D58) · **`lucide-react`** for the left-side menu's icons

## Storage architecture

- `data/app.db` — SQLite, everything relational
- `./storage/{client.code}/{taxableYear}/{period}/{stepCode}__{slotCode}__{YYYYMMDD}__{seq}.{ext}` — never DB blobs, SHA-256 on upload
- Both gitignored. `ActivityLog` append-only; no hard deletes on financial records.

**The archive must survive the application.** The `storage/` folder tree is a complete, defensible record even if this codebase never runs again. **Nothing writes a manifest any more** (D22 was superseded by D103, and the client zip has none either); the archive describes itself through its folder path — `{client.code}/{taxableYear}/{period}/` — and its file-name convention (`{stepCode}__{slotCode}__{YYYYMMDD}__{seq}.{ext}`), with a SHA-256 recorded on upload. The database is an index over it, not its container.

## Integrations

**None, by design.** There is no public BIR API. Every BIR interaction stays manual — the system tracks and stores, it does not transmit. Do not scaffold fake integrations.

## UI principles

- Centered container ~1100px. Tables with aligned columns, not edge-pinned cards. Row text 14px, secondary 13px. Empty panels collapse to one muted line. Rows navigate to detail.
- **A left-side menu (D58/D140)** replaces the old top bar — Dashboard, ungrouped; Work (Kanban, Clients); Settings (Tax Rules, ATC, Holidays, BIR Logins), whose group heading itself links to the Settings hub page. Page headings match the menu; URLs and form field labels ("ATC code") are unchanged. **Back to Settings (D166):** Tax Rules, ATC, Holidays and BIR Logins (D180) each have a bordered Back button at the top right that goes to the Settings hub (beside New on Tax Rules and ATC; beside Add holiday on Holidays). **Holidays (D169):** the add form is hidden until the primary Add holiday button is clicked (as Payors, D161) and opens above the table; Save adds and closes, Cancel closes unsaved; table centred.
- **Every status pill goes through a plain-label helper, never a raw enum (D63)** — including the Form 2307 register's own statuses (D99).
- **The client's three sub-pages (D158–D161, no grey instructional text on any of them — headings, labels, figures and status pills only):**
  - **Income (D158)** is a view-only table reached from the client page (no `?filingId`): PERIOD · GROSS SALES · NON-OPERATING INCOME · TOTAL · STATUS, every column centred, nothing clickable. Rows: **"Previous quarters"** (one combined row, only when the year's starting figures name an outside return; gross = item 51 minus non-operating, `previousQuartersFromStartingFigures` in `lib/declaredIncome.ts`, the same derivation `filingComputation.ts` uses; status "Filed outside the app"), one "Q3 2026" row per in-app quarter (status Not yet entered / Draft / Saved / Filed), and a Total row. A missing figure is "—", never a silent ₱0.00; "No sales this quarter" is a real ₱0.00. **The year total and the Form 2307 page's certificates-vs-declared-sales check read the same function (`getDeclaredIncome`).** Step 1's "Go to income entry" still opens the single-quarter entry screen (same route, `?filingId=`), unchanged except that its "Other quarters" table shows the outside quarters as one "Previous quarters" row (D159).
  - **Form 2307 register (D160):** header "Form 2307 register — [name]" with Download all (hidden when there are no scans) and Back to client; **no Keying worksheet button** (the worksheet page and its xlsx export still exist, reachable by URL only); Year filter only (opens on the current year). Columns, centred: PERIOD (the period of the filing the certificate was entered under, "Q3 2026"/"Annual 2026", plain text) · PAYOR · ATC · INCOME PAYMENT · TAX WITHHELD · RATE · STATUS · SCAN (Download of the current scan). Chronological: Q1 → Q2 → Q3 → Annual, then the day entered. Download all = one flat zip of the year's current scans, "[Name] - Form 2307s [year].zip", saved file names, " (2)" on a collision (`lib/form2307Register.ts`, `/api/clients/[id]/form-2307-scans`). The certificates-vs-declared-sales card keeps its heading and two result lines and follows the Year shown.
  - **Payors (D161):** header "Payors — [name]" with Add payor (primary) and Back to client; the Add form is hidden until Add payor is clicked, opens above the table, and closes on Save or Cancel; the checkbox reads "Active"; the table is centred.
  - **The Starting figures page (D179)** carries the same rule: heading, Back to client and the card only — no grey explanation paragraph under the heading. The heading is two lines, "Starting figures — [name]" then "TY2026", no comma.
- **A bordered button has the same size as a purple one and a visible edge (D170/D174).**
- **One button size (D170):** every button in a page header's top-right group, and a form's submit button and its Cancel, share one size; only the colour differs (primary purple, bordered). The shared `Button` default is that size; `sm` is only for controls inside cards, tables and filter bars.
- **A sticky client bar (D104)** appears on the client page and its Income, Form 2307s and Payors pages once the header scrolls away: the client's name (a link), TIN, and buttons for those three pages. **No brief numbers, D-numbers, "SPEC.md" or "Phase" labels on any screen (D105).**
- **Status colours: grey pending, purple in progress (was blue — her decision, D58), amber waiting, red overdue, green done, and a grey "Not applicable" pill (D134/D135).** Colours are CSS variable tokens (`app/globals.css`), never a hard-coded hex value on a screen.
- **An overpayment on the computation sheet's own final row shows in parentheses, never a plain positive figure (D59)** — "(₱X)," labelled "… — overpayment," not coloured (it's a figure, not a verdict).
- **Density is not the goal; being operable is.** "Dense over pretty" was read too literally and produced a first test drive that stopped at step 4.
- **The page leads with the work, not the output, two ways at once.** A next-action line and summary strip sit at the top of the filing page, answering "what do I do now" without a scroll — the first test drive's specific complaint ("I don't know what to do with it... I realized I need to scroll down"). Separately, anything belonging to a step lives inside that step's own card rather than as a page-level panel at the bottom — the second test drive's complaint ("not sure what the bottom boxes are for"). These are two different fixes for two different findings; keep both. (The certificate cutoff and client-confirmation panels these two fixes originally described are both gone — see D34 and D37 — but the two fixes themselves, and the reasoning behind keeping them separate, still stand.)
- **A document belongs to its step, not to the page** (D30). Anything belonging to a step renders inside that step's card.
- **A slim bar is pinned to the top of the filing page once its header scrolls away (D80)** — client and period, Next, Go to step (which expands the step's group and scrolls to it).
- **Never expose a raw step code** (`PREPARE_RETURN`) in a user-facing label.
- **A disabled control explains itself on hover, not with standing text (D41).** A blocked "Mark done" — per step or per group — carries its reason as a `title` tooltip. It used to sit on the page as a standing red or amber line, in up to three places at once for the same rule; none of that remains. The one piece of standing status text that stays is the short amber "waiting on …" summary beside a group's name. Do not reintroduce standing block-reason text. **One narrow, deliberate exception (D47):** while step 2's "All certificates received" checkbox is ticked, the hidden Add/Remove controls are explained by one short line ("untick to add or remove"), because it explains a state she just set herself rather than blocking her from something — same spirit as the "waiting on …" exception above, not a reopening of D41.


## Data status and security

- **No real client data is in the application today.** The eight clients are fictitious seed data (D82; `garcia-r` and others carry mid-year starting figures). The Excel files remain the master for every live client. One real client's Q1 2026 figures are reproduced in `tests/tax/realFilingQ1_2026.test.ts` (D42) — an inline fixture with amounts and taxpayer type only, nothing identifying.
- **Real data enters at the live Q3 cycle** — certificates expected early November 2026, 1701Q due November 16. The Data Privacy Act (RA 10173) applies from that moment.
- **While the data is seeded, schema changes may be destructive and reseeding is free;** no migration path needs preserving. This licence expires when the live cycle begins.
- Runs local only. No analytics, telemetry, error SDKs, CDN fonts, or outbound runtime requests.
- Auth is a single `.env` password — adequate for localhost, nothing more.
- **Never on the live app (D177/D178):** `prisma migrate reset` or deleting `data/app.db` (it deletes every real client and re-adds the samples), or pointing the tests at `data/app.db` / `storage/` (the test run refuses). The one supported wipe is `npm run clean-start`, once, after a backup: it deletes every client and everything belonging to one plus all files in `storage/`, keeps the reference data, and the seed never re-adds the samples.
- **BIR Logins (D180/D181):** `/settings/bir-logins` is one table — one row per active client, sorted by name — with Username and Password columns under eAFS, Alphalist and ORUS, edited in place (Save/Cancel; one row at a time), in the same table look as ATC and Holidays. No Notes and no Copy on the screen (the two old notes columns stay in the database, unused and never overwritten). **Stored as plain text in the database by her decision** — readable in `data/app.db` and in every backup zip — and always shown unmasked. They are never written to the activity log (only "BIR logins updated for [client]"), a URL, a console log, an error message, the client package or any export. The clean start deletes them with the clients; the sample clients have none.
- **Backup (D172/D173):** Settings → Back up now downloads one zip — the database (a consistent snapshot), all of `storage/`, `.env` and a README.txt — to her Downloads folder; Settings shows the last backup time and the Dashboard reminds her after 7 days. No restore button: restoring is a manual, deliberate step (stop the app, unzip, copy `data\app.db`, `storage` and `.env` back, start the app — written out in the zip's README.txt). The zip holds clients' TINs, income and documents, so it is kept on her own drive or a USB stick, never a shared folder or email.

## Do not change without discussing first

1. The 8% formula, the ₱250,000 rule, the cumulative approach, and the computation sheet's whole-peso rounding (D49) — money is still integer centavos everywhere else
2. The certificate credit-period rule (D34: the filing it was entered under, locked once filed) and D11 (no amended returns), which makes it safe
3. **`computationSnapshot` immutability, now true in practice (D6/D83):** frozen at step 5, never rewritten; the `AmendmentAlert` pattern; **and the locks that keep it rare (D94)** — payment until the next return is filed, certificates and item 61 at their own filing, starting figures once the first in-app return is filed
4. Money as integer centavos; no float arithmetic anywhere
5. Rates, thresholds and deadlines living in `TaxRuleSet`, never hardcoded (the eSubmission address too, D87)
6. `/lib/tax/` purity — no database or I/O imports
7. The decision not to deploy, and the no-outbound-requests rule
8. Scope boundaries: no .DAT generation, **no books of accounts at all**, no BIR API integration
9. Adding any new dependency
10. The four-layer separation — the computation layer is never authored
11. The blocking rule (D27, as amended by D89: no optional "delivered to someone else" category remains)
12. The `Q4`-in-sales / no-`Q4`-in-filings distinction
13. The archive's independence from the database
14. The "Payors" list's independence from income and certificates (D44) — no foreign key to `Payor`, ever
15. Fill-back (D48) only ever fills a blank field on a payor
16. Only the 1701Q and 1701A are built as form-line sheets (D49)
17. **Starting figures (D56) replace outside quarters, not a `Filing` row** — a period named already-filed-outside-the-app gets no `Filing` row; and **starting figures remain the only source of which quarters were outside — `engagedSince` never excludes one (D78)**
18. Fonts and other static assets are stored inside the repo and never fetched at build, dev-start or runtime (D58)
19. **No group-level "Mark done" (D62)**
20. **Six groups, and step numbers never renumbered to make groups contiguous (D70)**
21. **eAFS applies only when the filing has certificates (D93)**
22. **8% only: no election and no regime to record or check (D136/D142)** — every client and tax year is 8% elected, flat rate

- **Rule set form (D168):** Effective from prefills as January 1 of the typed taxable year (editable; never auto-changed on Edit); the late-filing surcharge/interest section is gone from the form (columns kept, never written by Edit); no grey helper text; Cancel returns to the list.
