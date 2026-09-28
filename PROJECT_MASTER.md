# PROJECT_MASTER.md

*Permanent project memory. Update only when something long-lived genuinely changes.*
*Last reconciled: 2026-09-28 — brief #5j, covering brief #5i (closing out the Prepare group: skipped steps stay visible and undoable, no group-level "Mark done," the group counter, plain status labels), on top of brief #5h (briefs #5d-#5g), brief #5c, brief #5b, brief #5a, and the documentation pass (brief #4f) through briefs #4c-#4e.*

> Build status lives in CURRENT_STATE.md. This file is the intended application and the rules that govern it.

---

## Application

**BIR 8% Freelancer Practice Manager** — on screen (the left-side menu, brief #5g) it reads **"BIR Filing Manager"**, subtitled **"8% Tax Rate."**

A local-first web application used by one bookkeeper to manage Philippine tax compliance for freelance and professional clients who have elected the 8% income tax option.

## What kind of application this is

**A filing manager, not an accounting system.** The question "accounting system or workflow board?" was settled on 2026-09-20 by removing the Cash Receipts Journal from scope (D25). The CRJ was the accounting leg; without it there is no ledger, only an income record sufficient to compute the return.

Four layers, with a strict rule about who authors what:

| Layer | Authored? | Role |
|---|---|---|
| Income record | Yes | The client's declared gross sales per quarter — the sum of per-payor rows, derived, never typed directly (D33; called "Payor" on screen since D48 — the underlying `QuarterlySalesCustomer` model and `customerName` field keep their original names, deliberately). The only place money enters. |
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

**Primary success metric:** a dashboard that makes "I'm lost as to which process I'm in" structurally impossible. *Met — the dashboard answers this for all four clients at a glance.*

## Intended users

One bookkeeper, alone, on a single laptop. Not deployed. Not client-facing.

## Business rules that matter most

### Tax computation (8% regime)
- Computed **cumulatively year-to-date** for every period.
- `taxableBase = MAX(0, cumulativeGross − allowableDeduction)`; `incomeTaxDue = taxableBase × 8%`.
- `allowableDeduction` = ₱250,000 for `PURELY_SELF_EMPLOYED`, ₱0 for `MIXED_INCOME`.
- The ₱250,000 is applied **in full from Q1 onward**, never prorated.
- `taxPayable = incomeTaxDue − cumulativeCWT − priorPeriodPayments − priorYearExcessCredit − otherCredits`.
- `priorPeriodPayments` means amounts **actually remitted**, never computed liabilities.
- Negative result = **overpayment**; never rendered as negative tax due — since brief #5g (D59) an overpayment on the computation sheet's own final row reads "(₱X)," labelled "… — overpayment," never a plain figure that could be mistaken for tax due.
- **Prior-year excess credit appears in every cumulative period**, not only the first.
- Mixed income earners file **1701**, not 1701A.
- **The computation sheet follows the BIR form's own line items and whole-peso rounding, not centavo rounding throughout (D49, brief #5d, her decision).** `lib/tax/compute.ts`'s `computeQuarterlyForm` (1701Q, items 47–58, 61–63) and `computeAnnualForm` (1701A column A, items 47–49, 52–60, 63–65) round half-up to the whole peso at exactly the items eBIRForms rounds; money is still stored as integer centavos, a rounded line is simply a multiple of 100. She was shown the app disagreeing with her own filed Q1 return (₱6,634.71 vs. the form's ₱6,635.00) and chose to follow the form. **Only the 1701Q and the 1701A are built this way** — she has no mixed-income clients, so `MIXED_INCOME`'s annual return (Form 1701) has no form-line sheet and still runs through the old, unrounded `computeFiling` (renamed `LegacyFilingComputationResult`/`Input`). The VAT threshold monitor and the annual certificates-vs-sales check are unaffected — both still compare unrounded figures.

### Income entry (D26, D33)
- **Gross sales come from one place only: the client's declared figure for the quarter.** Certificates contribute nothing to it.
- **A quarter's declared figure is the sum of per-customer rows (D33, brief #4b)** — customer name + amount, added and removed freely. `QuarterlySales.grossSalesCents` is derived from these rows on every save, never itself typed. `/lib/tax/` still receives one summed gross figure per quarter — this is a change to how the figure is entered, not to what the engine computes.
- **A 2307 is authoritative for the withholding and nothing else.** It reports what one payor paid and withheld, and only ever sees income from payors who are withholding agents. Income from non-withholding clients and direct consumers appears on no certificate. Some clients issue no 2307 at all and simply state a quarterly total.
- Income and credit are independent inputs, exactly as the 1701Q treats them.
- **`QuarterlySales.quarter` includes `Q4`; `Filing.period` does not.** There is no Q4 return — October–December income is picked up by the annual. Two types, two CHECK constraints. Do not merge them.
- Cumulative mapping: `Q1`→Q1; `Q2`→Q1+Q2; `Q3`→Q1+Q2+Q3; `ANNUAL`→Q1+Q2+Q3+Q4.
- A missing quarter is zero. A filing whose **own** quarter has no declared-sales row must **say so in words**, distinct from a cumulative total that happens to be zero from earlier quarters — a silent `₱0.00` reads as a real answer and it is not one.
- **"No sales this quarter" is a deliberate ₱0** (`QuarterlySales.noSalesThisQuarter`), distinct from a quarter with no row at all — `hasSalesRecordedForPeriod` still keys on row existence and reads a deliberate no-sales quarter as recorded.
- **Draft vs. Save (D33):** saving a draft stores the rows without marking step 1 done; Save does both. A quarter stays editable until its own filing's step 5 (`FILE_RETURN`) is `DONE`.
- **Draft/final state and the Edit flow (D40, brief #4d):** the editable quarter's card names its own state — no label if nothing's saved, "Draft saved [date] — not final. Step 1 is still open." for a draft, "Saved [date] — step 1 is done." once final. A final quarter opens **read-only** with an **Edit** button; Edit reveals the form again plus a **Cancel** button that discards unsaved changes. Saving an edited final quarter as a draft reverts step 1 to open — the one place a draft save can undo a completed step 1, superseding D33's original "never undo it." A draft-only quarter still opens directly editable, no toggle. A successful final Save returns to the filing page automatically; Save as draft stays on the income page with a short confirmation. Step 1's own card on the filing page shows a "DRAFT" tag beside the total while it isn't final.

### There is no control over a declared income figure — say so plainly

Once income is declared-only, nothing in the system can be cross-checked against anything: the client's stated quarterly figure IS the income record. **Step 3 used to carry an acknowledgement that closed part of that gap — a required source-of-figure field, plus an optional attachment for the client's own confirming message. Both are gone (D37, briefs #4c and #4d, the bookkeeper's own decision).** Step 3 now holds only the computation sheet it generates itself, plus the ordinary step controls.

The declared figure is accepted as given. The per-quarter Notes field (`QuarterlySales.notes`) still exists and can hold anything she chooses to write about a quarter, but nothing asks for an entry there and nothing requires one — it is a free-text field, not a substitute control. The only reconciliation of any kind left in the system is the annual certificates-vs-declared-sales check below, which was never a check against the sales figure's own source to begin with — it only catches certificates that, summed, exceed what was declared.

### Starting figures for a client joining mid-year (D56, brief #5f)

Every one of her current clients' Q1 and Q2 2026 were filed from Excel, so at go-live every client joins the app mid-year. `StartingFigures` (one row per client per taxable year) holds the handful of figures typed once from a client's latest return filed outside the app: `latestOutsideReturn` (`NONE`/`Q1`/`Q2`/`Q3`), item 55, item 51, items 57 and 58, item 56, the amount actually paid on that outside return, item 61 with its description, and optional non-operating income so far. Non-operating income can't exceed cumulative income; the figures are read-only after Save, with Edit; they lock for good once the year's first in-app return is filed.

A period `latestOutsideReturn` names as already filed gets **no `Filing` row at all** — that absence, not a filter, is what keeps it off the board, the dashboard, and every overdue check. `Filing.filedOutsideApp` is the separate, narrower flag for a `Filing` row that already existed before starting figures later named its period outside; such a row renders on the client page as an explicit **"Filed outside the app"** line, not as ordinary work and not hidden either. Saving starting figures reclassifies existing rows and reopens filings that inherit the figures (see "Reopening" under Workflow below) — it does not itself create a newly-inside period's `Filing` row; that still takes an ordinary re-run of "Generate filings" (safe — it skips periods that already have a row or are still named outside).

Order for a new client: add the client → add the tax year → enter the starting figures → generate filings. The middle two can happen in either order.

### Credits: items 55, 56 and 61 (D55, briefs #5e/#5f)

- **Item 61 (1701Q) / item 63 (1701A) — other tax credits/payments — is one figure per return, not per year.** Stored on `Filing.otherCreditsCents`/`otherCreditsDescription`; a return with no saved value of its own inherits the previous return's figure, or the starting figures' item 61 for the year's first in-app return. Save/Edit/Cancel; locked once that return's own step 5 is `DONE`. A saved change reopens this filing (see Workflow below) and propagates forward to every later filing of the year still inheriting.
- **Item 55 (1701Q) / item 57 (1701A) — prior year's excess credit — is display-only on step 3**, entered only once, in the starting figures. It still appears in full on every return of the year (D12). Automatic carry-over of a client's *own* Annual overpayment into the following year's starting figure is **not built** — deferred to the Pay-group work, first relevant at the 2026→2027 boundary.
- **Item 56 (1701Q) / item 58 (1701A) — payments for earlier quarters — is calculated**, from `Filing.amountPaidCents` on this year's earlier, already-filed returns. **Known gap:** nothing in the app writes `amountPaidCents` for a return filed inside the app yet, so this line is ₱0 for any in-app-filed quarter until the Pay-group work adds it — today it's only ever populated via a mid-year client's own starting-figures amount.

### Creditable withholding (Form 2307)
- **A certificate counts in the filing whose step 2 it was entered under (D34, brief #4b, supersedes D10).** `Form2307.claimedOnFilingId` is set once, at entry, and never reassigned. `certificateCutoffDate`, the manual override, and the resolver function are gone.
- **`dateReceived` is removed entirely (D38, brief #4d)** — not merely stripped of its deciding role. The SAWT keying worksheet sorts by payor name (TIN as tie-breaker) instead; the annual check below needed no change, since it already keyed on the filing a certificate was entered under, not a date.
- **Step 2's checkbox only appears once at least one certificate row exists (D39, brief #4d).** With none, step 2 shows only "Add certificate" and "Skip"; skip disappears once a row is entered, since skipping no longer makes sense at that point. Removing the last row reverts to the no-rows state and unticks the checkbox if it had been ticked.
- **Step 2's list is locked once that filing's own return is filed** (step 5, `FILE_RETURN`, `DONE`). A certificate arriving after filing is entered under the next open filing instead — usually the next quarter or the Annual, her choice, made by which filing's step 2 she enters it under.
- **No amended returns (D11).** This is what makes D34 safe — a filed period's certificate list can never be reopened to move a certificate into or out of it.
- Cumulative crediting is otherwise unchanged: a certificate claimed on period P counts toward P and every later period in the same taxable year.
- The only reconciliation: certificate gross totals ≤ declared sales, **compared over the taxable year**, never per quarter — unaffected by D34; it still runs over the whole year regardless of which quarter a certificate is claimed on.
- **Required fields (D45, brief #5a):** payor TIN, payor address and ATC code are now required, alongside payor name, income amount, tax withheld and period covered. Validated with Zod server-side, not only on the form. The old "more fields" disclosure is gone — once these three joined the main form, nothing required was left behind it.
- **ATC code is a picker, and the rate is a property of the code (D43, brief #5a).** The free-text ATC box and separate rate box are gone. `AtcCode` (Settings: add/edit/deactivate, never invented — D19) now has a maintenance screen; the certificate form's ATC picker offers only active codes and fills `withholdingRateBps` from the chosen code's own rate. The rate stays visible and editable — the certificate is authoritative over the code when they disagree — and `Form2307.rateOverridden` records when she's typed a different rate than the code's own. `verifiedAgainstIssuance` is shown plainly wherever a code appears.
- **The scan is part of saving the certificate (D46, brief #5a, her decision).** A certificate cannot be created without its scan — no separate upload step afterward. D35's blocking rule (below) is now satisfied by construction rather than earned later. A saved row keeps a **Replace scan** action (one-for-one; the prior scan is soft-deleted, never hard-deleted).
- **"Payors" (D44, brief #5a, her decision; named "Customers / payors" until brief #5b renamed it on screen):** a saved per-client list (`Payor` — name, TIN, address, usual ATC code, active flag) shared by step 1's payor-name field and step 2's payor-name field. Picking a saved entry autofills that one row/certificate (TIN/address/ATC on step 2; name only on step 1); everything stays independently editable from there, and editing never rewrites the saved entry. **This is a shared reference of names/details only — there is no foreign key from `QuarterlySalesCustomer` or `Form2307` to `Payor`, and no path for a certificate to affect gross sales.** A small per-client screen (`/clients/[id]/payors`) covers edit/deactivate but is never the only way in.
- **Saving a new payor opens a small dialog (D48, brief #5b).** "Save … to payors" no longer saves the name alone — a dialog (`components/payor-details-dialog.tsx`) offers name (pre-filled), TIN, address and usual ATC code, all but the name optional. Cancel or Escape leaves the row exactly as typed, unsaved. One dialog serves both step 1 and step 2. Separately, when a certificate field is filled that's blank on its matched saved payor, a one-line offer appears to save that value back onto the payor (`fillPayorDetail`) — her choice, never automatic, and never offered when the payor already has a (possibly different) value for that field, per D45's certificate-is-authoritative rule.

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
- Sixteen steps. Step 1 **Record quarterly sales**, step 2 **Receive Form 2307 from client** (D28). Steps 11–14 (SAWT) conditional on `requiresSawt`.
- **Steps 1 and 2 are self-completing (D33/D35, brief #4b) and carry no manual controls at all** — no Start, Mark waiting, Mark done, Skip on step 1; step 2 keeps only Skip (with a reason). Step 1's status is derived: "Waiting on client" until a final Save of the quarter's sales, then Done. Step 2's status is derived: "Waiting on client" until done or skipped, done once "all certificates received" is ticked and every certificate row has its own scan.
- **Step 3 (Prepare computation) can no longer be started or skipped (D54, brief #5f, her decision: "it is the heart of the app")** — only Mark done remains. It holds the credits box (item 55 read-only, item 61 editable) above the computation sheet it generates.
- **Step 4 (Advise client) is no longer a waiting step (D51, briefs #5d–#5f)** — no Start, no Mark waiting. Its Mark done is blocked, server-side, until step 3 is Done, and it shows no message until then. The message is a copyable, client-facing draft in one of three versions (payable / quarterly overpayment / annual overpayment), and its own client-facing due date is the BIR due date minus a configurable lead time, shifted earlier on a weekend or holiday.
- **A change to the figures behind an already-prepared computation reopens steps 3 and 4 while the filing is still unfiled (D50, briefs #5d–#5f, extended #5i).** A figures-changing save of step 1, adding or removing a certificate, a saved change to item 61, or a saved change to the starting figures all reopen; a no-op save, Replace scan, and unticking "all certificates received" on its own do not. **As of brief #5i, the same figures-changing step 1 saves also un-skip a Skipped step 2 (D61) — a different declared figure may mean an unexpected certificate — and undoing step 2's skip by hand is itself a reopening trigger (D60).** A filed filing (step 5 Done) is never reopened.
- **No group has a "Mark done" (D62, brief #5i, her decision, superseding D53's three-state button entirely).** A group is finished only when its own steps are — every step still resolves on its own per-step control, one at a time. The group header reports status only: a non-clickable grey "Pending" label (the steps still open, named as its hover tooltip) while anything in it is unresolved, or a green "Done" pill once every step is Done or Skipped. Prepare closes itself the moment all four of its steps resolve — there is no group-level click, and never will be again; `markGroupDone` is deleted outright, not merely disabled.
- **The group counter counts Done + Skipped together, with a "N skipped" suffix (D60, brief #5i).** `NA` steps are excluded from both numbers — "4 of 4 · 1 skipped · Done" once a group with one skip finishes, unchanged ("4 of 4 · Done") when nothing was skipped.
- **A skipped step stays visible in its group, in step order, and can be undone (D60, brief #5i).** It renders collapsed by default like Done, with a grey Skipped pill, its reason, and an Undo skip button, restoring the step to whatever its own rules say next (never forced to "Not started" for step 2, which recomputes its real derived state instead). Refused once the filing's own step 5 is Done. Only steps that could be skipped in the first place gained this — not step 1, step 3 (D54) or step 4, none of which ever had a Skip control.
- Filing status is **derived** from its steps, never hand-set: all `DONE`/`NA`/`SKIPPED` → `COMPLETE`.
- **`SKIPPED` requires a written reason** and stays visibly distinct from `NA`. **A skipped step sits in its group, in place, in step order — never hidden the way `NA` is — and can be undone (D60, brief #5i).** An Undo skip control restores it to whatever its own rules say next, not to a generic "not started."
- **The "waiting on …" label shows only for a step actually waiting right now (D52, brief #5d)** — it keys on the step's live status, not the step template's permanent "this step can wait" flag, which previously left a stale "waiting on X" reading beside an already-Done pill on five different steps.
- **Steps 5, 6, 7 and 10 (the File group) have no Start and no Skip (D65, brief #5k, her decision), enforced server-side.** Step 5 (renamed "File return via eBIRForms," D66 — she doesn't use eFPS) keeps only Mark done. **Steps 6, 7 and 10 lose Mark done too (D67, brief #5k)** — each unlocks only once step 5 is Done, then shows its upload box directly (no "Attach" link) and completes itself the moment the document is attached, the same self-completing shape steps 1/2 already use. A new upload against an already-Done one of these three is a one-for-one Replace (D46's pattern); removing the only file reverts the step to Pending. Step 10 alone also keeps Mark waiting, available once step 5 is Done; uploading the TRRC marks it Done and clears any waiting state either way.

### Workflow groups (D32)

The sixteen steps are wrapped in **five groups** — Prepare, File, Pay, SAWT, Close. **No group has a "Mark done" of its own (D62, brief #5i, her decision) — a group is finished only when every step inside it is**, one at a time on the step's own control. This changes nothing about what a step requires; it only changes how the board's columns are laid out and how a group's status is reported.

| Group | Steps |
|---|---|
| 1 Prepare | 1 Record quarterly sales · 2 Receive Form 2307 · 3 Prepare computation · 4 Advise client |
| 2 File | 5 File return · 6 Save submission screenshot · 7 Save filed form · 10 Receive TRRC |
| 3 Pay | 8 Make payment · 9 Save proof of payment |
| 4 SAWT | 11 Alphalist entry · 12 Email DAT · 13 Acknowledgement · 14 Validation |
| 5 Close | 15 eAFS · 16 Email package to client |

**Step numbers are not renumbered to make groups contiguous.** Group 2 (File) is deliberately not contiguous — the TRRC (step 10) sits with File rather than with Pay (group 3, steps 8–9) between them, because eBIRForms' TRRC confirms the *filing*, not the payment (`WorkflowStep.category` for step 10 has always been `FILING`). Step numbers record when things happen; groups record what they belong to. A filing can therefore sit at "File," waiting only on the TRRC, after "Pay" is already fully done — this is normal, not out-of-order, and raises no warning. The board's card for such a filing sits in its earliest incomplete *group* (group order, not step sequence) and carries that group's waiting state (e.g. "File — waiting on BIR, 12d") so it doesn't read as unfiled.

**Blocking now shows on each step's own "Mark done" tooltip; the group header only ever reports Pending or Done (D62, brief #5i).** The underlying rule (D27) is unchanged for every group — a step's own control stays disabled, with its reason as a `title` tooltip, while it's missing a required document; the group header simply reads Pending until every step in it resolves, then Done, with no button of its own at any point in between. **Prepare is the one group with a block that predates any single step** (brief #4b): steps 1 and 2 now self-complete and carry no doc slots of their own, so step 3's own "Mark done" is what `prepareGroupBlockReason()` gates — until step 1 is Done and step 2 is Done or Skipped — enforced inside `markStepDone` itself, not by a group-level check. **As of brief #4e (D41), the reason is a hover tooltip, not standing text on the page.** Close still blocks on nothing. The election hard-blocker and the step 13→14 dependency (D29) are unaffected and still apply; expanding a group exposes every per-step control (attach, skip with reason, mark waiting) exactly as before grouping existed, except steps 1 and 2 themselves, which have no such controls at all, and step 3/4, which are Mark-done-only (D54/D51).

Group membership is a fixed lookup table (`lib/workflow/groups.ts`), not the `category` field repurposed — `category` alone would put step 4 (`ADVISE_CLIENT`) and step 16 (`SEND_CLIENT_PACKAGE`), both `CLIENT_COMM`, in the same group despite belonging to different points in the cycle.

### Blocking — the rule (D27, D35)

**The app blocks on documents it receives. It never asks the bookkeeper to prove she did something.**

| Category | Behaviour | Steps |
|---|---|---|
| Documents she **receives** from outside | Blocks `DONE` until attached | 2, 6, 7, 9, 10, 11 (both slots), 13, 14 |
| Actions she **performs** elsewhere | No slot at all | 4, 12, 16 |
| A document delivered **to someone else** | Optional, hidden, never blocking | 15 only |

Step 2 (D35, brief #4b) blocks on its own terms — "all certificates received" ticked and every certificate row has its own scan attached — rather than one step-level slot, since it now holds a variable number of certificate rows instead of a single document. **As of D46 (brief #5a), this is satisfied by construction:** a certificate cannot be created without its scan, so a row lacking one is no longer reachable through ordinary use — the rule itself is unchanged. **While "all certificates received" is ticked, no row can be added or removed** (D47, brief #5a) — enforced server-side, not only by hiding the Add/Remove controls; unticking restores both.

**Steps 6, 7 and 10 (D67, brief #5k) are self-completing like step 2, but locked behind step 5.** Each carries exactly one required doc slot and unlocks only once step 5 (`FILE_RETURN`) is Done; before that, no upload box shows at all, just a muted "Available once step 5 is done" line. Once unlocked, attaching the document marks the step Done by itself — no separate Mark done — and a later upload against the same slot is a one-for-one Replace (D46's pattern), the prior file soft-deleted. The lock is enforced in the upload action itself (`lib/actions/documents.ts`'s `saveDocumentForStep`), not only by the UI hiding the box.

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

**Completeness check:** income is client-declared, so the real risk is income the bookkeeper never hears about. **There is no control against this in the system (D37).** The client's stated figure is accepted as given; the only surviving reconciliation is the annual certificates-vs-declared-sales check.

## Technology stack

Next.js 15 App Router · TypeScript strict · Prisma + SQLite (`data/app.db`) · **Tailwind CSS v4** (`@theme inline`, no `tailwind.config.*` — a small custom component set in `components/ui/`, not built on Radix despite `@radix-ui/*` being installed unused) · Zod · Luxon pinned `Asia/Manila` · Decimal.js, money as integer centavos · Vitest · jszip · exceljs (SAWT keying worksheet export) · Server Actions for CRUD · documents on the local filesystem under `./storage` · **Plus Jakarta Sans**, committed into the repo (`app/fonts/`) and loaded via `next/font/local` — never `next/font/google` (D58, brief #5g) · **`lucide-react`**, a dependency since before brief #5g and now actually used, for the left-side menu's icons

## Storage architecture

- `data/app.db` — SQLite, everything relational
- `./storage/{client.code}/{taxableYear}/{period}/{stepCode}__{slotCode}__{YYYYMMDD}__{seq}.{ext}` — never DB blobs, SHA-256 on upload
- Both gitignored. `ActivityLog` append-only; no hard deletes on financial records.

**The archive must survive the application.** The folder tree plus a manifest is a complete, defensible record even if this codebase never runs again. The database is an index over it, not its container.

## Integrations

**None, by design.** There is no public BIR API. Every BIR interaction stays manual — the system tracks and stores, it does not transmit. Do not scaffold fake integrations.

## UI principles

- Centered container ~1100px. Tables with aligned columns, not edge-pinned cards. Row text 14px, secondary 13px. Empty panels collapse to one muted line. Rows navigate to detail. Filters persist across navigation.
- **A left-side menu (D58, brief #5g)** replaces the old top bar — Dashboard, ungrouped; Work (Filings, Clients); Settings (Tax rule sets, Holidays, ATC codes), whose group heading itself links to the Settings hub page.
- **Status colours: grey pending, purple in progress (was blue — her decision, D58, brief #5g), amber waiting, red overdue, green done.** Colours are CSS variable tokens (`app/globals.css`), never a hard-coded hex value on a screen.
- **An overpayment on the computation sheet's own final row shows in parentheses, never a plain positive figure (D59, brief #5g)** — "(₱X)," labelled "… — overpayment," not coloured (it's a figure, not a verdict).
- **Density is not the goal; being operable is.** "Dense over pretty" was read too literally and produced a first test drive that stopped at step 4.
- **The page leads with the work, not the output, two ways at once.** A next-action line and summary strip sit at the top of the filing page, answering "what do I do now" without a scroll — the first test drive's specific complaint ("I don't know what to do with it... I realized I need to scroll down"). Separately, anything belonging to a step lives inside that step's own card rather than as a page-level panel at the bottom — the second test drive's complaint ("not sure what the bottom boxes are for"). These are two different fixes for two different findings; keep both. (The certificate cutoff and client-confirmation panels these two fixes originally described are both gone — see D34 and D37 — but the two fixes themselves, and the reasoning behind keeping them separate, still stand.)
- **A document belongs to its step, not to the page** (D30). Anything belonging to a step renders inside that step's card.
- **Never expose a raw step code** (`PREPARE_RETURN`) in a user-facing label.
- **A disabled control explains itself on hover, not with standing text (D41, brief #4e).** A blocked "Mark done" — per step or per group — carries its reason as a `title` tooltip. It used to sit on the page as a standing red or amber line, in up to three places at once for the same rule; none of that remains. The one piece of standing status text that stays is the short amber "waiting on …" summary beside a group's name. Do not reintroduce standing block-reason text. **One narrow, deliberate exception (D47, brief #5a):** while step 2's "All certificates received" checkbox is ticked, the hidden Add/Remove controls are explained by one short line ("untick to add or remove"), because it explains a state she just set herself rather than blocking her from something — same spirit as the "waiting on …" exception above, not a reopening of D41.

## Data status and security

- **No real client data is in the application today.** The four clients (including `garcia-r`, the mid-year starting-figures sample added by brief #5f) are fictitious seed data. The Excel files remain the master for every live client. One real client's Q1 2026 figures are reproduced in `tests/tax/realFilingQ1_2026.test.ts` (D42, brief #4e) — a committed test with an inline fixture carrying amounts and taxpayer type only, nothing that identifies the client (no name, TIN, payor name, or address). The earlier arrangement (`scripts/verify-real.ts` reading a gitignored `scripts/real-fixture.local.ts`) is gone — that local fixture, it turned out, had never actually existed on any machine this project has run on, so the guard it was meant to provide had never once run.
- **Real data enters at the live Q3 cycle** — certificates expected early November 2026, 1701Q due November 16. The Data Privacy Act (RA 10173) applies from that moment.
- **While the data is seeded, schema changes may be destructive and reseeding is free.** No migration path needs preserving. This licence expires when the live cycle begins.
- Runs local only. No analytics, telemetry, error SDKs, CDN fonts, or outbound runtime requests.
- Auth is a single `.env` password — adequate for localhost, nothing more.
- `data/app.db` has no backup. Housekeeping now; a genuine single point of failure the day live data is entered. **Solve before November.**

## Do not change without discussing first

1. The 8% formula, the ₱250,000 rule, the cumulative approach, and the computation sheet's own whole-peso rounding at the items the BIR form itself rounds (D49) — money is still integer centavos everywhere else
2. The certificate credit-period rule (D34: the filing it was entered under, locked once filed) and D11 (no amended returns), which is what makes it safe
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
14. The "Payors" list's independence from income and certificates (D44) — no foreign key from `QuarterlySalesCustomer` or `Form2307` to `Payor`, ever
15. Fill-back (D48) only ever fills a blank field on a payor — never overwrites one it already has
16. **Only the 1701Q and the 1701A are built as form-line sheets (D49)** — `MIXED_INCOME`'s annual return (Form 1701) has no sheet and stays on the old, unrounded computation path
17. **Starting figures (D56) replace outside quarters, not a Filing row** — a period named already-filed-outside-the-app gets no `Filing` row generated for it at all; do not "fix" this into always generating one
18. **Fonts and other static assets are stored inside the repo and never fetched at build, dev-start, or runtime (D58)** — this is what `next/font/local` over `next/font/google` bought; do not reintroduce a network-loaded font or asset
19. **No group-level "Mark done" (D62).** A group is finished only when every step in it is — do not add one back
