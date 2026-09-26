# CURRENT_STATE.md

*Living snapshot. Replace stale content rather than appending.*
*Last reconciled: 2026-09-26 — brief #5a, on top of the documentation pass (brief #4f) through briefs #4c-#4e.*

---

## Where the code is

**Working branch: `claude/serene-hypatia-rs67pw`, cut fresh from `claude/admiring-curie-r15qu9` for brief #5a.** The session's designated branch name had no prior work on it (its remote copy had been deleted and its local tip sat at an old, pre-rework commit, well behind `admiring-curie`) — verified with `git log`/`git merge-base` before writing any code, per the standing rule below. Since this brief itself names `admiring-curie-r15qu9` as the branch its instructions describe, and `admiring-curie` is the tip of the real lineage (see the paragraph below), the designated branch was reset to `admiring-curie`'s tip (a fast-forward — it carried nothing of its own to lose) and brief #5a's work landed on top of that. State plainly which branch a pass landed on and what it was cut from — don't assume the reader can reconstruct it from a name alone.

**`claude/admiring-curie-r15qu9` was, and remains, the real lineage through brief #4g.** Verified against `git log`/`git merge-base` for the #4f pass: it was cut from `claude/steady-noether-3xq7`, the branch carrying brief #4a's grouping work (D32) — `steady-noether`'s own tip commit is `bfd7303` ("Wrap the sixteen workflow steps in five groups"), and that same commit sits directly in `admiring-curie`'s own linear history as its branch point. The reconciliation branches from the previous pass (`claude/peaceful-goldberg-hsh6yo`, `claude/laughing-darwin-wcnh8u`) and the base before them (`claude/elegant-clarke-vu1xyd`) are all further back in this same line and superseded; there is nothing left to build on there.

**Briefs #4b through #4g all landed on `admiring-curie` itself — no new branch per pass.** This differs from the general rule stated below (Claude Code normally creates a new branch every pass); across this whole sequence of small, fast-turnaround briefs it did not, each one committing directly onto `admiring-curie` and pushing. Brief #5a is the first pass in this sequence to actually cut a new branch, and only because the session's designated branch name forced the question. Verify this expectation against `git log` before assuming a new branch exists (or doesn't) for the next brief too.

**Claude Code creates a new branch for every pass and does not announce the name unless asked, as a general rule.** After any Claude Code run: `git fetch --all` then `git branch -a`, and look for a `claude/...` branch you do not recognise. Ask it to state the branch it worked on AND the branch it cut from — the branch-reconciliation pass (D31) exists because a branch relationship was asserted without being checked.

