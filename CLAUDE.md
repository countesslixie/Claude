# CLAUDE.md

*Instructions for Claude Code working on this repository.*
*Last reconciled: 2026-09-28 — brief #5j, covering brief #5i (skipped steps stay visible and undoable, no group-level "Mark done," the group counter, plain status labels — closing out the Prepare group), on top of brief #5h (briefs #5d-#5g), brief #5c, brief #5b, brief #5a, and the documentation pass (brief #4f) through briefs #4c-#4e.*

---

## What this is

A local-first Next.js application used by **one bookkeeper** to manage Philippine BIR tax compliance for freelance clients on the 8% income tax option. It records the client's own declared quarterly sales, computes quarterly and annual tax, tracks a sixteen-step filing workflow per client per period, and stores the supporting documents.

**It is a filing manager, not an accounting system.** It generates no books of accounts. There is no ledger — only a declared-income record sufficient to compute the return.

`PROJECT_MASTER.md`, `CURRENT_STATE.md` and `DECISIONS.md` carry project context and are current as of 2026-09-28. **`SPEC.md` is not** — it still describes the pre-rework system and contradicts the build in several places; see its dated banner for which sections a decision has superseded. Where SPEC.md disagrees with PROJECT_MASTER.md or DECISIONS.md, the latter win, and say so rather than following SPEC.md quietly.

## Trust the tree, not a brief's account of it

Once, a documentation brief asserted that two rework-pass branches were already stacked onto each other when they were actually siblings that had diverged from the same base commit — found only after a dedicated pass reconciled them back together by hand (`DECISIONS.md` D31). The lesson that outlasted that specific episode: **if a brief's account of "what's on this branch" doesn't match what you find, trust the tree** — verify with `git log`/`git merge-base` before writing code, not just before writing docs. This has been checked and held up on several later passes since, including a case where the session's newly-assigned branch turned out to carry no real work at all and had to be reset onto the branch a brief actually named. **Which specific branch each past brief used, and what it was cut from, is recorded in `CURRENT_STATE.md`'s "Where the code is" section** — read that, don't assume, if you need the current branch's real history.

## Before you finish: state the branch

**End every summary with three things: the branch you worked on, whether it's new, and (if new) the branch it was cut from.** Never assume the reader can reconstruct this from a name alone. Whether a pass lands on a brand-new branch or continues on the previous one varies and cannot be guessed in advance — confirm with `git log`/`git status` before assuming either. Skipping this has cost real round trips: the user has reseeded her database against code she did not have, and two branches once diverged from a name that was never clearly stated. One line prevents it, every time — not just when something changed.

## Who you are working with

**The user is not a technical person.**

- Explain significant decisions in **plain English**, not in terms of frameworks, patterns or type systems.
- **Never make a major architectural or business-rule change without explaining it first and waiting for a response.**
- When you need a decision, state the options and their practical consequences.
- Terminal commands: give the exact command and say what it does. Do not assume familiarity. Warn before anything destructive.

## Stack

Next.js 15 App Router · TypeScript strict · Prisma + SQLite (`data/app.db`) · Tailwind CSS · Zod · Luxon (`Asia/Manila`) · Decimal.js · Vitest · jszip · exceljs (SAWT keying worksheet export only — the Cash Receipts Journal that used to be its other consumer is gone) · Server Actions for CRUD

**Not "shadcn/ui" in any load-bearing sense.** `components/ui/*` (`button.tsx`, `card.tsx`, `checkbox.tsx`, `input.tsx`, `label.tsx`, `select.tsx`, `textarea.tsx`) are plain native elements wrapped in Tailwind classes via the `cva`/`cn` convention. `@radix-ui/react-dialog`, `react-label`, `react-select`, and `react-slot` are `package.json` dependencies with **no import anywhere in the codebase** — confirmed by grep, 2026-09-20. Don't assume Radix behavior (focus trapping, portals, ARIA roles) is present just because the package is installed.

## Architecture

