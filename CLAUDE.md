# CLAUDE.md

*Instructions for Claude Code working on this repository.*
*Last reconciled: 2026-10-10 — brief #6p (D185: step 3's Client details box), on top of brief #6o (D183–D184: the Clients list's Branch column; TINs shown with dashes on screen), on top of brief #6n (documentation fixes) and brief #6m (documentation pass), on top of brief #6l (D182: BIR Logins at the Dashboard's width, nothing wraps), on top of brief #6k (D181: BIR Logins as a table, ORUS added, Notes and Copy removed), on top of brief #6j (D180: the BIR Logins page under Settings), on top of brief #6i (D179: the Starting figures page heading on two lines, no grey explanation paragraph), on top of brief #6h (D174–D178: the bordered button's edge, every database page always-dynamic, the backup time recorded reliably, tests on their own database and storage, the clean start), on top of brief #6g (D170–D173: one button size, the Q1 default, one-click backup, the backup reminder), on top of brief #6f (D166–D169) (Back to Settings, the Tax Rules list and form, the Holidays Add button), on top of brief #6e (D162–D165: centred client-page tables, the ATC list and form, no verified state), on top of brief #6d (D155–D161: the Income, Form 2307 and Payors pages, Complete-filing Copy, step 2's skipped wording), on top of brief #6c (D151–D154) and brief #6a's documentation pass (checked against the tree at brief #5z's tip `e761a74`, covering briefs #5v–#5z, D115–D142) and brief #6b (D143–D150); #6c adds D151–D154: the Complete lock, step 2 starting open, the client page layout. Each rule is stated once, as it stands, with decision numbers (DECISIONS.md holds the history).*

---

## What this is

A local-first Next.js application used by **one bookkeeper** to manage Philippine BIR tax compliance for freelance clients on the 8% income tax option. It records the client's own declared quarterly sales, computes quarterly and annual tax, tracks a sixteen-step filing workflow per client per period, and stores the supporting documents.

**It is a filing manager, not an accounting system.** It generates no books of accounts. There is no ledger — only a declared-income record sufficient to compute the return.

