# CURRENT_STATE.md

*Living snapshot. Replace stale content rather than appending.*
*Last reconciled: 2026-09-21 — Prepare group steps 1 and 2 rebuilt (brief #4b), against the tree.*

---

## Where the code is

**Working branch: this one**, reconciled from `claude/peaceful-goldberg-hsh6yo` (cut point) with `claude/laughing-darwin-wcnh8u`'s commit `7bfbd5d` re-applied on top, not merged. The two source branches:

| Branch | Contained | Status now |
|---|---|---|
| `claude/elegant-clarke-vu1xyd` | Base. `origin/HEAD` points here. Last commit `e17e42c` — Phase 4. | Superseded — two rework passes ahead of it. |
| `claude/peaceful-goldberg-hsh6yo` | Declared-sales income model (`QuarterlySales`), election hard-blocker, filing-page redesign (next-action line, summary strip). | **This branch's base.** Superseded by this one — do not build on it further. |
| `claude/laughing-darwin-wcnh8u` | Corrected blocking rule (D27), step reorder (D28), step 13→14 dependency (D29), panels moved into steps (D30) — built on the *pre-D26* income model. | Superseded by this one — do not build on it further. Its commit `7bfbd5d` is the reference this reconciliation re-applied. |

**Why reconciliation, not a merge:** the two branches shared only `e17e42c` and took incompatible approaches to the income model. A git merge would have fought itself; re-applying `laughing-darwin`'s D27–D30 checklist logic onto `peaceful-goldberg`'s income model by hand was more reliable, and kept `peaceful-goldberg`'s validated income model as the base — that branch is where the real Q1 2026 figures were last confirmed against the replaced engine.

**Claude Code creates a new branch for every pass and does not announce the name unless asked.** After any Claude Code run: `git fetch --all` then `git branch -a`, and look for a `claude/...` branch you do not recognise. Ask it to state the branch it worked on AND the branch it cut from — this reconciliation exists because a branch relationship was asserted without being checked.

**`npm install` writes an `allowScripts` block into `package.json`** (npm's build-script allowlist for prisma, esbuild, sharp). It is machine-local and regenerates itself, and blocks every branch switch. `git stash` before checking out is now part of the routine.

---

## What this application is

**A filing manager, not an accounting system.** Four layers, with a strict rule about who authors what:

| Layer | Authored? | Role |
|---|---|---|
| Income record | Yes | One declared gross-sales figure per client per quarter. The only place money enters. |
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
- Step 1 is `RECORD_SALES` ("Record quarterly sales"), linking to `/clients/[id]/income` — the real declared-sales form, since it exists on this base (unlike on `laughing-darwin`, where it pointed at the pre-existing transactions page for lack of anything better). Step 2 is `RECEIVE_2307`, its own certificate-scan slot made optional.
- Step 13 → 14 is a single explicit dependency check in `markStepDone`.
- Step 3 (`PREPARE_RETURN`) generates its own computation sheet as HTML into the vault on completion, via `lib/documents/computationSheet.ts`'s `ensureComputationSheetSaved` (idempotent, frozen-aware — a filed filing's saved copy is never regenerated) — no upload. It also carries the acknowledgement's source-of-figure field and an optional slot for the client's own confirming message (`client_confirmation_evidence`) — see PROJECT_MASTER.md.
- Step 16 offers a package-download button and a copyable, auto-filled client email draft (`lib/workflow/clientPackageEmail.ts`), including a line asking the client to forward the eAFS confirmation, shown only when step 15's slot is still empty.
- The computation sheet, certificate cutoff (rewritten in plain language, no `SPEC.md` citation on screen), and client-confirmation panels render inside steps 2 and 3 rather than as page-level panels at the bottom.
- The "documents not yet attached" note is limited to `DONE`/`IN_PROGRESS` steps and covers every empty slot on them, required or optional (`lib/workflow/completeness.ts`) — empty on a fresh filing, dismissible, reappears if a new gap opens.
- "No sales recorded for [period] [year]" renders in place of a computed `₱0.00` wherever this filing's own quarter has no `QuarterlySales` row yet — the summary strip, the computation sheet panel, and the generated computation-sheet HTML file all check this the same way (`hasSalesRecordedForPeriod`, keyed on `ownSalesQuarterOf`), distinct from a cumulative total that's merely zero.
- The `WorkflowStepTemplate` seed upsert now actually applies `update` (was `update: {}` on both source branches) and deactivates stale step codes.

**Kept from `peaceful-goldberg`, unaffected by the reconciliation:** the next-action line and summary strip at the top of the filing page (`components/next-action-control.tsx`), now also disabled with the same blocking reason as the checklist card below it rather than only failing after a click.

**Validated against reality** — the claim, carried from `peaceful-goldberg`, that a real client's actual Q1 2026 figures reproduce through `computeFiling` to the centavo (gross ₱332,933.90, tax due ₱6,634.71, CWT ₱16,646.70, overpayment ₱10,011.99). **Not independently re-confirmed this pass** — see "Known limitations."

**The sixteen steps wrapped in five groups (brief #4a, D32)** — Prepare, File, Pay, SAWT, Close (`lib/workflow/groups.ts`). Deliberately narrow: nothing about what a step requires, blocks, or does changed.
- One "Mark done" per group (`lib/actions/workflowSteps.ts`'s `markGroupDone`), marking every unresolved step in the group at once by calling the existing per-step `markStepDone` in ascending sequence — so the election hard-blocker, the step 13→14 dependency, and `SEND_CLIENT_PACKAGE`'s package-readiness check all still apply exactly as before, unchanged and un-duplicated.
- Groups 2/3/4 (File/Pay/SAWT) match the `FILING`/`PAYMENT`/`SAWT` categories exactly; steps 4 and 16 (both `CLIENT_COMM`) split across Prepare and Close respectively, so group membership is its own lookup table, not `category` repurposed.
- Group 2 (File: steps 5, 6, 7, 10) is deliberately not contiguous — the TRRC sits with File, not Pay (group 3, steps 8–9), because it's eBIRForms' confirmation of the filing, not of the payment. Verified live: a filing that's filed and paid but still waiting on the TRRC sits on the board under "File — waiting on BIR, 12d," not looking unfiled, while Pay shows fully Done — completing Pay first raised no warning anywhere.
- Filing detail page (`app/(app)/clients/[id]/filings/[filingId]/page.tsx`): the flat 16-step list is now five collapsible `WorkflowGroupCard`s, each showing progress, what's outstanding, and a disabled-with-reason "Mark done" while a required document is missing. The group containing the filing's next step opens by default; expanding any group exposes every per-step control (attach, skip with reason, mark waiting, start) unchanged. Steps within a group render in numeric order (confirmed: TRRC renders last inside File).
- Board (`app/(app)/filings/page.tsx`): five columns, not sixteen. A card sits in its earliest incomplete group (group order, not step sequence) and carries that group's waiting label.
- 16 new tests (`tests/workflow/groups.test.ts`, plus additions to `tests/actions/workflowSteps.test.ts`); full suite, typecheck, and build all verified — see "How to test" in CLAUDE.md for the pre-existing `verify-real.ts` gap, unrelated to this pass.

**Steps 1 and 2 rebuilt, self-completing, and Prepare's first real block (brief #4b, D33-D35, 2026-09-21)** — she walked the five-group structure and asked for this next:
- **Step 1 (`RECORD_SALES`)** — declared sales is now per-customer rows (`QuarterlySalesCustomer`), summed into `QuarterlySales.grossSalesCents` on every save (`lib/actions/quarterlySales.ts`'s `saveQuarterlySales`), never itself typed. Rows add/remove freely. `noSalesThisQuarter` records a deliberate ₱0. Save as draft stores the rows without marking step 1 done; Save does both, reusing the existing `markStepDone` (so the election hard-blocker still applies). Once done, further edits never undo it — the quarter stays editable until its own filing's step 5 (`FILE_RETURN`) is `DONE`. The step 1 card (`components/record-sales-step-card.tsx`) has no manual controls left at all — status and the quarter's total are fully derived.
- **The income page** (`app/(app)/clients/[id]/income`) now takes an optional `?filingId=`: opened from a filing, only that filing's own quarter is editable (`QuarterlySalesCard`, rebuilt for per-customer rows), every other quarter this taxable year renders as a read-only table (quarter, customers, total, source) with a link to its own filing; opened without one (e.g. from the client page), every quarter renders the same read-only way. A "Back to filing" button returns to where it was opened from.
- **Step 2 (`RECEIVE_2307`)** — one row per certificate, entered here (`components/receive-2307-step-card.tsx`, `lib/actions/form2307.ts`'s `addCertificate`/`deleteCertificate`), not on a separate register screen. Each row: payor, income amount, tax withheld, date received, its own scan (`Document.form2307Id`); the rest of `Form2307`'s existing fields sit behind "more." `Filing.certificatesAllReceivedAt` backs the "All certificates received" checkbox. Step 2 is `DONE` only once that's ticked **and** every row has a scan (`lib/actions/workflowSteps.ts`'s `recomputeReceive2307Status`) — a genuine two-way toggle, unlike step 1: unticking reverts to not-done so a late arrival can be added before filing. Skip (with a written reason) is the only manual control left on this step.
- **The old Form 2307 register** (`/clients/[id]/form-2307`) is now read-only — its entry form and `/form-2307/new` route are gone. It still shows the annual reconciliation and the SAWT keying-worksheet link, and each row now links to the filing it was claimed on.
- **The certificate cutoff is gone (D34, supersedes D10).** `Filing.certificateCutoffOverride`, `resolveCertificateCutoffDate()`, and every `dateReceived`-vs-cutoff comparison are removed. A certificate now counts in the filing whose step 2 it was entered under (`Form2307.claimedOnFilingId`, set once, never reassigned) and every later period in the same taxable year (`lib/tax/cwt.ts`'s `sumCwtThroughPeriod`, now period-keyed, not date-keyed). Locked once that filing's step 5 is `DONE`. `dateReceived` is kept as a recorded fact only. Confirmed unaffected: the annual certificates-vs-declared-sales check (`lib/reconciliation.ts`) — it already ran over the whole taxable year. `lib/sawt/eligibleCertificates.ts` and `lib/actions/sawt.ts` were updated to the same period-keyed logic so SAWT batching stays consistent with the new rule.
- **Prepare's own group "Mark done"** now only ever has steps 3-4 left (steps 1-2 self-complete) and is disabled, with a plain-language reason, until step 1 is Done and step 2 is Done or Skipped (`lib/workflow/groups.ts`'s `prepareGroupBlockReason`, enforced both client-side on the button and server-side in `markGroupDone`) — Prepare's first real block since grouping.
- Seed updated: sample clients' `QuarterlySales` rows carry per-customer rows (one client's Q1 split into two, to demonstrate the feature); the TY2026 cycle's certificates carry `claimedOnFilingId` pointing at the filing they were seeded under, with `certificatesAllReceivedAt`/`finalizedAt` set to match steps 1/2 being Done.
- New tests: per-customer sum, draft vs. Save, step 1/2 self-completion, step 2 blocking on a missing scan, step 2 locking after filing, Prepare disabled until 1/2 resolved (`tests/actions/quarterlySales.test.ts`, `tests/actions/form2307.test.ts`, additions to `tests/workflow/groups.test.ts` and `tests/actions/workflowSteps.test.ts`); `tests/tax/cwt.test.ts` and `tests/filingComputation/certificateAssignment.test.ts` (replacing the old cutoff test) rewritten for D34. Full suite, typecheck, and build all verified.
- **`scripts/verify-real.ts`'s fixture shape changed** (D34): `certificateCutoffDate` is gone from `RealFixture`; each certificate now carries `claimedPeriod`. The gitignored fixture wasn't present in this checkout (as in prior passes) — say so explicitly rather than claiming the real Q1 2026 figures were freshly reproduced; whoever holds the fixture needs to add `claimedPeriod: "Q1"` to each certificate before it will run again.

---

## Test drives

**First — 2026-09-19.** Stopped at step 4 of 16, on the base build. *"The app is difficult to navigate and follow."* Three requirements rejected outright, all of them demands for self-produced documents. Produced D24.

**Second — 2026-09-20, on `peaceful-goldberg`.** Walked all sixteen steps for the first time. Produced D25, D26 (income model), then D27–D30 (blocking rule, step order, waiting dependency, orphaned panels) from a follow-up walkthrough of that same build.

**Third — status unknown to this pass.** Referenced as "in progress" in the brief that requested this reconciliation; nothing in the repo records its findings yet.

**Fourth — 2026-09-21, the bookkeeper walked the five-group structure (brief #4a).** Produced brief #4b directly: per-customer income rows (D33), the certificate credit-period rule (D34, supersedes D10), and step 2 becoming a real block (D35) — see "Built and working" above.

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

1. **Third test drive comments**, whatever they turn out to be.
2. **ATC codes** — only WI010 and WI011 seeded, both `verifiedAgainstIssuance: false`. Must be confirmed against the current BIR list before live use.
3. **SAWT keying worksheet field order** — built, not yet checked against the actual Alphalist Data Entry Module's own field order.
4. **Which clients are certificate clients and which declare only** — affects nothing structurally now that both paths are unified through declared sales, but worth recording.

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
- **For a declared-income client nothing can be cross-checked against anything** except the annual certificates-vs-declared-sales check. The client's stated quarterly figure is the whole income record. A property of the engagement, not a defect — the `PREPARE_RETURN` acknowledgement's source-of-figure field is the one control that exists, and it is deliberately a record of provenance, not a gate.
- **`@radix-ui/react-dialog`, `react-label`, `react-select`, and `react-slot` are installed dependencies with no import anywhere in the codebase.** `components/ui/*` are plain HTML elements wrapped with Tailwind classes via the `cva`/`cn` convention. "Tailwind + shadcn/ui" in the stack description is generous; verify before assuming any Radix behavior (portals, focus trapping, accessibility roles) is present.
- **`data/app.db` has no backup.** Housekeeping while the data is seeded; a real single point of failure the day it is not.
- **`scripts/verify-real.ts` did not run this pass** — the gitignored fixture it reads (`scripts/real-fixture.local.ts`) is not present in this checkout. The figures above are carried over from `peaceful-goldberg`'s own notes, not freshly confirmed. The primary regression guard has now gone unexercised across at least three passes, and this pass changed its input shape (D34, brief #4b): `RealFixture.certificateCutoffDate` is gone, and each certificate now needs a `claimedPeriod`. Run it on a machine where the fixture lives, and update the fixture's certificates to the new shape first.

---

## Next, in order

1. Let the bookkeeper walk the rebuilt Prepare group (steps 1 and 2, brief #4b) before touching steps 3-16 or any other group.
2. Act on whatever her walkthrough finds, step by step.
3. Run `scripts/verify-real.ts` somewhere the fixture exists, to close the unexercised regression guard — note the fixture's shape changed this pass (D34: `claimedPeriod` per certificate, no more `certificateCutoffDate`), so it needs updating there too.
4. Build the document archive browse view.
5. **Before live data in November:** solve the `data/app.db` backup, and confirm the ATC codes against the current BIR list.
6. **Decide on the live Q3 cycle** — certificates expected early November, 1701Q due **November 16, 2026** (statutory Nov 15 is a Sunday). The Excel files remain the master until that decision.
7. Reassess the remaining Phase 4 items (calendar view) afterwards.