```
/app                          routes
/app/(app)/clients/[id]/income   declared quarterly sales entry (D26/D33) —
                               the only place income enters the system;
                               ?filingId= anchors which quarter is editable
/app/(app)/clients/[id]/tax-years/[taxYearId]/starting-figures
                               a mid-year client's starting figures (D56, brief #5f)
/lib/tax/                     computation engine — PURE, zero I/O. compute.ts:
                               computeQuarterlyForm/computeAnnualForm (D49, the
                               form-line, whole-peso-rounded 1701Q/1701A sheets),
                               extractFormSummary(), plus the old computeFiling,
                               now typed as Legacy*/LegacyFilingComputationResult
                               for the one path still on it (MIXED_INCOME annual)
/lib/workflow/                step template, state machine, due dates,
                               aging, docSlots.ts, completeness.ts,
                               election.ts, clientPackageEmail.ts,
                               groups.ts (the five-group rollup, D32;
                               prepareGroupBlockReason, brief #4b;
                               adviseClientBlockReason, D51, brief #5e),
                               clientTaxAdviceMessage.ts (step 4's message,
                               D51), adviceMessage.ts (live/saved assembly),
                               status.ts (filingStatusLabel/stepStatusLabel,
                               D63, brief #5i — every status pill's one
                               source of a plain label)
/lib/documents/                storage, naming, hashing, computationSheet.ts
                               (ensureComputationSheetSaved), computationSheetHtml.ts
                               (plain ink colours + the local font stack, D58)
/lib/reconciliation.ts         the single annual certificates-vs-declared-sales check
/lib/startingFigures.ts        starting-figures reads (D56, brief #5f)
/lib/vatThreshold.ts           VAT threshold monitor, includes starting income (brief #5f)
/lib/actions/                  Server Actions — the I/O boundary. quarterlySales.ts
                               (saveQuarterlySales, D33), form2307.ts
                               (addCertificate/deleteCertificate, D34, now
                               scan-on-save — D46), atcCodes.ts, payors.ts
                               (createPayorInline, brief #5a; fillPayorDetail, brief #5b),
                               startingFigures.ts (saveStartingFigures, D56, brief #5f),
                               workflowSteps.ts (reopenPreparedFiling, D50, briefs
                               #5d-#5f; unskipStep/reopenSkippedReceive2307, D60/D61,
                               brief #5i — markGroupDone is gone, deleted by the
                               same brief, D62), filings.ts (updateFilingOtherCredits,
                               D55, brief #5f)
/lib/dates.ts                  manilaCalendarDay(), formatManilaDate()
/lib/money.ts                  centsToPesos(), formatBreakdownAmount() (D59, brief #5g)
/components/                   next-action-control.tsx, computation-sheet-panel.tsx,
                               quarterly-sales-card.tsx, record-sales-step-card.tsx,
                               receive-2307-step-card.tsx, certificate-form.tsx
                               (brief #5a), workflow-step-card.tsx,
                               workflow-group-card.tsx, copy-textarea.tsx,
                               payor-name-field.tsx, atc-code-select.tsx,
                               atc-code-form.tsx, payor-form.tsx (brief #5a),
                               payor-details-dialog.tsx (brief #5b),
                               advice-message-card.tsx (step 4's collapsed
                               summary, D51, brief #5d), starting-figures-form.tsx,
                               other-credits-form.tsx (item 61, D55, brief #5f),
                               nav.tsx (the left-side menu, D58, brief #5g,
                               replacing the old top bar)
                               ui/ (plain Tailwind primitives, restyled brief #5g)
/app/fonts/plus-jakarta-sans/  Plus Jakarta Sans, committed into the repo and
                               loaded via next/font/local — never next/font/google
                               (D58, brief #5g; locked rule #7)
/prisma/                       schema, migrations, seed
/storage/                      gitignored document vault
/data/                         gitignored SQLite db
/scripts/                      one-off tools, not part of the app
/tests/
```

**`/lib/tax/` must never import Prisma, `fs`, `next/*`, or anything I/O.** Plain object in, plain object out.

**`lib/documents/computationSheet.ts` and `lib/workflow/clientPackageEmail.ts` are exactly where CLAUDE.md has always said** — confirmed present at those paths.

**No `lib/books/` and no `ChartOfAccounts`/`JournalEntry`/`ImportBatch`/`ImportMappingProfile`/`SalesTransaction` models.** All deleted as part of D25/D26. If you find a task or an old note referring to any of these, it predates the rework — check `CURRENT_STATE.md` before assuming it still applies.

## The income model — read this before touching anything money-related

**Gross sales come from one place only: the client's declared figure for the quarter** (`QuarterlySales`). Certificates contribute nothing to gross sales.