**`npm install` writes an `allowScripts` block into `package.json`** (npm's build-script allowlist for prisma, esbuild, sharp). It is machine-local and regenerates itself, and blocks every branch switch. `git stash` before checking out is now part of the routine.

---

## What this application is

**A filing manager, not an accounting system.** Four layers, with a strict rule about who authors what:

| Layer | Authored? | Role |
|---|---|---|
| Income record | Yes | The client's declared gross sales per quarter — the sum of per-customer rows, derived, never typed directly (D33). The only place money enters. |
| Computation | **Never** | Pure derivation. 8% cumulative. |
| Checklist | Marks only | A map of where you are. Blocks only on documents received from outside (D27). |
| Document archive | Yes | For a declared-income client, substantially the whole substantive record. |

All four share one key: client × taxable year × period.

**Trello's legibility, none of its flexibility.** The cycle is identical every quarter for every client. No card creation, no custom steps, no drag-to-reorder, no board configuration.

---

## Built and working

**Phases 1–3** — Prisma schema and migrations, client CRUD, `ClientTaxYear`, `TaxRuleSet` and `Holiday` settings, single-password auth. Tax engine (`/lib/tax/`, pure, unaffected by either rework). Form 2307 register. Workflow engine, document vault with SHA-256 and enforced naming. Dashboard with six panels. Per-step due dates. Filing package zip. (The board is now five columns, not sixteen — see brief #4a below.)

**Declared-sales income model (D25/D26)** — `QuarterlySales` model, `Q1`–`Q4` as a distinct type from `Filing.period`. `SalesTransaction`, the CRJ generator (`lib/books/`), `ChartOfAccounts`/`JournalEntry`, `ImportBatch`/`ImportMappingProfile` all deleted — confirmed absent from the schema and the tree. Form2307 reduced to a credit record. Income entry UI at `/clients/[id]/income`, four cards (Q1–Q4) per taxable year. The reconciliation is a single annual certificates-vs-declared-sales check (`lib/reconciliation.ts`).

**The election hard-blocker** — `lib/workflow/election.ts`'s `isElectionBlocked`, wired into `markStepDone`: a Q1 filing whose election isn't confirmed `ELECTED` cannot be marked `DONE` on any step. Confirmed present and tested (`tests/workflow/election.test.ts`).

**The corrected blocking rule (D27–D30)**, re-applied onto the income model above:
- Steps 6, 7, 9, 10, 11 (both slots), 13, 14 block `DONE` on a missing document; steps 4, 12, 16 carry no slot at all; step 15 (eAFS) is optional and collapsed behind a disclosure.
- Step 1 is `RECORD_SALES` ("Record quarterly sales"), linking to `/clients/[id]/income` — the real declared-sales form, since it exists on this base (unlike on `laughing-darwin`, where it pointed at the pre-existing transactions page for lack of anything better). Step 2 is `RECEIVE_2307`, its own certificate-scan slot made optional — superseded by D35, see brief #4b below.
- Step 13 → 14 is a single explicit dependency check in `markStepDone`.
- Step 3 (`PREPARE_RETURN`) generates its own computation sheet as HTML into the vault on completion, via `lib/documents/computationSheet.ts`'s `ensureComputationSheetSaved` (idempotent, frozen-aware — a filed filing's saved copy is never regenerated) — no upload. **As of brief #4c/#4d it carries nothing else** — the acknowledgement's source-of-figure field and the optional client-confirming-message slot (`client_confirmation_evidence`) this bullet used to describe are both gone; see "Built and working, #4c–#4e" below and PROJECT_MASTER.md.
- Step 16 offers a package-download button and a copyable, auto-filled client email draft (`lib/workflow/clientPackageEmail.ts`), including a line asking the client to forward the eAFS confirmation, shown only when step 15's slot is still empty.
- The computation sheet renders inside step 3 rather than as a page-level panel at the bottom (the certificate cutoff and client-confirmation panels this bullet also used to name are both gone — see below).
- The "documents not yet attached" note is limited to `DONE`/`IN_PROGRESS` steps and covers every empty slot on them, required or optional (`lib/workflow/completeness.ts`) — empty on a fresh filing, dismissible, reappears if a new gap opens.
- "No sales recorded for [period] [year]" renders in place of a computed `₱0.00` wherever this filing's own quarter has no `QuarterlySales` row yet — the summary strip, the computation sheet panel, and the generated computation-sheet HTML file all check this the same way (`hasSalesRecordedForPeriod`, keyed on `ownSalesQuarterOf`), distinct from a cumulative total that's merely zero.
- The `WorkflowStepTemplate` seed upsert now actually applies `update` (was `update: {}` on both source branches) and deactivates stale step codes.

**Kept from `peaceful-goldberg`, unaffected by the reconciliation:** the next-action line and summary strip at the top of the filing page (`components/next-action-control.tsx`), now also disabled with the same blocking reason as the checklist card below it rather than only failing after a click.

**Validated against reality** — a real client's actual Q1 2026 figures reproduce through `computeFiling` to the centavo (gross ₱332,933.90, taxable ₱82,933.90, tax due ₱6,634.71, CWT ₱16,646.70, overpayment ₱10,011.99). **As of brief #4e this is confirmed by a committed test, `tests/tax/realFilingQ1_2026.test.ts`, that runs with every full-suite invocation** — not carried over from an earlier pass's notes and not dependent on a local fixture. Say both halves plainly: the figures ARE confirmed now, by a test that actually runs, and the previous arrangement (`scripts/verify-real.ts` reading a gitignored `scripts/real-fixture.local.ts`) never once ran anywhere — that local fixture never existed on any machine this project has reached, including the bookkeeper's own laptop (confirmed 2026-09-26).

**The sixteen steps wrapped in five groups (brief #4a, D32)** — Prepare, File, Pay, SAWT, Close (`lib/workflow/groups.ts`). Deliberately narrow: nothing about what a step requires, blocks, or does changed.
- One "Mark done" per group (`lib/actions/workflowSteps.ts`'s `markGroupDone`), marking every unresolved step in the group at once by calling the existing per-step `markStepDone` in ascending sequence — so the election hard-blocker, the step 13→14 dependency, and `SEND_CLIENT_PACKAGE`'s package-readiness check all still apply exactly as before, unchanged and un-duplicated.
- Groups 2/3/4 (File/Pay/SAWT) match the `FILING`/`PAYMENT`/`SAWT` categories exactly; steps 4 and 16 (both `CLIENT_COMM`) split across Prepare and Close respectively, so group membership is its own lookup table, not `category` repurposed.
- Group 2 (File: steps 5, 6, 7, 10) is deliberately not contiguous — the TRRC sits with File, not Pay (group 3, steps 8–9), because it's eBIRForms' confirmation of the filing, not of the payment. Verified live: a filing that's filed and paid but still waiting on the TRRC sits on the board under "File — waiting on BIR, 12d," not looking unfiled, while Pay shows fully Done — completing Pay first raised no warning anywhere.
- Filing detail page (`app/(app)/clients/[id]/filings/[filingId]/page.tsx`): the flat 16-step list is now five collapsible `WorkflowGroupCard`s, each showing progress, what's outstanding, and a disabled-with-reason "Mark done" while a required document is missing. The group containing the filing's next step opens by default; expanding any group exposes every per-step control (attach, skip with reason, mark waiting, start) unchanged. Steps within a group render in numeric order (confirmed: TRRC renders last inside File).
- Board (`app/(app)/filings/page.tsx`): five columns, not sixteen. A card sits in its earliest incomplete group (group order, not step sequence) and carries that group's waiting label.
- 16 new tests (`tests/workflow/groups.test.ts`, plus additions to `tests/actions/workflowSteps.test.ts`); full suite, typecheck, and build all verified.

**Steps 1 and 2 rebuilt, self-completing, and Prepare's first real block (brief #4b, D33-D35, 2026-09-21)** — she walked the five-group structure and asked for this next:
- **Step 1 (`RECORD_SALES`)** — declared sales is now per-customer rows (`QuarterlySalesCustomer`), summed into `QuarterlySales.grossSalesCents` on every save (`lib/actions/quarterlySales.ts`'s `saveQuarterlySales`), never itself typed. Rows add/remove freely. `noSalesThisQuarter` records a deliberate ₱0. Save as draft stores the rows without marking step 1 done; Save does both, reusing the existing `markStepDone` (so the election hard-blocker still applies). The step 1 card (`components/record-sales-step-card.tsx`) has no manual controls left at all — status and the quarter's total are fully derived. **Brief #4d changed "once done, further edits never undo it" — see below.**
- **The income page** (`app/(app)/clients/[id]/income`) now takes an optional `?filingId=`: opened from a filing, only that filing's own quarter is editable (`QuarterlySalesCard`, rebuilt for per-customer rows), every other quarter this taxable year renders as a read-only table (quarter, customers, total) with a link to its own filing; opened without one (e.g. from the client page), every quarter renders the same read-only way. A "Back to filing" button returns to where it was opened from. **The table's "source" column named here was removed in brief #4c, along with the field it displayed.**
- **Step 2 (`RECEIVE_2307`)** — one row per certificate, entered here (`components/receive-2307-step-card.tsx`, `lib/actions/form2307.ts`'s `addCertificate`/`deleteCertificate`), not on a separate register screen. Each row: payor, income amount, tax withheld, its own scan (`Document.form2307Id`); the rest of `Form2307`'s existing fields sit behind "more." (**A "date received" field was here too at this point in the project's history — removed in brief #4d, see below.**) `Filing.certificatesAllReceivedAt` backs the "All certificates received" checkbox. Step 2 is `DONE` only once that's ticked **and** every row has a scan (`lib/actions/workflowSteps.ts`'s `recomputeReceive2307Status`) — a genuine two-way toggle, unlike step 1: unticking reverts to not-done so a late arrival can be added before filing. Skip (with a written reason) is the only manual control left on this step.
- **The old Form 2307 register** (`/clients/[id]/form-2307`) is now read-only — its entry form and `/form-2307/new` route are gone. It still shows the annual reconciliation and the SAWT keying-worksheet link, and each row now links to the filing it was claimed on.
- **The certificate cutoff is gone (D34, supersedes D10).** `Filing.certificateCutoffOverride`, `resolveCertificateCutoffDate()`, and every `dateReceived`-vs-cutoff comparison are removed. A certificate now counts in the filing whose step 2 it was entered under (`Form2307.claimedOnFilingId`, set once, never reassigned) and every later period in the same taxable year (`lib/tax/cwt.ts`'s `sumCwtThroughPeriod`, now period-keyed, not date-keyed). Locked once that filing's step 5 is `DONE`. Confirmed unaffected: the annual certificates-vs-declared-sales check (`lib/reconciliation.ts`) — it already ran over the whole taxable year. `lib/sawt/eligibleCertificates.ts` and `lib/actions/sawt.ts` were updated to the same period-keyed logic so SAWT batching stays consistent with the new rule.
- **Prepare's own group "Mark done"** now only ever has steps 3-4 left (steps 1-2 self-complete) and is disabled until step 1 is Done and step 2 is Done or Skipped (`lib/workflow/groups.ts`'s `prepareGroupBlockReason`, enforced both client-side on the button and server-side in `markGroupDone`) — Prepare's first real block since grouping. **The "plain-language reason" this bullet used to name is gone — see brief #4e below.**
- Seed updated: sample clients' `QuarterlySales` rows carry per-customer rows (one client's Q1 split into two, to demonstrate the feature); the TY2026 cycle's certificates carry `claimedOnFilingId` pointing at the filing they were seeded under, with `certificatesAllReceivedAt`/`finalizedAt` set to match steps 1/2 being Done.
- New tests: per-customer sum, draft vs. Save, step 1/2 self-completion, step 2 blocking on a missing scan, step 2 locking after filing, Prepare disabled until 1/2 resolved (`tests/actions/quarterlySales.test.ts`, `tests/actions/form2307.test.ts`, additions to `tests/workflow/groups.test.ts` and `tests/actions/workflowSteps.test.ts`); `tests/tax/cwt.test.ts` and `tests/filingComputation/certificateAssignment.test.ts` (replacing the old cutoff test) rewritten for D34. Full suite, typecheck, and build all verified.

**Fixes from the bookkeeper's walkthrough of brief #4b's Prepare group (brief #4c, 2026-09-21/22):**
- **Step 3's own "Mark done" now enforces the steps-1/2 gate server-side, not just via the group button** (`markStepDone` in `lib/actions/workflowSteps.ts` now consults the same `prepareGroupBlockReason` the group button used) — closes a bypass where calling the per-step action directly skipped the check entirely. A regression test proves it, confirmed to fail under the pre-fix code.
- **The `PREPARE_RETURN` source-of-figure field is removed** from the income page and from step 3's acknowledgement, along with the "source" column in the read-only other-quarters table (D26/D27's original field — see D37, and PROJECT_MASTER.md's "There is no control over a declared income figure" section).
- **Step 2's certificate form is fully labelled** — every field has a visible `<label>`, not placeholder text alone. "Period covered — from/to" moved into the main form (was behind "more"), pre-filled from the filing's own quarter, still editable. "Rate (bps)" became "Rate (%)" with percent entry, converted to basis points at the action boundary via Decimal.js (`lib/money.ts`'s `percentToBps`) — no float arithmetic. A missing-space rendering bug between "Attach scan" and "More" on a saved certificate row was also fixed. `dateReceived` was investigated for removal at this point but kept — the SAWT worksheet and the annual reconciliation both still read it; see brief #4d below for where it actually went.

**Fixes from the bookkeeper's walkthrough of brief #4c (brief #4d, 2026-09-22):**
- **The income page shows draft/final state and offers a real Edit/Cancel flow (D40).** The editable quarter's card names its state at the top: no label if unsaved, "Draft saved [date] — not final. Step 1 is still open." for a draft, "Saved [date] — step 1 is done." once final. A final quarter opens read-only with an Edit button; Edit reveals the form plus a Cancel button that discards unsaved changes. Saving an edited final quarter as a draft now reverts step 1 to open — superseding brief #4b's original "once done, never undo it." A draft-only quarter still opens directly editable. A final Save now returns to the filing page automatically; Save as draft stays put with a short confirmation. Step 1's own card carries a "DRAFT" tag beside the total while it isn't final.
- **Step 2's "All certificates received" checkbox is conditional on having at least one row (D39).** Zero rows: only "Add certificate" and "Skip" show. One or more rows: the checkbox shows, Skip is hidden. Removing the last row reverts to the zero-row state and unticks the checkbox if it had been ticked.
- **Step 3's client-confirmation box is removed entirely (D37, completing what #4c started).** The yes/no "have you confirmed all receipts are accounted for" question, its optional note, the Confirm button, and the optional attachment slot (`client_confirmation_evidence`) are all gone — `Filing.receiptsAcknowledgedAt`/`receiptsAcknowledgedNote` are dropped from the schema (confirmed absent from `prisma/schema.prisma`, 2026-09-26). Step 3 now holds only the computation sheet it generates itself. Checked and confirmed: nothing else (blocking, the next-action line, the filing package, the completeness note) depended on this acknowledgement.
- **`dateReceived` is removed from `Form2307` entirely (D38).** Its last two readers were switched first: the SAWT keying worksheet now sorts by `payorName`, then `payorTin`; the annual certificates-vs-declared-sales check needed no code change, since it already keyed on `Form2307.taxableYear` (set from the filing at entry) rather than a date — a regression test proves a certificate entered under the 2025 ANNUAL filing counts in 2025, not 2026. The field is gone from the certificate form, the saved row, the schema, the seed, and every test.

**Fixes from the bookkeeper's walkthrough of brief #4d (brief #4e, 2026-09-26):**
- **All standing block-reason text is removed from the checklist (D41).** The identical explanation was rendering in up to three places at once for the same rule: under a group's header, under a disabled per-step "Mark done," and under the top-of-page "Next action" banner (`components/next-action-control.tsx` — a third spot found during this brief) — plus a red "Missing required documents: …" line on File/Pay/SAWT using the same mechanism. All of it is gone; every disabled "Mark done" now carries the reason as a `title` tooltip instead. The rules and their server-side enforcement are unchanged — only where the explanation displays. The short amber "waiting on …" summary beside each group's name is unaffected and is the one piece of standing status text left.
- **Prepare's own waiting summary now names what's outstanding** ("waiting on quarterly sales" / "waiting on Form 2307" / both) instead of a generic "waiting on Client, 0d" that didn't say which of its two self-completing steps was the holdup.
- **Checked and left alone:** the separate "N documents not yet attached" note (`lib/workflow/completeness.ts`) — a different mechanism (gaps on `DONE`/`IN_PROGRESS` steps, dismissible), not one of the removed lines.
- **`scripts/verify-real.ts` and `scripts/real-fixture.local.ts` are both gone (D42)**, replaced by `tests/tax/realFilingQ1_2026.test.ts` — see "Validated against reality" above and "Known limitations" below.

**Fixes from the bookkeeper's walkthrough of step 2 (brief #5a, 2026-09-26):**
- **ATC codes get a maintenance screen; the rate is a property of the code (D43).** `/settings/atc-codes` (add/edit/deactivate — no hard delete). The certificate form's free-text ATC box and separate rate box are both gone, replaced by a picker of active codes (`components/atc-code-select.tsx`) that fills the rate from the chosen code's own `rateBps`. The rate stays visible and editable; typing a different one sets `Form2307.rateOverridden` and keeps her value. `verifiedAgainstIssuance` shows plainly everywhere a code appears (list, edit form, picker). No codes were seeded — WI010/WI011 stay exactly as before, both unverified.
- **"Customers / payors" (D44) — a saved per-client list (`Payor` model), shared by step 1's customer field and step 2's payor field, never linked to either's numbers.** Picking a saved entry autofills TIN/address/ATC on step 2 (name only on step 1) via one shared component (`components/payor-name-field.tsx`, a native `<datalist>` — free typing still works). Typing an unrecognized name offers to save it inline (`createPayorInline`, `lib/actions/payors.ts`); `/clients/[id]/payors` covers edit/deactivate but isn't the only way in. No foreign key from `QuarterlySalesCustomer` or `Form2307` — confirmed no path for a certificate to affect gross sales. Seeded a few starter entries per sample client (`seedPayors` in `prisma/seed.ts`).
- **Payor TIN, payor address and ATC code are now required on a certificate (D45)** — validated server-side (`lib/validation/form2307.ts`) as well as on the form. The "more fields" disclosure is gone; everything that was behind it is now in the main form (`components/certificate-form.tsx`, replacing the inline form that used to live in `components/receive-2307-step-card.tsx`).
- **The scan is part of saving the certificate (D46).** `addCertificate` (`lib/actions/form2307.ts`) refuses to save without a file, attaching it in the same action via a helper factored out of `uploadDocument` (`lib/actions/documents.ts`'s `saveDocumentForStep`, now shared by both). A failed scan save hard-deletes the just-created certificate row rather than leaving an orphan. A saved row's only remaining scan action is **Replace** — one-for-one, the prior scan soft-deleted, never accumulating.
- **Three entry-form/collapse fixes (D47):** the add-certificate form now closes back to an "Add certificate" button after a save (it used to stay open, permanently blocking step 2's own collapse); step 2 collapses to a summary line ("N certificates · ₱X withheld") once Done or Skipped, with a "Show rows" link; and while "All certificates received" is ticked, Add and Remove are hidden (not just disabled), server-side as well as in the UI, with one short line saying to untick first.
- New tests: `tests/actions/payors.test.ts` (the Payor data layer a picker's autofill depends on); `tests/actions/form2307.test.ts` gained cases for rate-fill-with-override, the three new required fields refused server-side, no-scan-no-save, the all-received Add/Remove lock, and Replace scan restoring a step that lost its only scan; `tests/reconciliation/annualCertificatesVsSales.test.ts`'s existing `addCertificate` call was updated for the new required fields and now provisions real `WorkflowStep` rows (`generateFilingsForClientYear`) since `addCertificate` needs its own `RECEIVE_2307` step to attach the scan to. Full suite, typecheck, and build all verified.
- **Not tested by this suite:** the actual browser-side autofill (picking a saved payor, or an ATC code, filling the visible fields) runs in `components/payor-name-field.tsx`/`components/atc-code-select.tsx`, client-side JS with no test-library tooling in this repo to exercise it — verified instead by a live walkthrough against the dev server (see "How to test" in CLAUDE.md).

---

## Test drives

**First — 2026-09-19.** Stopped at step 4 of 16, on the base build. *"The app is difficult to navigate and follow."* Three requirements rejected outright, all of them demands for self-produced documents. Produced D24.

**Second — 2026-09-20, on `peaceful-goldberg`.** Walked all sixteen steps for the first time. Produced D25, D26 (income model), then D27–D30 (blocking rule, step order, waiting dependency, orphaned panels) from a follow-up walkthrough of that same build.

**Third — never captured.** Referenced as "in progress" in the brief that requested the branch reconciliation (2026-09-20 evening); six passes and six days later, nothing in the repo has ever recorded its findings. Treated here as never captured, not as still pending — stop carrying it on any future to-do list.

**Fourth — 2026-09-21, the bookkeeper walked the five-group structure (brief #4a).** Produced brief #4b directly: per-customer income rows (D33), the certificate credit-period rule (D34, supersedes D10), and step 2 becoming a real block (D35) — see "Built and working" above.

**Fifth — 2026-09-21/22, walked brief #4b's rebuilt Prepare group (produced brief #4c).** Found: step 3's "Mark done" could bypass the steps-1/2 gate by clicking it directly, not just the group button; the source-of-figure field and an unlabelled, confusing certificate form needed fixing. Produced the server-side fix, D37's first half (source-of-figure field removed from the income page and step 3), and the labelled/relabelled certificate form (D38's percent-rate conversion, among others).

**Sixth — 2026-09-22, walked brief #4c's fixes (produced brief #4d).** Found: the income page gave no sign of whether a save was a draft or final; step 2's checkbox made no sense with zero certificates; the client-confirmation box on step 3 should go entirely; `dateReceived` should finally come out now that its last two readers could be switched. Produced D37 (completed), D38, D39, D40.

**Seventh — 2026-09-26, walked brief #4d's fixes (produced brief #4e).** Found: the same block-reason sentence appearing in up to three places on the page at once, and Prepare's own waiting summary saying "waiting on Client, 0d" without naming which of two things was actually the holdup; also, that the real-figures fixture had apparently never existed anywhere reachable, including the bookkeeper's own laptop. Produced D41 and D42.

**Eighth — 2026-09-26, walked step 2 itself (produced brief #5a).** Found: the free-text ATC code and separately-typed rate could disagree with each other; the same payor gets typed twice (once as a step 1 customer, once as a step 2 payor) with no shared list; payor TIN/address/ATC weren't actually required despite mattering; the scan was a separate step after saving a certificate instead of part of it; the add-certificate form never closed after saving, which is what made step 2 impossible to collapse; and Add/Remove needed to be locked out while "all certificates received" is ticked. Produced D43-D47.

---

## Not built

**The document archive browse view** — client → year, with a whole-year zip. Still the only genuinely new build in the backlog, and it serves what the bookkeeper named as the most important thing the app does.

**Remainder of Phase 4's original intent, now moot or superseded:** the SAWT batch module, Alphalist keying worksheet, and XLSX export ARE built (`lib/sawt/`, using `exceljs`) and unaffected by either rework. A calendar view is not built.

**Phase 5, deferred by decision:** email/IMAP integration, multi-user, .DAT generation, importers.

**Outstanding smaller items:**
- Per-step prep targets — all prep steps share `internalFilingTarget`, so every prep row shows the same date.
- PDF manifest in the filing package — ships as text, deliberate (D22).
- `SPEC.md` still describes the pre-rework system and contradicts the build in several places — see its dated banner for exactly which sections and why.

---

## Needs the bookkeeper's review

1. **ATC codes** — only WI010 and WI011 seeded, both `verifiedAgainstIssuance: false`. Must be confirmed against the current BIR list before live use. She can now do this herself at `/settings/atc-codes` (brief #5a, D43) — no code change needed, just the confirming and ticking "Verified."
2. **SAWT keying worksheet field order** — built, not yet checked against the actual Alphalist Data Entry Module's own field order.
3. **Which clients are certificate clients and which declare only** — affects nothing structurally now that both paths are unified through declared sales, but worth recording.

---

## Open questions

- **Revenue recognition basis** — assumed collection. Recent legislation has shifted services toward recognition on billing. A per-client toggle was proposed, not built. Still determines which quarter a peso lands in.
- **eAFS on quarterly filings** — included for all periods and skippable per filing; whether genuinely required quarterly remains open.
- **SAWT/eSubmission deadline** — configurable, defaults to the return deadline, never independently confirmed. (The eAFS deadline is settled: adjusted due date + 15 days.)

---

## Known limitations

- Late-filing penalty calculator exists but **self-disables** — surcharge and interest rates are `null`, no compromise schedule, no verified BIR figures.
- Seed `waitingSince` timestamps are relative to wall-clock time at seed run, so ageing dates shift on every reseed. Expected.
- No PDF generation anywhere.
- **For a declared-income client nothing can be cross-checked against anything** except the annual certificates-vs-declared-sales check. The client's stated quarterly figure is the whole income record. **This limitation is now absolute (D37, briefs #4c/#4d) — the `PREPARE_RETURN` source-of-figure field this bullet used to name as the one existing control is gone, and nothing replaced it.** The per-quarter Notes field can hold anything she chooses to write, but nothing requires or requests an entry.
- **`@radix-ui/react-dialog`, `react-label`, `react-select`, and `react-slot` are installed dependencies with no import anywhere in the codebase.** `components/ui/*` are plain HTML elements wrapped with Tailwind classes via the `cva`/`cn` convention. "Tailwind + shadcn/ui" in the stack description is generous; verify before assuming any Radix behavior (portals, focus trapping, accessibility roles) is present.
- **`data/app.db` has no backup.** Housekeeping while the data is seeded; a real single point of failure the day it is not. **Raised again by the bookkeeper 2026-09-26** — she wants `storage/` and the `.env` file backed up alongside it, but deferred deciding how until real data exists. Recorded as deferred, not done — see "Next, in order" and the November list below.

---

## Next, in order

1. Let the bookkeeper walk steps 3 and 4 of the Prepare group (computation, advising the client) before touching the other four groups — steps 1 and 2 have now been walked and fixed across briefs #4c-#4e and #5a.
2. Act on whatever that walkthrough finds, step by step.
3. Build the document archive browse view.
4. **Before live data in November:** back up `data/app.db`, `storage/`, and the `.env` file (raised by the bookkeeper 2026-09-26, deferring the how until real data exists — not done yet), and confirm the ATC codes against the current BIR list (now possible directly at `/settings/atc-codes`, brief #5a).
5. **Decide on the live Q3 cycle** — certificates expected early November, 1701Q due **November 16, 2026** (statutory Nov 15 is a Sunday). The Excel files remain the master until that decision.
6. Reassess the remaining Phase 4 items (calendar view) afterwards.