`PROJECT_MASTER.md` (the rules), `CURRENT_STATE.md` (what is built, the sixteen-step table, sample data, what's next) and `DECISIONS.md` (the history) are current as of 2026-10-09 (brief #6m). **`SPEC.md` is not** — it is the original design, kept as history, and contradicts the build in places; its dated banner says which sections a decision supersedes. Where SPEC.md disagrees with the other three, they win, and say so rather than following SPEC.md quietly. `AGENTS.md` is written by `next dev`; leave it.

## Trust the tree, not a brief's account of it

If a brief's account of "what's on this branch" or how something works doesn't match what you find, **trust the tree** — verify with `git log`/`git merge-base` and by reading the code before writing code or docs (D31: a brief once called two diverged branches "stacked"; a brief in #5o described a payment edit that the payment lock in fact refuses). Where a brief and the code differ, the code wins and you say so. `CURRENT_STATE.md`'s "Where the code is" records the current branch.

## Before you finish: state the branch

**End every summary with three things: the branch you worked on, whether it's new, and (if new) the branch it was cut from.** Confirm with `git log`/`git status`; never assume the reader can reconstruct it from a name. **`git fetch origin <branch>` is the first step of every pass** — a local checkout has been behind the remote more than once.

## Who you are working with

**The user is not a technical person.**
- Explain significant decisions in **plain English**, not in terms of frameworks, patterns or type systems.
- **Never make a major architectural or business-rule change without explaining it first and waiting for a response.**
- When you need a decision, state the options and their practical consequences.
- Terminal commands: give the exact command and say what it does. Do not assume familiarity. Warn before anything destructive.

## Stack

Next.js 15 App Router · TypeScript strict · Prisma + SQLite (`data/app.db`) · Tailwind CSS · Zod · Luxon (`Asia/Manila`) · Decimal.js · Vitest · jszip · exceljs (SAWT keying worksheet export only) · Server Actions for CRUD

**Not "shadcn/ui" in any load-bearing sense.** `components/ui/*` are plain native elements wrapped in Tailwind classes via `cva`/`cn`. `@radix-ui/*` packages are installed with **no import anywhere** — don't assume Radix behaviour (focus trapping, portals, ARIA). Dialogs are native `<dialog>`.

## Architecture

```
/app/(app)/                    pages: dashboard (page.tsx), filings/ (the Kanban board, D138–D141),
                                clients/ [id]/ {edit, income, form-2307, payors, sawt-worksheet,
                                filings/[filingId] (the filing page), tax-years/[taxYearId]/{edit,
                                starting-figures}}, settings/ {atc-codes, holidays, tax-rule-sets, bir-logins (D180)}
/app/api/                      backup (POST streams the backup zip, GET the last-backup time — D172), clients/[id]/sawt-worksheet (xlsx), clients/[id]/form-2307-scans (Download all zip, D160), documents/[id]/download,
                                filings/[id]/package (flat client zip, standard file names, no manifest — D103/D108/D111)
/app/fonts/                    Plus Jakarta Sans, loaded via next/font/local — never next/font/google (D58)
/middleware.ts                 single-password session gate
/next.config.ts               serverActions.bodySizeLimit 25mb (D64)

/lib/tax/                      computation engine — PURE, zero I/O
  compute.ts                     computeQuarterlyForm / computeAnnualForm (D49 form-line sheets),
                                 extractFormSummary, resolveFormType, legacy computeFiling (MIXED_INCOME annual)
  amendment.ts                   pure item-by-item diff of a frozen vs live sheet (D83)
  periods.ts, types.ts, cwt.ts, deadlines.ts, lateFilingExposure.ts
/lib/declaredIncome.ts         getDeclaredIncome — the ONE reader of a year's declared income (the Income table and the certificates-vs-sales check, D158); /lib/form2307Register.ts (the register's rows, order, zip, D160)
/lib/filingComputation.ts      assembleAndComputeFiling (DB → engine), getFilingSheet/readFilingSheet
                                (the one reader of a filing's own figures, D83), checkAndRecordAmendments,
                                item 61 inheritance, isPaymentLocked, hasSalesRecordedForPeriod
/lib/workflow/
  groups.ts                      the six groups (D70), step-code tables, block reasons, stepLockReason,
                                 nextActionForFiling (D84), nextActionModeForStepCode (D77), per-group header text
  filingGeneration.ts            generateFilingsForClientYear (+ D78 guard), instantiateWorkflowSteps (step 2 always starts open, D152), recomputeRequiresSawt (D93)
  filingLock.ts                  the Complete lock (D153): FILING_LOCKED_MESSAGE, isFilingComplete, filingLockedReason, assertFilingNotComplete
  midYearGuard.ts                the mid-year Generate refusal (D78)
  aging.ts                       deriveStepAging, birWaitTone/birWaitTags, BIR_WAIT_SHORT_NAME (D72/D79/D92)
  status.ts                      filing/step status derivation and plain labels (D63, D124)
  clientWait.ts                  periodHasEnded, boardShowsFiling (D139), clientWaitDueDate (D130)
  dashboardRows.ts               the four dashboard sections and the due-date sort (D126/D129/D137)
  eafsHeader.ts, naGroupHeader.ts   eAFS's Pending-then-Not-applicable header (D134); the shared grey "Not applicable" pill (D135)
  docSlots.ts, completeness.ts, dueDate.ts, types.ts
  clientTaxAdviceMessage.ts + adviceMessage.ts   step 4's message (D51)
  eSubmissionEmail.ts            step 12's email draft (D87)
  clientPackageEmail.ts          step 16's email draft (D102, D110, D112); clientPackageEmailData.ts loads its inputs
  summaryLines.ts                buildSummaryLines — the ONE year-to-date summary both steps 4 and 16 print (D114)
  filingOrder.ts + filingOrderData.ts   the filing-order guard for step 5 (D95)
/lib/actions/                  Server Actions — the I/O boundary
  birLogins.ts                   saveBirLogins (D180) — the six login fields; logs a note only, never a value
  workflowSteps.ts               markStepDone (freeze at step 5 D83, auto-waits via startGatedBirWaits, D76 NA, draft save
                                 at step 12), skip/start/waiting refusals, reopenPreparedFiling, unskipStep,
                                 recomputeReceive2307Status, recomputeFileGroupDocStepStatus
  filings.ts                     generateFilingsAction, savePayment (D75), updateFilingOtherCredits, setAllCertificatesReceived, alerts
  quarterlySales.ts, form2307.ts, documents.ts (25 MB check, unlock gates), startingFigures.ts,
  payors.ts, atcCodes.ts, clients.ts, clientTaxYears.ts, holidays.ts, taxRuleSets.ts, sawt.ts, auth.ts
/lib/backup/                   createBackup.ts (VACUUM INTO snapshot + storage/ + .env + README.txt, streamed; D172), lastBackup.ts (AppSetting row, file name,
                                the 7-day reminder text — D173)
/lib/cleanStart/               cleanStart.ts (the clean start, now also deleting ClientBirLogin, D180: refusals, plan, DELETE prompt, one transaction, then files; D178), run by /scripts/clean-start.ts (`npm run clean-start`)
/lib/documents/                storage.ts (getStorageRoot — ./storage, or BIR_STORAGE_ROOT in tests only, D177) (naming, SHA-256), computationSheet.ts (+ computationSheetHtml.ts),
                                filingPackage.ts (planPackageDocuments — the five document kinds, the zip's standard names, and
                                the email's attachment list, all from one source: D108/D110/D111)
/lib/sawt/                     keying worksheet assembly and export
/lib/validation/               Zod schemas, one per form (birLogin.ts: ends trimmed only, D180)
/lib/formatDays.ts (the one source of "N days", D117), periodLabel.ts ("Annual", "Q3", D129), startingFigures.ts, reconciliation.ts, vatThreshold.ts, dates.ts, money.ts, upload.ts, prisma.ts, actor.ts, activityLog.ts, auth.ts, utils.ts
/components/                   client-details-cards (the client page's two cards, D154), board-column (the Kanban's column and fixed-height cards, D138), dashboard-section + dashboard-tables (D126/D127), filing-summary-strip + status-columns (the tax payable line and the fixed pill/Expand columns, D116), next-action-control, filing-sticky-bar, client-sticky-bar (D104), client-package-step-card (step 16, D101), go-to-step (shared "Go to step"), workflow-group-card,
                                workflow-step-card (generic), file-group-doc-step-card (self-completing upload steps, one or
                                more slots), email-dat-step-card (step 12), make-payment-step-card (step 8), record-sales-step-card,
                                receive-2307-step-card, certificate-form, advice-message-card, computation-sheet-panel, other-credits-form,
                                starting-figures-form, generate-filings-form, payor-*, atc-code-*, tax-rule-set-form, client-form, client-tax-year-form, holiday-form, clickable-row, print-button, nav, status-badge, copy-textarea, ui/
/prisma/                       schema.prisma, migrations/, seed.ts (reference data), seedScenarios.ts (the eight sample clients, D82),
                                backfills.ts (idempotent seed-run corrections: D96 step titles, D97 filing status, D106 document dates)
/tests/                        actions/ backup/ cleanStart/ clients/ filingComputation/ documents/ reconciliation/ sawt/ seed/ support/ tax/ workflow/  (709 tests, 78 files);
                                globalSetup.ts + setupEnv.ts give every run a throwaway seeded database and storage (D177)
/storage/  /data/              gitignored document vault and SQLite database
```

**`/lib/tax/` must never import Prisma, `fs`, `next/*`, or anything I/O.** Plain object in, plain object out.

**No `lib/books/` and no `ChartOfAccounts`/`JournalEntry`/`ImportBatch`/`ImportMappingProfile`/`SalesTransaction` models** (D25/D26). If a task or note refers to them it predates the rework.

## The income model — read this before touching anything money-related

- **Gross sales come from one place only: the client's declared figure for the quarter** (`QuarterlySales`). Certificates contribute nothing to it (D26).
- **A quarter's figure is the sum of per-customer rows (D33)**; `grossSalesCents` is derived in `saveQuarterlySales`, never an input. `/lib/tax/` still receives one summed figure. `noSalesThisQuarter` is a deliberate ₱0, distinct from no row. Draft vs. final; a final quarter opens read-only with Edit/Cancel; re-saving a final quarter as a draft reverts step 1 (D40); editable until its own step 5 is Done.
- **A Form 2307 is authoritative for the withholding and nothing else.** There is no "convert a 2307 into a transaction" flow and there must not be one.
- **`QuarterlySales.quarter` includes `Q4`; `Filing.period` does not.** No Q4 return. Two types, two CHECK constraints — do not merge them. Cumulative mapping: Q1→Q1, Q2→Q1+Q2, Q3→Q1+Q2+Q3, ANNUAL→Q1..Q4.
- A filing whose **own** quarter has no `QuarterlySales` row must say so in words (`hasSalesRecordedForPeriod`), never a silent ₱0.00.
- **There is no control over a declared income figure — say so plainly, don't invent a replacement (D37).** The only reconciliation is annual certificates-vs-declared-sales (`lib/reconciliation.ts`).
- **"Payors" (D44/D48) is a saved list, not a link:** no foreign key from `QuarterlySalesCustomer` or `Form2307` to `Payor`, ever. "Save … to payors" opens a native dialog; `fillPayorDetail` only fills a blank payor field, never overwrites.
- **A certificate's ATC code is a picker of maintained `AtcCode` rows and the rate comes from it (D43), and there is no Rate field (D132)** — `addCertificate` saves the code's rate; the `rateOverridden` column stays (old rows) but nothing sets it. Payor TIN, address and ATC are required (D45). The form is laid out in the rows of D131 (payor name · address · TIN + ATC · income + tax withheld · period from + to · scan). The scan is part of saving (D46); a saved row's only scan action is Replace, and **there is no scan date — the upload day is recorded automatically (D122).**
- **Starting figures (D56)** hold a mid-year client's outside-return figures; a period `latestOutsideReturn` names as outside gets **no `Filing` row at all** (`Filing.filedOutsideApp` covers a row that pre-existed). Locked once the year's first in-app return is filed.
- **Every new client is purely self-employed (D145).** The client form doesn't ask for taxpayer type, recognition basis, civil status, default WHT rate or the books fields; `createClient` writes `PURELY_SELF_EMPLOYED`/`COLLECTION`/`MANUAL`, `updateClient` never touches them, and the columns stay (the mixed-income sample keeps its value). Birthday is required (D146); the code suggestion on New client is `suggestClientCode` (D147).
- **Generate refuses for a client engaged mid-year with no starting figures (D78).** `generateFilingsForClientYear` (via `midYearGuard.ts`) creates nothing when `engagedSince` is inside the year after January 1, a quarter had already ended before it, and no `StartingFigures` row exists. Message names client, date and quarters and links to the screen. **No override, and `engagedSince` never excludes a quarter itself.** Any saved row (including "none") satisfies it; Feb 10 or Jan 1 or no date is unaffected. Enforced in the function, not just the button.
- **Credits (D55/D75):** item 61/63 is one figure per return (`Filing.otherCreditsCents`), inheriting forward, locked at that return's step 5. Item 55/57 is display-only, entered in the starting figures. Item 56/58 is real: the sum of earlier in-app returns' `Filing.amountPaidCents` (written by `savePayment`) plus the starting figures' base. Carry-over of a client's own Annual overpayment is not built.

## Frozen returns (D6/D83/D94)

**Marking step 5 (`FILE_RETURN`) Done writes the full computation to `Filing.computationSnapshot` (and `filedAt`) in the same transaction, never rewritten** (`markStepDone`; only `workflowSteps.ts` writes the field — a test enforces it). Every reader of a filing's own figures goes through `getFilingSheet`/`readFilingSheet` — the sheet, summary strip, Pay's default, D76's decision, step 4's message, the saved HTML. **Later returns still read real data** (Q3's item 56 is Q1/Q2's actual payments). After any change that could feed a filed return of the year (sales, a payment, a certificate, item 61, starting figures) `checkAndRecordAmendments` raises an `AmendmentAlert`, shown as one amber block with per-item old → new and Dismiss (informational, D11). **The locks that keep this rare are kept on purpose (D94):** payment editable until the next return is filed (`isPaymentLocked`); certificates and item 61 lock at their own step 5; starting figures once the first in-app return is filed. **Filing order (D95, built brief #5q): step 5 is refused until every earlier quarter of the year is filed** (filed outside the app counts) — "File Q1 2026 first." `filingOrder.ts`, checked in `markStepDone` before anything is written.

## A Complete filing is read-only for good (D153)

**Once a filing's status is Complete (all sixteen steps resolved, the green "Complete" pill), nothing on its page can change it, and there is no Unlock or Reopen — not even a hidden one.** The controls that change something are left out of the page, not greyed: Undo skip, Skip, Mark done, Replace, Choose File/upload, Remove, Add certificate, the "all received" tick, the payment and item 61 edits, the completeness note's Dismiss, and step 1's "Go to income entry". **No Copy button anywhere and the saved message/email text boxes are read-only (D156).** Viewing still works: saved documents open by file name, Show/Hide on the computation sheet and saved emails, group Collapse/Expand, "Show N not applicable", Back to client, the sticky bar, "Filing details". **Enforced on the server, not just hidden:** every action that changes a filing, its steps, its documents or its certificates (`markStepDone`, `skipStep`, `unskipStep`, `markStepInProgress`, `markStepWaitingExternal`, `logFollowUp`, `saveDocumentForStep`/`uploadDocument`, `deleteDocument`, `addCertificate`, `deleteCertificate`, `setAllCertificatesReceived`, `dismissCompletenessNote`, `updateFilingOtherCredits`, `savePayment`) refuses first with "This filing is complete and locked." (`lib/workflow/filingLock.ts`; the void actions throw `FilingLockedError`); the derive-only helpers (`reopenPreparedFiling`, `reopenSkippedReceive2307`, `recompute*`) do nothing on a Complete filing. **This overrides D75/D94's "payment editable until the next return is filed".** One deliberate exception: the amber amendment alert's Dismiss stays — it records that she has read a notice, and changes no filing, step, document or certificate.

## The blocking rule — read this before touching the workflow

**The app blocks on documents it receives. It never asks the bookkeeper to prove she did something (D27).**

| Category | Behaviour | Steps |
|---|---|---|
| Documents she **receives** from outside | Blocks `DONE` until attached | 2, 6, 7, 9, 10, 11 (both slots), 13, 14 |
| Actions she **performs** elsewhere | No slot at all | 4, 12, 15, 16 |

There is no third category: step 15's optional slot and step 16's forwarding line were removed (D89). Steps 11–15 apply only when the filing has a Form 2307 (D93).

- **Step 2 always starts open (D152).** `instantiateWorkflowSteps` generates every client's step 2 as Waiting on client (clock from the documents-due date) whatever `defaultWithholdingRateBps` holds — it is never generated Skipped. She clicks Skip herself when a client has no certificates that quarter — no typed reason: **a skipped step 2 always reads "No Form 2307 received from this client." (D157)**, whatever text an older row stored. Filings generated earlier are left as they are; nothing was backfilled. `defaultWithholdingRateBps` has no reader left in the code (the column stays, the seed still fills it).
- **Step 2 (D35)** is Done only when `certificatesAllReceivedAt` is set and every certificate has its scan (`recomputeReceive2307Status`); a two-way toggle. While "all received" is ticked, Add/Remove are hidden and refused server-side (D47). Step 2's own doc slot is `[]` — do not re-add one.
- **Steps 6, 7, 9, 10, 11, 13, 14 are self-completing behind a lock (D67/D71/D75/D86/D88):** upload box shown directly once the gating step is Done, no Attach link, **no date field, and a saved file's line shows no date (D119)** — the day of upload is recorded; "Choose File" is a bordered button (D120); the upload completes the step (`recomputeFileGroupDocStepStatus` — step 11 needs **both** files); a new upload is a one-for-one Replace; the lock is enforced in `saveDocumentForStep`, not just the UI. Removing the only file reverts to Pending — except 10, 13, 14, which return to Waiting.
- **Steps 10, 13 and 14 wait on BIR automatically (D68/D71/D88):** `startGatedBirWaits` moves the gated step from Pending to Waiting, `waitingSince` = that instant, when step 5 (→10), 12 (→13) or 13 (→14) is Done; after a file removal `waitingSince` resets to the gating step's `completedAt`. **No manual Mark waiting and no Log follow-up on any BIR wait (D72)**, refused server-side. One "Waiting on BIR · N days" pill — amber, red past twice the expected days, never green. Step 13 blocks step 14 (D29): one explicit edge, never generalised.
- **Steps 5–16 have no Start and no Skip (D65/D75/D86–D89, D101)**, refused server-side (`NO_START_NO_SKIP_STEP_CODES`); step 3 cannot be skipped either (D54), and steps 1 and 4 are refused Start and Skip server-side too (D98). Steps 11 and 13 also have no Mark done. Steps 1 and 2 are self-completing.
- **Step 5 has two locks (D100, D95), both enforced in `markStepDone` and shown as the greyed Mark done's hover tooltip:** all of Prepare must be resolved first — step 1 Done, step 2 Done or Skipped, steps 3 and 4 Done ("Finish Prepare first.") — and every earlier quarter must be filed ("File Q1 2026 first."). When both apply the Prepare reason shows.
- **Step 16 (D101–D114, D125) is Mark done only, no Start and no Skip.** It unlocks when steps 7, 9, 10 and 13 are each saved or NA — **not step 14**, which is never sent to the client (D109). Its lock message names only what is still missing, in step order ("Available once the TRRC is saved.", D113). Mark done saves the exact email (`Filing.clientPackageEmailTo/Subject/Body/SavedAt`) and the card collapses to "Emailed on [date]: [subject]" (D125; a new subject ends "filed on [date]"). The package holds five kinds of document only (D108), attached under standard names in a flat zip with no manifest (D103/D111); the email's list names documents, not files (D110); it opens "Hi [first name],", closes "Thank you!" (D112), and its summary is step 4's, from the frozen sheet (D114).
- **Step 3** is Mark done only, gated on steps 1/2 resolved. **Step 3's card opens with a "Client details" box (D185, `components/client-details-box.tsx`)** — TIN (dashed), Branch code, Birthday as MM/DD/YYYY (this box only), a muted "—" when empty; above item 55 and the item 61 box; display only, read from the client record, shown in every status including Complete. **Step 4** is Mark done only, gated on step 3 Done (D51), message saved as sent; its payable version no longer offers an advance (D107) and prints the shared year-to-date summary (D114).
- **Pay (D75/D76):** opens only once all of File is Done. Step 8 = amount/date/paid-through in one save that marks it Done; step 9 unlocks on 8 and never waits. **An overpayment or ₱0-payable return sets 8 and 9 NA the instant step 5 is Done**, read from the frozen sheet.
- **eAFS (D85–D89, D93):** locked until File and Pay are Done (Pay counts as done when NA), enforced server-side for every action (`stepLockReason`). Step 12 is Mark done only and shows the eSubmission draft (`eSubmissionEmail.ts`; address = `TaxRuleSet.eSubmissionEmail`); Mark done saves the exact draft on the filing (`Filing.dataEmail*`) and the card collapses to "Emailed on …". Step 15 has no document. **With no Form 2307 on the filing, steps 11–15 (and 14) are NA** — following the live certificate list until step 5, then fixed (`recomputeRequiresSawt`).
- **There is no election check (D136):** every client and tax year is 8% elected; nothing is recorded or confirmed, and no Q1 step is locked for it.
- **A change to the figures behind a prepared computation reopens steps 3 and 4 while unfiled (D50/D61)** — `reopenPreparedFiling`, after a figures-changing final save of step 1, a draft save of a previously-final step 1, a certificate add/remove, a saved item 61, a saved payment, or a starting-figures change; the same step-1 saves un-skip a Skipped step 2; a filed filing is never reopened.
- **Skipped steps stay visible in place with Undo skip (D60);** in practice **only step 2** offers Skip (step 16 lost it in D101; a step 16 skipped in old data still shows Skipped with Undo). A Complete filing shows no Undo skip (D153).
- **A document belongs to its step's card, not the page. Never expose a raw step code** in a label.
- **A disabled control explains itself on hover, not with standing text (D41).** No standing red/amber block-reason paragraph. The short amber "waiting on …" beside a group name stays; one narrow exception: the line under step 2's ticked checkbox (D47).
- **The filing page has two answers to "what do I do now"**: the next-action banner + summary strip at the top, and everything belonging to a step inside its own card. Keep both.

## The six groups (D70)

| # | Group | Steps |
|---|---|---|
| 1 | Prepare | 1 Record quarterly sales · 2 Receive Form 2307 · 3 Prepare computation · 4 Advise client |
| 2 | File | 5 File return · 6 Submission screenshot · 7 Filed form |
| 3 | Pay | 8 Make payment · 9 Save proof of payment |
| 4 | eAFS | 11 Alphalist entry · 12 Email DAT · 13 Acknowledgement · 15 eAFS |
| 5 | BIR Confirmations | 10 Save TRRC email (D90) · 14 Validation email |
| 6 | Client package | 16 Email package to client |

Step titles in the tree (D96, built): step 13 **"Save SAWT acknowledgement email"**, step 14 **"Save SAWT validation email"**; `BIR_WAIT_SHORT_NAME` (`lib/workflow/aging.ts`) reads "TRRC", "SAWT acknowledgement", "SAWT validation", so the board tag is "SAWT validation · 8 days". A seed backfill renames existing rows.

- **Grouping only changes reporting, not what any step requires.** Membership is a fixed lookup in `groups.ts`, **never `category` repurposed** (`category` would put step 10 in File and step 4 with step 16).
- **Step numbers are never renumbered to make groups contiguous — do not "fix" it.** File and Pay sit ahead of BIR Confirmations numerically though it's a later group. A filing waiting only on the TRRC or validation email after everything else is done is normal and raises no warning.
- **No group has a "Mark done" (D62) — do not add one back.** The header is a grey Pending label (tooltip names open steps), a green Done pill, or — when every step in it is NA — a grey Not applicable pill (D135). The counter counts Done + Skipped, excludes NA, is hidden when every step is NA, and **never shows a skipped count (D124)** — the counting is unchanged. **The header is two fixed columns — the status pill, then Expand/Collapse — shared with the tax payable line so the pills line up (D116, `components/status-columns.ts`).**
- **Header text is each group's own function and names only steps actually waiting, with fixed plain names (D73)** — never a generic missing-document fallback. A group whose every step is NA has no Expand, only its note (D91), beside a **grey "Not applicable" pill, never a green Done (D135, `naGroupHeader.ts`)**: Pay "Nothing to pay — overpayment ₱X"; eAFS "No Form 2307" — **and eAFS reads a grey "Pending" ("Depends on Form 2307s (step 2)") until step 2 is Done or Skipped (D134, `eafsHeader.ts`).**
- **"Next" (D84):** `nextActionForFiling` — the first open step in group order that is her work, skipping locked steps and BIR waits; only BIR waits left reads "waiting on BIR — TRRC, 3 days" with no button. **Days are always spelled out — "0 days", "1 day", "N days" — through `formatDays` (D117).** One helper for the banner, the slim bar and the dashboard. The banner never offers a control the step's card lacks (D77, `nextActionModeForStepCode`).
- **The board is the Kanban (D70/D79/D138/D139/D141):** `/filings`, headed "Kanban". Six group columns, **no Complete column and no filter bar**; an empty column says "Nothing here." A card sits in its earliest incomplete group, has a fixed height, and **appears only once its period has ended (Q1 Apr 1, Q2 Jul 1, Q3 Oct 1, Annual Jan 1 next year — `boardShowsFiling`, D139)**. A BIR wait outside BIR Confirmations is plain grey text at the bottom right ("TRRC · 2 days", "SAWT validation · 8 days"); inside BIR Confirmations the wait line turns red past twice the expected days. **The board fills the window: columns scroll up and down inside themselves and the sideways scroll bar sits at the bottom edge; the page itself never scrolls sideways (D141).**
- **The dashboard (D74/D84/D126–D130/D137):** four collapsible, centred sections — Needs my action now · Waiting on client · Waiting on BIR (every step 10/13/14 waiting, independently of "Needs my action") · 3M Threshold Alert (a client at 80% or more of the ₱3,000,000 threshold, starting income included; BREACHED at 100%) — open when they have entries, closed when empty, every table sorted by due date then client. **A client wait's Due is the documents-due date, and a filing is listed only once its period has ended (D130).** No Log follow-up on the dashboard (D128). Upcoming deadlines, Missing documents and the election rows are gone.
- **The slim bar (D80):** `filing-sticky-bar.tsx`, fixed beside the menu once the header scrolls away; "Go to step" (`go-to-step.tsx`) expands the group and scrolls to `#step-<STEPCODE>`. **Every step card on the filing page sits in a wrapper with that id and `scroll-mt-20` — keep it.**

## Coding conventions

- **Money is integer centavos.** Decimal.js for arithmetic. No `parseFloat`, `Number()` or `toFixed` on any money path. Display only via `centsToPesos()`.
- **Dates:** never extract with `getUTCDate()`/`getUTCMonth()`/`getUTCFullYear()`. Calendar-day comparisons go through `manilaCalendarDay()`; elapsed time uses milliseconds; display via `formatManilaDate()`. *This bug class has appeared repeatedly — a live hazard.*
- **No new dependencies without asking.**
- **No outbound network calls at runtime.** No CDN fonts, analytics, telemetry or error SDKs. **Fonts and assets live in the repo (D58)** — never `next/font/google`.
- Validate with Zod at every boundary.
- **Every page that reads the database exports `dynamic = "force-dynamic"` (D175)**; a test fails if a `page.tsx` lacks it.
- Server Actions that call `revalidatePath` can't run outside Next; scripts (the seed) stub `next/cache` before a dynamic import.

## Database rules

- `ActivityLog` is append-only; no hard deletes on financial records. `ActivityLog.note` carries a short note for a reopen or un-skip.
- **Never hardcode a value the code is supposed to derive.** The old exception (hand-verified literal snapshots in the seed) no longer applies: seeded filed returns get real snapshots through the real action (D82/D83).
- **A code-level fix does not reach rows already in the database.** Template changes (titles, slots, conditional flags) need a seed backfill for existing `WorkflowStep` rows (the seed does this for D66/D89/D90/D92); when changing a rule say whether existing data needs a backfill.
- Migrations that add constraints should be verified to actually reject bad values.
- **The app is live, so every migration is additive only (D178).** New tables and new nullable columns; nothing dropped, renamed, retyped or reset, and no migration that needs a reseed. The old licence for destructive migrations expired when real clients were entered (2026-10-09). A column the app stops using stays in the table, unread and unwritten (as `eafsNotes`/`alphalistNotes` do, D181). Show the migration SQL in the report.

## The live app: three things never to do (D177/D178)

- **Never run `npx prisma migrate reset` (or delete `data/app.db`) on the live app.** It drops the whole database — every real client — and re-adds the eight sample clients (the `samplesRemoved` flag lives in the database it just dropped). It is for a scratch copy only. Say so plainly if she ever asks for a "reseed".
- **Never point the tests at the live database or the real `storage/`.** `npm test` builds its own throwaway database and document folder (`tests/globalSetup.ts`), gives each test file a private copy (`tests/setupEnv.ts`), and **refuses to start** if either would be `data/app.db` or `storage/` (`tests/support/liveGuard.ts`). Don't weaken or bypass that; don't add a test that reads or writes `process.cwd()/storage` or `data/` — use `testStorageRoot()` from `tests/helpers/testEnv.ts`.
- **Don't wipe real data by hand, and never run the clean start again.** `npm run clean-start` (D178) was a one-time step before go-live and it has been done (2026-10-03). Running it on the live app now would delete every real client and every document; it is for a scratch copy only.

## Seed data (D82)

- **Every seeded client is fictitious**; never reuse a name typed in by hand during a walkthrough (they may be real people; the seed is committed).
- **Every past-due filing is Complete or doesn't exist.**
- **Drive each filing through the real server actions** (`saveQuarterlySales`, `addCertificate`, `markStepDone`, `savePayment`, `uploadDocument`, …) so auto-waiting, nothing-to-pay NA, item 56, the D78 guard and the frozen snapshot come out as the app produces them. What is set by hand (Client/ClientTaxYear/Payor rows, back-dated `waitingSince`) is named in `prisma/seedScenarios.ts`'s header. `seed.ts` stubs `next/cache` before a dynamic import — never import `seedScenarios` statically.
- **Seeded documents are small placeholders marked SAMPLE**, saved through the normal storage path. Each client's Notes holds a one-line "Sample …" scenario.
- Keep TaxRuleSet, Holiday and ATC seeding as is (WI010/WI011 stay as seeded and unconfirmed by the app, D19/D165); the suite depends on the seeded TaxRuleSet. Tax tests never read seed data (D5).
- **The seed never deletes** — reference data is upserted; samples are built only when none exist, **never after the clean start (`AppSetting.samplesRemoved`) and never into a database that already holds a client who is not one of the eight samples (D178).** To start a **scratch** database clean (never her live app): `npx prisma migrate reset --force` (drops the database, re-applies migrations, runs the seed); Prisma refuses that under an AI agent without her consent, so Claude runs the equivalent against the scratch copy only: a new `DATABASE_URL` pointing at a scratch file, `npx prisma migrate deploy`, `npx tsx prisma/seed.ts`.

## Business rules you must not quietly change

1. The 8% formula, the ₱250,000 deduction (full from Q1, never prorated, `PURELY_SELF_EMPLOYED` only), the cumulative approach, and whole-peso rounding at the items the form rounds (D49)
2. The certificate credit-period rule (D34) — the filing it was entered under, locked once filed — and D11 (no amended returns)
3. **`computationSnapshot` is frozen at step 5 and never rewritten; edits raise an `AmendmentAlert` (D6/D83); and the locks that keep it rare stay (D94)**
4. Deadlines: Q1 May 15, Q2 Aug 15, Q3 Nov 15, Annual Apr 15. **No Q4 return.**
5. eAFS = adjusted due date + 15 days; early filing does not move it
6. Filing status derivation: `DONE`/`NA`/`SKIPPED` → `COMPLETE`
7. **No books of accounts at all** — do not re-add without a dedicated brief
8. The income model, the blocking rule, and the `Q4` distinction
9. No .DAT generation, no BIR API integration, no email sending
10. The archive's independence from the database
11. The "Payors" list's independence from income and certificates (D44)
12. Fill-back (D48) only fills a blank payor field
13. Only the 1701Q and 1701A are built as form-line sheets (D49)
14. Starting figures replace outside quarters, not a `Filing` row (D56); `engagedSince` never excludes one (D78)
15. Fonts and other static assets live in the repo (D58)
16. Six groups, never renumbered (D70); no group-level Mark done (D62); eAFS only with certificates (D93)
17. **The client's document deadline is the 20th of the month after the period ends (D106)** — Q1 Apr 20, Q2 Jul 20, Q3 Oct 20, Annual Jan 20. A `TaxRuleSet.clientDocsDueDay` setting (1–28, default 20), no weekend or holiday shift, stored on `Filing.certificatesExpectedBy` (on screen "documents due from client"), and separate from `internalFilingTarget` (D14), which is untouched. The tax rate is now typed as a percentage on the rule set screen (8.00%) but is still stored as basis points.
18. **8% only: no election and no regime to record or check (D136/D142)** — every client and tax year is 8% elected, flat rate; `electionStatus` defaults to `ELECTED`, `regime` is always written `RATE_8_PERCENT`, and no screen, lock or computation reads either. The year-end credit election is a different thing.

## Never invent BIR specifics

ATC codes, penalty rates, compromise schedules, form field orders, the eSubmission address. If you are not certain, **leave it empty and flag it** rather than producing something plausible. Checking a code against the current BIR ATC list is her job, outside the app; the app no longer shows a verified/unverified state (D165). The `AtcCode.verifiedAgainstIssuance` and `payeeType` columns stay in the schema but nothing reads or shows them; new codes save `payeeType = "Individual"` (D164). **Never invent a code or a rate; never seed one you haven't been given** (D19). **`/settings/atc-codes` is where she adds and edits codes (checking them against BIR's list is hers, outside the app, D165) — do not seed a code or a rate you have not been given.** The eSubmission address (`TaxRuleSet.eSubmissionEmail`) is hers, to confirm against BIR.

## UI rules

Centered container ~1100px. Tables with aligned columns. Row text 14px, secondary 13px. Empty panels collapse to one muted line. Rows navigate to detail with a hover state. **Status colours: grey pending, purple in progress, amber waiting, red overdue, green done, grey Not applicable (D58/D134/D135).**

- **A status pill always goes through a label helper, never a raw enum (D63)** — `filingStatusLabel()`/`stepStatusLabel()`, and `form2307StatusLabel()` for the Form 2307 register ("Received", "Recorded", "Claimed on return", … D99). **The filing pill reads "In progress" while any of her own work remains and "Waiting on BIR" only when nothing of hers is left (D97)** — it agrees with Next by construction.
- **No internal references in screen text (D105):** no brief numbers, D-numbers, "SPEC.md", "Phase" labels, "bps" or step-number cross-references on any screen. Code comments may keep them.
- **The filing page header (D115/D123):** no status pill beside the title (it stays on the tax payable line); the subtitle reads "1701Q - due November 16, 2026" (full month names; "1701Q", never "F1701Q", D118); the card heading is "Steps"; the statutory-date and documents-due paragraphs live under a small "Filing details" link at the bottom.
- **Wording that is settled:** the filed sheet is headed "Computation sheet (Filed)" and shows form lines and figures only, with no "Show explanations" and no pre-fill note under item 61 (D121/D133); step 4 reads "Advised on [date]" (D118); steps 12 and 16 read "Emailed on [date]" (D125); "Choose File" is a bordered button (D120).
- **The Clients list (D183)** columns: Code · Registered name · TIN · Branch · RDO · Status, all centred; Branch is the branch code in monospace like TIN, a muted "—" when empty. **TINs are shown with dashes on every screen (D184): `formatTin` in `lib/formatTin.ts` is the one display helper** (9 digits → 123-456-789, 12 → 123-456-789-000, anything else exactly as stored). Display only — stored values, Zod and form inputs are unchanged. **Stays undashed:** step 12's eSubmission subject/body (D87), saved email text, the SAWT xlsx, zip/file names, the backup, the computation sheet HTML. Use `formatTin` for any new on-screen TIN; never in `/lib/tax/` or an export.
- **The client page (`/clients/[id]`, D154):** the header row (name, Active pill, Back to list · Income · Form 2307s · Payors · Edit) then two same-height cards side by side, stacked on a narrow window — **Registration** (three columns, equal width with the other card, D155: TIN · Branch code · RDO code; Trade name; Registered address; Birthday · Client code) and **Contact & business** (two columns: Email · Mobile phone number; Line of business · PSIC code; Engaged since · Notes) — then Taxable years and Filings. Dates use full month names; an empty value is a muted "—"; TIN and client code are monospace. The registered name is the heading and is not repeated. **Taxpayer type, civil status, default WHT rate, revenue recognition and the whole Books & compliance card are not on the page** (columns kept). Engaged since, Active and Notes stay at the bottom of the New/Edit form (D151). **The page never scrolls sideways: the header's buttons wrap onto a second line on a narrow window (D155).**
- **The client's three sub-pages (D158–D161, no grey instructional text on any of them — headings, labels, figures and status pills only):**
  - **Income (D158)** is a view-only table reached from the client page (no `?filingId`): PERIOD · GROSS SALES · NON-OPERATING INCOME · TOTAL · STATUS, every column centred, nothing clickable. Rows: **"Previous quarters"** (one combined row, only when the year's starting figures name an outside return; gross = item 51 minus non-operating, `previousQuartersFromStartingFigures` in `lib/declaredIncome.ts`, the same derivation `filingComputation.ts` uses; status "Filed outside the app"), one "Q3 2026" row per in-app quarter (status Not yet entered / Draft / Saved / Filed), and a Total row. A missing figure is "—", never a silent ₱0.00; "No sales this quarter" is a real ₱0.00. **The year total and the Form 2307 page's certificates-vs-declared-sales check read the same function (`getDeclaredIncome`).** Step 1's "Go to income entry" still opens the single-quarter entry screen (same route, `?filingId=`), unchanged except that its "Other quarters" table shows the outside quarters as one "Previous quarters" row (D159).
  - **Form 2307 register (D160):** header "Form 2307 register — [name]" with Download all (hidden when there are no scans) and Back to client; **no Keying worksheet button** (the worksheet page and its xlsx export still exist, reachable by URL only); Year filter only (opens on the current year). Columns, centred: PERIOD (the period of the filing the certificate was entered under, "Q3 2026"/"Annual 2026", plain text) · PAYOR · ATC · INCOME PAYMENT · TAX WITHHELD · RATE · STATUS · SCAN (Download of the current scan). Chronological: Q1 → Q2 → Q3 → Annual, then the day entered. Download all = one flat zip of the year's current scans, "[Name] - Form 2307s [year].zip", saved file names, " (2)" on a collision (`lib/form2307Register.ts`, `/api/clients/[id]/form-2307-scans`). The certificates-vs-declared-sales card keeps its heading and two result lines and follows the Year shown.
  - **Payors (D161):** header "Payors — [name]" with Add payor (primary) and Back to client; the Add form is hidden until Add payor is clicked, opens above the table, and closes on Save or Cancel; the checkbox reads "Active"; the table is centred.
  - **The Starting figures page (D179)** carries the same rule: heading, Back to client and the card only — no grey explanation paragraph under the heading. The heading is two lines, "Starting figures — [name]" then "TY2026", no comma.
- **A sticky client bar (`components/client-sticky-bar.tsx`, D104)** on the client page and its Income, Form 2307s and Payors pages: appears once the page header scrolls away, beside the menu, with the client's name (a link), TIN and buttons for those three pages. The filing page has its own slim bar (D80); the two never appear together. The Form 2307 register opens on the current year, with a Year filter only (D160; D105's "All periods" default is superseded).
- **A left-side menu (`components/nav.tsx`, D58/D140):** Dashboard · Work (Kanban, Clients) · Settings (Tax Rules, ATC, Holidays, BIR Logins), the heading linking to the hub. **Page headings match the menu ("Kanban", "Tax Rules", "ATC"); URLs and form field labels ("ATC code") are unchanged.** Icons from `lucide-react` only. **Back to Settings (D166):** Tax Rules, ATC, Holidays and BIR Logins (D180) each have a bordered Back button at the top right that goes to the Settings hub (beside New on Tax Rules and ATC; beside Add holiday on Holidays). **Holidays (D169):** the add form is hidden until the primary Add holiday button is clicked (as Payors, D161) and opens above the table; Save adds and closes, Cancel closes unsaved; table centred.
- **The New/Edit rule set form (D168):** Effective from fills in as January 1 of the taxable year typed (`lib/ruleSetDefaults.ts`) and stays editable — once she changes it, it stops following the year; on Edit the stored date is shown and `updateTaxRuleSet` writes a date only when its Manila calendar day changed. The late-filing surcharge/interest section is gone from the form; the columns stay, Create leaves them empty, Edit never writes them, and no screen reads them (only the self-disabled `lib/tax/lateFilingExposure.ts` does). No grey helper text — format examples are placeholders in the boxes; Cancel is bordered and returns to the list unsaved.
- **One button size (D170):** every page-header button and every form's submit + Cancel pair uses the shared `Button` default size; only the colour differs. Don't add `size="sm"` to a header or form button; `sm` is for controls inside cards, tables and filter bars.
- **A bordered button's edge is the `--button-edge` token (D174)**, not the pale `--line`: it is the same size as the purple one, and the darker edge is what makes it read that way.
- **Colours are CSS variable tokens (`app/globals.css`), never a hard-coded hex on a screen** — the generated computation-sheet HTML (an archive document) is the one exception.
- **Plus Jakarta Sans, loaded locally.** Tabular figures on money columns.
- **An overpayment on the sheet's final row shows in parentheses, "(₱X) — overpayment" (D59).** "Nothing to pay — overpayment ₱X" is muted grey, never amber (D81).
- **Density is not the goal; being operable is.** **Lead with the work, not the output.**

## Security

**BIR logins (D180/D181):** each client's eAFS, Alphalist and ORUS username and password (`ClientBirLogin`, page `/settings/bir-logins`, one table, Username/Password columns under each login, edited in place; the Dashboard's 1100px width, nothing wraps, the table's own card scrolls sideways on a narrow window and the page never does — D182) are **plain text in the database by her explicit decision** — readable in `data/app.db` and every backup zip, shown unmasked. **No Notes and no Copy button on the screen (D181); the `eafsNotes`/`alphalistNotes` columns stay in the table, never read or written, and a save never touches them.** **Never** write a value to `ActivityLog` (note "BIR logins updated for [client]" only; no before/after JSON), a URL or query string, a console log, an error message, the client package email or zip, or any export; Zod trims the ends only and error text never echoes a value. Samples get none; the clean start deletes them.

**The app holds real TINs, income data and documents, so the Data Privacy Act applies now.** The clean start (D178) was run on 2026-10-03, after a backup, and the sample clients are gone from her live database (`samplesRemoved` is set); real clients have been entered since 2026-10-09 (the Excel files stay the master until she switches). The eight sample clients exist only in scratch databases and in the test run's throwaway database (D82/D177) — never in her live app. One real client's Q1 figures are reproduced in `tests/tax/realFilingQ1_2026.test.ts` (D42/D49) — amounts and taxpayer type only, no name, TIN, payor or address. Single `.env` password is adequate for localhost and nothing more. **Backup (D172):** Settings → Back up now makes one zip (database snapshot via `VACUUM INTO`, all of `storage/`, `.env`, README.txt); the last time is in `AppSetting` (`lastBackupAt`); the Dashboard shows an amber reminder after 7 days or if never (D173). The time is written the moment the zip has fully streamed — never for a zip that failed or was abandoned, and never held back by a temp-file cleanup error (D176). **There is no restore button — restoring stays manual** (stop the app, unzip, copy `data\app.db`, `storage` and `.env` back, start it; the zip's README.txt spells it out). The zip holds real TINs, income and documents — it is kept private, never emailed or shared. Never commit `data/`, `storage/`, or any `*.local.ts` fixture.

## How to approach changes

- **Do only what was asked.** Don't refactor, reformat or "improve" outside the task; report what you notice instead.
- **Verify identifiers and behaviour against the working tree before editing.** Briefs describe intent and often get names, branch relationships and behaviour wrong.
- If a request is ambiguous, ask. Prefer fixing the root cause.
- **If your own earlier work or summary turns out wrong, say so directly.**
- **Do not report a phase, feature or branch as complete without opening the files.**

## How to test

- Tests first for anything in `/lib/tax/`; tax tests use inline fixtures and **never read seed data or the database**.
- Every bug fix gets a regression test verified to fail under the old code.
- Run the full suite, typecheck and build before reporting done. **The suite seeds its own throwaway database (D177) — you no longer seed first, and it never touches `data/app.db` or `storage/`.** (Tests that run child processes — `npx prisma …`, `tsx prisma/seed.ts` — must pass their own `DATABASE_URL` and `BIR_STORAGE_ROOT`.) `tests/seed/seedScenarios.test.ts` seeds a throwaway database in child processes.
- **`tests/tax/realFilingQ1_2026.test.ts` is the real-figures regression guard** — one real client's filed Q1 2026 return (gross ₱332,933.90 → item 49 ₱332,934.00, item 53 ₱82,934.00, tax due ₱6,635.00, item 58 ₱16,646.70, total credits ₱16,647.00, overpayment (₱10,012.00)), whole-peso figures per D49. The old centavo figures (₱6,634.71 / ₱10,011.99) are wrong now — don't resurrect them.
- For UI work, do a live walkthrough against the dev server. **Do not report a page as verified if you did not load it.** A passing suite says nothing about whether a screen is usable.

## Convenience

- `Start Bookkeeping App.bat` and `_test-files/` (disposable dummy documents) live at her repo root, untracked.
- `npm install` writes an `allowScripts` block into `package.json` (machine-local; she stashes before switching branches) and regenerates the Prisma Client (D57).
- **The plain seed (`npx tsx prisma/seed.ts`) never deletes** — it upserts reference data, builds the samples only when none exist (and never after the clean start, D178), and runs three idempotent corrections on existing rows: the D96 step-title rename, the D97 filing-status recompute, and **the D106 date correction on unfiled filings** (filed returns keep the date they were worked to).
- **A clean typecheck needs Next's generated route types.** `app/layout.tsx` uses `LayoutProps<"/">`, which Next generates into `.next/types`; on a fresh checkout `npx tsc --noEmit` reports one `LayoutProps` error until `npx next typegen` (or any `next dev`/`next build`) has run once. It is an environment artefact, not a code error.
- **The update routine after pulling:** close the app · `git stash` · `git pull` · `npm install` · `npx prisma migrate deploy` (only when a brief added migrations — all additive, so it is safe on her live data) · start the app. **`npx prisma migrate reset` is never part of her routine** (it drops every real client); the warning lives in "The live app: three things never to do".

## Current priorities

See `CURRENT_STATE.md`. All six groups are walked and closed, the look pass (briefs #5v–#5z) and the settings/BIR Logins briefs (#6e–#6l) are checked by her, and the clean start is done (D178, 2026-10-03). In short:
1. **Set up each real client** (in progress since 2026-10-09): add client → tax year → starting figures → generate (D78 enforces the order; there is no election step, D136). 1701Q due **November 16, 2026**. Excel stays the master until she switches. **Back up regularly** (Settings → Back up now; the zip is kept private).
2. **She checks the ATC codes** at `/settings/atc-codes` (each now carries the certificate's rate, D132) **and the eSubmission address** (`TaxRuleSet.eSubmissionEmail`) against BIR.
3. After go-live, in this order: the **document archive browse view**, then the **calendar**, then the **Annual overpayment carry-over** (2026→2027).
4. **The next brief is #6q; the next decision number is D186.**