**A quarter's declared figure is the sum of per-customer rows (D33, brief #4b)** — `QuarterlySalesCustomer`, customer name + amount, added and removed freely. `QuarterlySales.grossSalesCents` is derived from these rows on every save (`lib/actions/quarterlySales.ts`'s `saveQuarterlySales`) — it is never itself an input field. `/lib/tax/` is unaffected: it still receives one summed gross figure per quarter. `noSalesThisQuarter` is a deliberate ₱0, distinct from a quarter with no row at all; `hasSalesRecordedForPeriod` is unaffected — it still keys on row existence. Draft (stores the rows, doesn't mark step 1 done) vs. Save (does both, via the same `markStepDone` the per-step control always used) — the quarter stays editable until its own filing's step 5 (`FILE_RETURN`) is `DONE`.

**The income page shows draft/final state and offers a real Edit/Cancel flow (D40, brief #4d).** The editable quarter's card names its own state at the top — no label if nothing's saved, "Draft saved [date] — not final. Step 1 is still open." for a draft, "Saved [date] — step 1 is done." once final. A final quarter opens **read-only** with an **Edit** button; Edit reveals the same form plus a **Cancel** button that discards unsaved changes and returns to read-only. **Saving an edited final quarter as a draft reverts step 1 to open** — supersedes D33's original "once done, further edits never undo it." A quarter that's only ever been a draft still opens directly editable, no toggle. A successful final Save leaves the income page and returns to the filing page automatically; Save as draft stays on the income page with a short confirmation instead. On the filing page, step 1's own card shows a "DRAFT" tag beside the total whenever it isn't final.

**A Form 2307 is authoritative for the withholding and nothing else.** It reports what one payor paid and withheld, and only ever sees income from payors who are withholding agents. Income from non-withholding clients and direct consumers appears on no certificate at all, and some clients issue no 2307 whatsoever.

There is no "convert a 2307 into a transaction" flow and there must not be one — that conversion is exactly what D26 removed.

**`QuarterlySales.quarter` includes `Q4`. `Filing.period` does not.** There is no Q4 return — October–December income is picked up by the annual filing. These are two different types with two different CHECK constraints. Do not merge them, and do not "tidy up" the apparent inconsistency.

Cumulative mapping: `Q1`→Q1 · `Q2`→Q1+Q2 · `Q3`→Q1+Q2+Q3 · `ANNUAL`→Q1+Q2+Q3+Q4.

A missing quarter is zero, not an error — but a filing whose OWN quarter has no `QuarterlySales` row must **say so in words**, distinct from a cumulative total that happens to be zero (`lib/filingComputation.ts`'s `hasSalesRecordedForPeriod`, keyed on `lib/tax/periods.ts`'s `ownSalesQuarterOf`). A silent `₱0.00` reads as a real answer and it is not one.

**There is no control of any kind over a declared income figure — say so plainly, don't invent a replacement.** Step 3 used to carry an acknowledgement that partially closed this gap: a required source-of-figure text field, plus an optional attachment for the client's own confirming message. Both are gone (briefs #4c and #4d, DECISIONS.md D37) — the bookkeeper made both calls deliberately, having watched the field in actual use. Once income is declared-only, nothing can be cross-checked against anything at the source level; the only surviving reconciliation, `lib/reconciliation.ts`, is annual certificates-vs-declared-sales — a sanity check, not a source-level one, and it was never a substitute for the field that's now gone. The per-quarter Notes field (`QuarterlySales.notes`) still exists and can hold anything she chooses to write, but nothing asks for an entry and nothing requires one.

**"Payors" (D44, brief #5a; named "Customers / payors" until brief #5b renamed it on screen) is a saved list, not a link.** `Payor` (one row per client: name, TIN, address, usual ATC code, active flag) is shared by step 1's payor field and step 2's payor field via one component (`components/payor-name-field.tsx`), so the same company doesn't get typed — and spelled — two different ways. Picking a saved entry only fills that one row/certificate; there is no foreign key from `QuarterlySalesCustomer` or `Form2307` to `Payor`, and there must never be one — a certificate still cannot affect gross sales.

**"Save … to payors" opens a dialog; a certificate can offer to fill a gap back onto the payor (D48, brief #5b).** `components/payor-details-dialog.tsx` — one dialog, used from both step 1 and step 2 — captures name (required) plus optional TIN/address/usual ATC in one go, so she doesn't have to wait for the first certificate to record them. A native `<dialog>`, not Radix (still unused/uninstalled in any load-bearing sense). Separately, `fillPayorDetail` (`lib/actions/payors.ts`) lets the certificate form offer to save a value back to the payor when that field is blank there — never when the payor already has a different value (D45's certificate-is-authoritative rule is unchanged).

**A certificate's ATC code is now a picker, and the rate comes from it (D43, brief #5a).** `AtcCode` has a maintenance screen (`/settings/atc-codes` — add/edit/deactivate, D19 unaffected: never invent a code or a rate). The certificate form's ATC field offers only active codes and fills the rate from the chosen code; she can still override the rate for one certificate, which sets `Form2307.rateOverridden` and keeps her value — the certificate is authoritative over the code, not the reverse. Payor TIN, payor address and ATC code are now required on a certificate (D45), validated server-side.

**The scan is part of saving a certificate, not a separate step afterward (D46, brief #5a).** `addCertificate` refuses to save without a file. A saved row's only remaining scan action is **Replace** (one-for-one — the old scan is soft-deleted, not accumulated).

**Starting figures cover a client joining the app mid-year (D56, brief #5f).** `StartingFigures` (one row per client-year) holds `latestOutsideReturn` plus the handful of figures typed once from a client's last return filed outside the app — item 55, item 51, items 57/58, item 56, the amount paid on that outside return, item 61 with a description, optional non-operating income. A period `latestOutsideReturn` names as outside gets **no `Filing` row generated at all** (`lib/workflow/filingGeneration.ts`'s `generateFilingsForClientYear` skips it) — that's what keeps it off the board and dashboard, not a filter. `Filing.filedOutsideApp` covers the rarer case where a row already existed before being named outside; such a row renders on the client page as an explicit "Filed outside the app" line, not hidden. Locked once the year's first in-app return is filed.

**Credits: items 55, 56 and 61 (D55, briefs #5e/#5f).** Item 61 (1701Q) / 63 (1701A) is one figure **per return** (`Filing.otherCreditsCents`/`otherCreditsDescription`), inheriting the previous filing's saved value (or the starting figures') until saved here, locked once filed — this superseded a brief #5e version that briefly lived as one figure per taxable year on `ClientTaxYear` before she asked for it to vary return by return. Item 55 (1701Q) / 57 (1701A) is display-only on step 3, entered only in the starting figures, and still appears in full on every return of the year (D12) — the Taxable-years table's own credit column/edit field are gone. Item 56 (1701Q) / 58 (1701A) is calculated from `Filing.amountPaidCents` on earlier filed returns — currently ₱0 for any quarter actually filed inside the app, since nothing writes that field yet; this is the Pay group's own build to close.

## The blocking rule — read this before touching the workflow

**The app blocks on documents it receives. It never asks the bookkeeper to prove she did something.**

| Category | Behaviour | Steps |
|---|---|---|
| Documents she **receives** from outside | Blocks `DONE` until attached | 2, 6, 7, 9, 10, 11 (both slots), 13, 14 |
| Actions she **performs** elsewhere | No slot at all | 4, 12, 16 |
| A document delivered **to someone else** | Optional, hidden, never blocking | 15 only |

**Step 2 (D35, brief #4b) blocks on its own terms, not one step-level slot.** It holds a variable number of certificate rows (`Form2307`, `claimedOnFilingId` pointing at this filing), each with its own scan (`Document.form2307Id`). Step 2 is `DONE` only once `Filing.certificatesAllReceivedAt` is set **and** every row has a scan — implemented in `lib/actions/workflowSteps.ts`'s `recomputeReceive2307Status`, called after every certificate add/delete and every scan upload/removal. Unlike step 1, this is a genuine two-way toggle: unticking "all received" reverts step 2 to not-done, so a late-arriving certificate can be entered before this filing is filed. Step 2's own doc-slot in `WorkflowStepTemplate`/`WorkflowStep` is now empty (`[]`) — do not re-add a step-level slot for it.

**Step 15 (eAFS) is a documented exception, not an oversight.** Its confirmation email goes to the client, not to the bookkeeper, and often never reaches her. Blocking would strand a filing on a file she cannot obtain; removing the slot would make a document she does sometimes receive impossible to keep. If you find one optional slot sitting among seven required ones, this is why. Leave it. Step 16's client email draft asks her to forward the eAFS confirmation, but only when it isn't already on file (`lib/workflow/clientPackageEmail.ts`) — the one moment in the cycle she's writing to that client anyway.

**The election check is the one other hard block** (`lib/workflow/election.ts`, `isElectionBlocked`, wired into `markStepDone`) and guards a wrong tax rate, not a missing file: an unconfirmed election may default to graduated rates, making a Q1 filing's computation wrong regardless of documents. Only Q1 is blocked.

**Waiting blocks exactly one thing:** waiting at step 13 blocks step 14, because a validation email cannot arrive before the acknowledgement it follows. One explicit dependency edge in `markStepDone`, never generalised — waiting at steps 10 and 14 must not block anything else.

**A document belongs to its step, not to the page.** Anything belonging to a step renders inside that step's card (`components/workflow-step-card.tsx`), not as a page-level panel. **Never expose a raw step code** (`PREPARE_RETURN`) in a user-facing label.

**The filing page combines two fixes for the same complaint** ("output shown ahead of the work it belongs to"): a next-action line and compact summary strip at the top (`components/next-action-control.tsx`) answer "what do I do now" without scrolling, and anything belonging to a step lives inside that step's own card rather than as a page-level panel at the bottom. Keep both — they answer different complaints from different test drives, not the same one twice. (The certificate cutoff and client confirmation panels these two fixes originally described are both gone — see D34 and D37 — but the two fixes and the reasoning for keeping them separate still stand.)

**A disabled control explains itself on hover, not with standing text (brief #4e).** A blocked per-step "Mark done" carries its reason as a `title` tooltip only; a group's own tooltip (on its Pending label, since brief #5i — D62) works the same way. Do not reintroduce a standing red or amber paragraph under a group header, under a per-step button, or under the next-action banner — that was the exact noise brief #4e removed, after it turned out to be rendering in three places at once for the same rule. The short amber "waiting on …" summary beside a group's name is the one piece of standing status text that stays. **One narrow exception (D47, brief #5a):** while step 2's "All certificates received" checkbox is ticked, Add and Remove are hidden (server-side too, not just in the UI) with one short line saying to untick first — it explains a state she just set herself, not a block on her, so it isn't the pattern D41 removed.

## The five groups (D32) — read this before touching the checklist or the board

The sixteen steps are wrapped in five groups: **Prepare** (1–4), **File** (5, 6, 7, 10), **Pay** (8, 9), **SAWT** (11–14), **Close** (15, 16) — `lib/workflow/groups.ts`. This is grouping only: it changes nothing about what any step requires, blocks, or does. **The blocking rule above is unaffected** — it just gets reported once per group instead of once per step's button.

**No group has a "Mark done" (D62, brief #5i, her decision) — do not add one back.** A group finishes only when its own steps do, one at a time on their own controls; there is no group-level click that resolves several steps at once, and `markGroupDone` no longer exists in the codebase. The group header reports status only: a non-clickable grey **Pending** label, its `title` tooltip naming the steps still open (e.g. "Step 2, step 3 and step 4 not done."), or a green **Done** pill once every step in it is Done or Skipped. *Why:* the old one-click button let her mark steps 3 and 4 done at once without actually doing either.

**Group 2 (File) is deliberately not contiguous, and that is correct — do not "fix" it.** The TRRC (step 10) sits with File, not with Pay (group 3, steps 8–9) between them, because the TRRC is eBIRForms' confirmation that the return was *received* — it confirms the filing, not the payment (`WorkflowStep.category` for step 10 has always been `FILING`). **Step numbers record when things happen; groups record what they belong to.** Do not renumber the TRRC to make the groups contiguous — that would place it ahead of payment in the list and imply she waits for BIR's confirmation before paying, which she does not.

**Group 3 (Pay) finishing before group 2 (File) is normal, not out-of-order.** She files, saves her evidence, pays, saves the proof — the TRRC lands days later. This must never raise a warning. On the board, a card sits in its earliest incomplete group *by group order*, not by raw step sequence, and carries that group's waiting state (e.g. "File — waiting on BIR, 12d") rather than reading as unfiled.

**Group membership is its own fixed lookup table, not `category` repurposed.** `category` matches groups 2/3/4 (`FILING`/`PAYMENT`/`SAWT`) exactly, but steps 4 and 16 are both `category: CLIENT_COMM` while belonging to different groups (Prepare and Close respectively) — reusing `category` outright would have merged them.

**Built in brief #4b (2026-09-21):** steps 1 and 2 are now self-completing, with step 2's scan requirement blocking (D33/D35) — see "The income model" and "The blocking rule" above. Prepare's own header is disabled — reads Pending, not a button — until both are resolved (`prepareGroupBlockReason` in `lib/workflow/groups.ts`, consulted inside `markStepDone`), the first real block Prepare has ever had. **Prepare's own collapsed-summary label was fixed in brief #4e** to name the specific thing outstanding ("waiting on quarterly sales" / "waiting on Form 2307" / both) instead of a generic "waiting on Client, 0d" — see "The blocking rule" above for the standing-text removal this was part of.

**Step 3 (Prepare computation) can no longer be started or skipped (D54, brief #5f, her decision: "it is the heart of the app").** `controlsMode="markDoneOnly"` on its card; `lib/actions/workflowSteps.ts`'s `skipStep` refuses `PREPARE_RETURN` server-side regardless of caller. Only Mark done remains. It now holds a credits box (item 55 read-only, item 61 editable — see "The income model" above) rendering **above** the computation sheet it generates.

**Step 4 (Advise client) is gated on step 3, and is no longer a waiting step (D51, briefs #5d-#5f).** No Start, no Mark waiting — `controlsMode="markDoneOnly"` here too. Its own Mark done is blocked until step 3 is Done, enforced server-side (`lib/workflow/groups.ts`'s `adviseClientBlockReason`, consulted inside `markStepDone` itself, not only by the group button) — it shows no message at all until then. The message (`lib/workflow/clientTaxAdviceMessage.ts`) comes in three versions (payable / quarterly overpayment / annual overpayment) and is saved exactly as sent when step 4 is marked Done.

**A change to the figures behind an already-prepared computation reopens steps 3 and 4 while the filing is unfiled (D50, briefs #5d-#5f, extended #5i).** `lib/actions/workflowSteps.ts`'s `reopenPreparedFiling` — called after a figures-changing final save of step 1, a draft save of a previously-final step 1, adding/removing a certificate, a saved change to item 61, or a saved change to the starting figures. **As of brief #5i, the same figures-changing step 1 saves also un-skip a Skipped step 2 (D61, `reopenSkippedReceive2307`), and undoing step 2's skip by hand is itself a reopening trigger (D60)** — see the paragraph on skipped steps below. A no-op save, Replace scan, and unticking "all certificates received" on its own do **not** reopen anything (the last of these was reversed mid-sequence — brief #5d's first version had it reopen too, brief #5e found that too eager). A filed filing (step 5 Done) is never reopened; the saved advice message is cleared when step 4 reopens, so its card rebuilds a live preview until step 4 is marked Done again.

**A group's header has two states, not a button (D62, brief #5i, superseding D53's three-state group button).** A non-clickable grey "Pending" label (the unresolved steps named as its hover tooltip, e.g. "Step 2, step 3 and step 4 not done.") while anything in the group is unresolved, or a green "Done" pill once every step in it is Done or Skipped. There is no clickable middle state and no group-level "Mark done" at all — see "The five groups" above. Prepare closes itself the moment all four of its steps resolve, same as every other group.

**The group counter counts Done + Skipped together, with a "N skipped" suffix (D60, brief #5i).** `NA` steps are excluded from both numbers. "4 of 4 · 1 skipped · Done" once a group with one skip finishes; "4 of 4 · Done" unchanged when nothing in it was skipped. *Why counting Skipped as resolved matters:* leaving it out of the numerator ("3 of 4 · Done") read as if a step had been missed, when a skip is a decision, not an omission.

**Skipped steps stay visible in their group, and can be undone (D60, brief #5i).** A skipped step renders in place, in step order, collapsed by default like Done, with a grey Skipped pill, its reason, and an **Undo skip** button. `unskipStep` (`lib/actions/workflowSteps.ts`) restores it to whatever its own rules say next — step 2 reruns `recomputeReceive2307Status` (via `reopenSkippedReceive2307`) rather than being forced to "Not started"; every other skippable step returns to `PENDING`. Refused once the filing's own step 5 is Done, same lock step 2's certificate list already has. **Which steps this applies to:** only steps that can be skipped at all — not step 1 (self-completing, never had Skip), not step 3 (D54 refuses it server-side), not step 4 (never had Skip either). Do not add an unskip path for any of these three. The top-of-workflow "Show N not applicable" toggle now covers `NA` steps only — a Skipped step is never behind it.

**The "waiting on …" label only shows for a step actually waiting right now (D52, brief #5d).** It keys on the step's live `WAITING_EXTERNAL` status, not the step template's permanent `isWaitingState` flag — the old version stayed stuck reading "waiting on X" beside an already-Done `RECORD_SALES`, `RECEIVE_2307`, `RECEIVE_TRRC`, `SAWT_ACK` or `SAWT_VALIDATION`.

**Still held for a later brief:** a derived group-level waiting state generally beyond Prepare (waiting elsewhere in the workflow is still per-step, surfaced only in the collapsed group's summary, unchanged from before grouping). See `CURRENT_STATE.md` for the fuller list.

## Coding conventions

- **Money is integer centavos.** Decimal.js for arithmetic. No `parseFloat`, `Number()` or `toFixed` on any money path. Display only via `centsToPesos()`.
- **Dates:** never extract with `getUTCDate()` / `getUTCMonth()` / `getUTCFullYear()`. Calendar-day comparisons go through `manilaCalendarDay()`. Elapsed time uses milliseconds. Display via `formatManilaDate()`. Codified in SPEC.md §4. *This bug class has appeared multiple times — treat it as a live hazard.*
- **No new dependencies without asking.**
- **No outbound network calls at runtime.** No CDN fonts, analytics, telemetry or error SDKs.
- **Never load fonts or other assets from the internet; store them in the repo (D58, brief #5g).** `app/fonts/plus-jakarta-sans/` was fetched once (`npm pack @fontsource/plus-jakarta-sans`) and committed with its OFL licence, loaded via `next/font/local` — `next/font/google` is exactly the outbound request the rule above forbids, since it fetches at every build or `dev` start, not just once at install.
- Validate with Zod at every boundary.

## Database rules

- `ActivityLog` is append-only. No hard deletes on financial records. `ActivityLog.note` (nullable `String?`, added brief #5i) carries a short human-readable note for a reopen or un-skip, alongside the usual before/after JSON snapshot.
- **Never hardcode a value the code is supposed to derive.**
  - *One deliberate exception:* frozen computation snapshots in the seed use hand-verified literal centavo integers, so they stay an independent check on the engine. Do not "fix" these.
- **A code-level fix does not reach rows already in the database.** The `WorkflowStepTemplate` upsert used `update: {}` on both pre-reconciliation branches, so reseeding over an existing database silently ignored every step-definition change. Fixed in this pass (the upsert now applies `update`, and stale step codes — e.g. the retired `RECORD_CRJ` — are deactivated on reseed). The class of bug stands: when changing a rule, say explicitly whether existing data needs a backfill, and offer a dry run.
- Migrations that add constraints should be verified to actually reject bad values.
- **While the database holds only seed data, destructive migrations are fine** — drop, migrate, reseed. No migration path needs preserving. **This licence expires when live data is entered in November 2026.**

## Business rules you must not quietly change

1. The 8% formula, the ₱250,000 deduction (full from Q1, never prorated, `PURELY_SELF_EMPLOYED` only), the cumulative approach, and the computation sheet's own whole-peso rounding at the items the BIR form itself rounds (D49) — money is still integer centavos everywhere else
2. The certificate credit-period rule (D34) — the filing it was entered under, locked once filed — and D11 (no amended returns), which is what makes that safe
3. `computationSnapshot` immutability once filed; edits raise an `AmendmentAlert`
4. Deadlines: Q1 May 15, Q2 Aug 15, Q3 Nov 15, Annual Apr 15. **No Q4 return exists.**
5. eAFS = adjusted due date + 15 days; early filing does not move it
6. Filing status derivation: `DONE`/`NA`/`SKIPPED` → `COMPLETE`
7. **No books of accounts at all.** CRJ, CDJ, General Journal and General Ledger are the client's responsibility. `lib/books/` and its models are gone — do not re-add them without a dedicated brief.
8. The income model, the blocking rule, and the `Q4` distinction, all above
9. No .DAT generation, no BIR API integration, no email sending
10. The archive's independence from the database
11. The "Payors" list's independence from income and certificates (D44) — no foreign key from `QuarterlySalesCustomer` or `Form2307` to `Payor`, ever
12. Fill-back (D48) only fills a blank payor field — never overwrites one it already has
13. **Only the 1701Q and the 1701A are built as form-line sheets (D49)** — `MIXED_INCOME`'s annual return (Form 1701) has no sheet and stays on the old, unrounded `computeFiling`/`LegacyFilingComputationResult` path
14. **Starting figures (D56) replace outside quarters, not a `Filing` row** — a period named already-filed-outside-the-app gets no `Filing` row at all; do not "fix" this into always generating one
15. **Fonts and other static assets are stored inside the repo and never fetched at build, dev-start, or runtime (D58)** — do not reintroduce a network-loaded font or asset

## Never invent BIR specifics

ATC codes, penalty rates, compromise schedules, form field orders. If you are not certain, **leave it empty and flag it** rather than producing something plausible. A wrong ATC code looks correct and gets filed. Unverified items carry `verifiedAgainstIssuance: false` — keep that pattern. **The ATC maintenance screen (`/settings/atc-codes`, D43, brief #5a) is where she adds and verifies codes herself — do not seed a code or a rate you have not been given, even now that a screen exists to hold them.**

## UI rules

Centered container ~1100px. Tables with aligned columns, not edge-pinned cards. Row text 14px, secondary 13px. Empty panels collapse to one muted line. Rows navigate to detail with a hover state. **Status colours: grey pending, purple in progress (was blue — her decision, D58, brief #5g), amber waiting, red overdue, green done.**

**A status pill always goes through a label helper; never render a `FilingStatus`/`WorkflowStepStatus` value directly (D63, brief #5i).** `lib/workflow/status.ts`'s `filingStatusLabel()` and `stepStatusLabel()` map every value to a plain, sentence-case word — never a raw enum, never CSS-uppercased. Apply this everywhere a status renders: the filing page, the board (cards and its status filter dropdown — the one place a raw code was actually found and fixed), and the client page's filings table. `Form2307`'s own status enum (on `/clients/[id]/form-2307`) is a separate, unrelated enum and was left rendering raw — out of scope, not an oversight.

**A left-side menu replaces the old top bar (D58, brief #5g).** `components/nav.tsx` — Dashboard, ungrouped; Work (Filings, Clients); Settings (Tax rule sets, Holidays, ATC codes), whose group heading itself links to the Settings hub page so it stays reachable. Icons from `lucide-react` — a dependency since before this brief, first actually imported here; don't add a different icon package.

**Colours are CSS variable tokens (`app/globals.css`, `@theme inline`), never a hard-coded hex value on a screen (D58, brief #5g).** The one deliberate exception is the generated computation-sheet HTML (`lib/documents/computationSheetHtml.ts`) — an archive document meant to outlast the app, so it uses plain ink/faint/line/amber/green hex values directly and the new font stack, with no dependency on the app's own stylesheet.

**The font is Plus Jakarta Sans, loaded locally (D58, brief #5g).** `app/fonts/plus-jakarta-sans/`, via `next/font/local` — see "Coding conventions" above for why never `next/font/google`. Tabular figures (`tabular-nums`) on money columns wherever amounts line up: the computation sheet, and the 2307/SAWT/tax-rule-set tables.

**An overpayment on the computation sheet's own final row shows in parentheses, never a plain positive figure (D59, brief #5g).** "(₱X)," labelled "… — overpayment," both on screen and in the generated HTML. Not coloured red or green — it's a figure, not a verdict. Step 4's own message already said "Overpayment" in words and is untouched.

**Density is not the goal; being operable is.** "Dense over pretty" was taken too far and produced a first test drive that stopped at step 4 of 16.

**Lead with the work, not the output.** The filing page opens with a next-action line naming the next step, then a compact summary strip, then the checklist — anything a step produces or needs (the computation sheet, step 2's certificate rows) sits collapsed inside the step it belongs to, not as a full-width panel ahead of or detached from the checklist. (The certificate cutoff control and the client confirmation panel this once also named are both gone — see D34 and D37 in DECISIONS.md.)

## Security

Will hold real TINs and income data under the Data Privacy Act from November 2026. **There is none in the application today** — the four clients (including `garcia-r`, the mid-year starting-figures sample added by brief #5f) are fictitious seed data. One real client's Q1 figures are reproduced in `tests/tax/realFilingQ1_2026.test.ts` (brief #4e, DECISIONS.md D42; figures updated by brief #5d, D49, to the form's own whole-peso amounts) — a committed test, amounts and taxpayer type only, no client name, TIN, payor name, or address. The earlier arrangement (a gitignored `scripts/real-fixture.local.ts`, read by `scripts/verify-real.ts`) is gone; confirmed 2026-09-26 that fixture had never actually existed on any reachable machine, including the bookkeeper's own laptop. Single `.env` password is adequate for localhost and nothing more. Never commit `data/`, `storage/`, or any `*.local.ts` fixture.

## How to approach changes

- **Do only what was asked.** Do not refactor, reformat, rename or "improve" code outside the scope of the task. If you notice something wrong nearby, report it — do not fix it unsolicited.
- **Verify identifiers against the working tree before editing.** Briefs describe intent and often get names wrong — and, as this pass found, can get the branch relationship itself wrong. `git log`/`git merge-base` cost nothing; being wrong about them cost a whole extra rework pass.
- If a request is ambiguous, ask. Do not guess and build.
- Prefer fixing the root cause over the symptom.
- **If your own earlier work or summary turns out to have been wrong, say so directly.** This has happened repeatedly and the correction was always more valuable than the original claim.
- **Do not report a phase, feature, or branch's contents as complete without opening the files.** One summary claimed all of Phase 4 was finished when none of it existed; a later reconciliation claimed Phase 4 was never built when it had been; a documentation brief claimed two branches were stacked when they were siblings. Check the tree before writing a status line.

## How to test

- Tests first for anything in `/lib/tax/` — write them, show them failing, then implement.
- Tax tests use inline fixtures. **Never read seed data or the database.**
- Every bug fix gets a regression test verified to fail under the old code.
- Run the full suite, typecheck and build before reporting done. On a fresh database, run `npx tsx prisma/seed.ts` first — the suite depends on seeded `TaxRuleSet` rows.
- **`tests/tax/realFilingQ1_2026.test.ts` is the real-figures regression guard.** It reproduces one real client's filed Q1 2026 return, matching the actual filed form's own line items and whole-peso rounding (D49, brief #5d) — gross ₱332,933.90, item 49 ₱332,934.00, item 53 (taxable base) ₱82,934.00, tax due ₱6,635.00, item 58 CWT ₱16,646.70, total credits ₱16,647.00, overpayment (₱10,012.00) — as an ordinary committed test with an inline fixture and no client-identifying data (no name, TIN, payor name, or address). **These are the form's own whole-peso figures, not the centavo-exact figures this test asserted before brief #5d** (tax due ₱6,634.71, overpayment ₱10,011.99 — the old numbers are wrong now, don't resurrect them). It runs with the rest of the suite; there is no separate script and no local fixture file (brief #4e — the previous `scripts/verify-real.ts`/`scripts/real-fixture.local.ts` arrangement never actually ran anywhere, since the local fixture was never present on any reachable machine).
- For UI work, do a live walkthrough against the dev server. **Do not report a page as verified if you did not load it.**
- A passing suite says nothing about whether a screen is usable. The first test drive stopped at step 4 of 16 with every test green.

## Convenience

- `Start Bookkeeping App.bat` at the repo root — double-click launcher (untracked).
- `_test-files/` at the repo root — disposable dummy documents for test drives (untracked).
- `npm install` writes an `allowScripts` block into `package.json`. It is machine-local and blocks branch switches; the user stashes before checking out.
- **`npm install` also regenerates the Prisma Client now**, via a `postinstall` script (D57, brief #5f) — she'd hit a stale-client error twice after pulling a migration without a separate `npx prisma generate`.
- **The update routine, in order, after pulling:** close the app · `git stash` · `git pull` · `npm install` · `npx prisma migrate deploy` (only when a brief added migrations) · `npx tsx prisma/seed.ts` (only when a reseed is actually wanted — it replaces all data).
- **`git fetch origin <branch>` before trusting a local `git log`** is now the first step of every pass, not just before a branch-relationship check — a local checkout has been caught behind the remote twice now (see `CURRENT_STATE.md`'s "Where the code is").

## Current priorities

See `CURRENT_STATE.md`. In short:

1. **Walk the File group (steps 5, 6, 7, 10), then the Pay group (steps 8, 9).** File has never been walked on its own. Pay's own build, once walked: amount paid (feeding item 56/58), and the prior-year carry-over from a client's own Annual overpayment. The Prepare group (steps 1-4) is now closed — walked and fixed across briefs #4c-#4e, #5a, #5d-#5f, #5g's look, and #5i's finish.
2. **Before live data in November:** back up `data/app.db`, `storage/`, and the `.env` file (she raised this 2026-09-26, deferring the how until real data exists).
3. Build the **document archive browse view** — client → year, with a whole-year zip. It serves what she named as the most important thing the app does, and it is the only genuinely new build left in the backlog.
4. Confirm the ATC codes against BIR at `/settings/atc-codes` (brief #5a).
5. **Decide on the live Q3 cycle** — 1701Q due **November 16, 2026**. For each real client: add the client, add the tax year, enter the starting figures (brief #5f — every current client joins mid-year), then generate filings. Excel remains the master until she decides otherwise.
