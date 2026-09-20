# CLAUDE.md

*Instructions for Claude Code working on this repository.*
*Last reconciled: 2026-09-20, evening — branch reconciliation pass (brief #3), against the tree.*

---

## What this is

A local-first Next.js application used by **one bookkeeper** to manage Philippine BIR tax compliance for freelance clients on the 8% income tax option. It records the client's own declared quarterly sales, computes quarterly and annual tax, tracks a sixteen-step filing workflow per client per period, and stores the supporting documents.

**It is a filing manager, not an accounting system.** It generates no books of accounts. There is no ledger — only a declared-income record sufficient to compute the return.

`PROJECT_MASTER.md`, `CURRENT_STATE.md` and `DECISIONS.md` carry project context and are current as of 2026-09-20 evening. **`SPEC.md` is not** — it still describes the pre-rework system and contradicts the build in several places; see its dated banner for which sections a decision has superseded. Where SPEC.md disagrees with PROJECT_MASTER.md or DECISIONS.md, the latter win, and say so rather than following SPEC.md quietly.

## A note on how this branch came to be

Two independent rework passes happened on separate branches from the same base commit (`e17e42c`): one built the declared-sales income model and the filing-page redesign (`next-action-control.tsx`, `computation-sheet-panel.tsx`), the other built the corrected document-blocking rule and moved output panels into their steps. Neither branch contained the other's work. This branch is the reconciliation: the income-model branch as the base, with the blocking-rule work re-applied on top of it. See `DECISIONS.md` D31 for the reasoning and what changed in the process (notably: step 1 now links to the real `/clients/[id]/income` form, not a placeholder). If you're told a brief's account of "what's on this branch" doesn't match what you find, trust the tree — verify with `git log`/`git merge-base` before writing code, not just before writing docs.

## Before you finish: state the branch

**End every summary with the branch name and confirm you pushed.** You create a new branch per pass and the user has no way to guess the name. This has cost several round trips — she reseeded her database against code she did not have, and two branches diverged from a name that was never clearly stated. One line prevents it.

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
/app/(app)/clients/[id]/income   declared quarterly sales entry (D26) — the
                               only place income enters the system
/lib/tax/                     computation engine — PURE, zero I/O
/lib/workflow/                step template, state machine, due dates,
                               aging, docSlots.ts, completeness.ts,
                               election.ts, clientPackageEmail.ts
/lib/documents/                storage, naming, hashing, computationSheet.ts
                               (ensureComputationSheetSaved), computationSheetHtml.ts
/lib/reconciliation.ts         the single annual certificates-vs-declared-sales check
/lib/actions/                  Server Actions — the I/O boundary
/lib/dates.ts                  manilaCalendarDay(), formatManilaDate()
/components/                   next-action-control.tsx, computation-sheet-panel.tsx,
                               quarterly-sales-card.tsx, workflow-step-card.tsx,
                               copy-textarea.tsx, ui/ (plain Tailwind primitives)
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

**A Form 2307 is authoritative for the withholding and nothing else.** It reports what one payor paid and withheld, and only ever sees income from payors who are withholding agents. Income from non-withholding clients and direct consumers appears on no certificate at all, and some clients issue no 2307 whatsoever.

There is no "convert a 2307 into a transaction" flow and there must not be one — that conversion is exactly what D26 removed.

**`QuarterlySales.quarter` includes `Q4`. `Filing.period` does not.** There is no Q4 return — October–December income is picked up by the annual filing. These are two different types with two different CHECK constraints. Do not merge them, and do not "tidy up" the apparent inconsistency.

Cumulative mapping: `Q1`→Q1 · `Q2`→Q1+Q2 · `Q3`→Q1+Q2+Q3 · `ANNUAL`→Q1+Q2+Q3+Q4.

A missing quarter is zero, not an error — but a filing whose OWN quarter has no `QuarterlySales` row must **say so in words**, distinct from a cumulative total that happens to be zero (`lib/filingComputation.ts`'s `hasSalesRecordedForPeriod`, keyed on `lib/tax/periods.ts`'s `ownSalesQuarterOf`). A silent `₱0.00` reads as a real answer and it is not one.

**The `PREPARE_RETURN` acknowledgement's source-of-figure field is the one control left in the system.** Once income is declared-only, nothing can be cross-checked against anything (the only surviving reconciliation, `lib/reconciliation.ts`, is annual certificates-vs-declared-sales — a sanity check, not a source-level one). The acknowledgement records *where* the declared figure came from (a text field) and carries an *optional* attachment slot for the client's own confirming message, if she has one. This is deliberately different in kind from the `advisory_evidence` slot the bookkeeper rejected: that one asked her to prove she'd given advice; this one records the provenance of a number she is about to file. **It must never block** — see DECISIONS.md D26/D27.

## The blocking rule — read this before touching the workflow

**The app blocks on documents it receives. It never asks the bookkeeper to prove she did something.**

| Category | Behaviour | Steps |
|---|---|---|
| Documents she **receives** from outside | Blocks `DONE` until attached | 6, 7, 9, 10, 11 (both slots), 13, 14 |
| Actions she **performs** elsewhere | No slot at all | 4, 12, 16 |
| A document delivered **to someone else** | Optional, hidden, never blocking | 15 only |

**Step 15 (eAFS) is a documented exception, not an oversight.** Its confirmation email goes to the client, not to the bookkeeper, and often never reaches her. Blocking would strand a filing on a file she cannot obtain; removing the slot would make a document she does sometimes receive impossible to keep. If you find one optional slot sitting among seven required ones, this is why. Leave it. Step 16's client email draft asks her to forward the eAFS confirmation, but only when it isn't already on file (`lib/workflow/clientPackageEmail.ts`) — the one moment in the cycle she's writing to that client anyway.

**The election check is the one other hard block** (`lib/workflow/election.ts`, `isElectionBlocked`, wired into `markStepDone`) and guards a wrong tax rate, not a missing file: an unconfirmed election may default to graduated rates, making a Q1 filing's computation wrong regardless of documents. Only Q1 is blocked.

**Waiting blocks exactly one thing:** waiting at step 13 blocks step 14, because a validation email cannot arrive before the acknowledgement it follows. One explicit dependency edge in `markStepDone`, never generalised — waiting at steps 10 and 14 must not block anything else.

**A document belongs to its step, not to the page.** Anything belonging to a step renders inside that step's card (`components/workflow-step-card.tsx`), not as a page-level panel. **Never expose a raw step code** (`PREPARE_RETURN`) in a user-facing label.

**The filing page combines two fixes for the same complaint** ("output shown ahead of the work it belongs to"): a next-action line and compact summary strip at the top (`components/next-action-control.tsx`) answer "what do I do now" without scrolling, and the computation sheet / certificate cutoff / client confirmation panels live inside their own step cards rather than as page-level panels at the bottom. Keep both — they answer different complaints from different test drives, not the same one twice.

## Coding conventions

- **Money is integer centavos.** Decimal.js for arithmetic. No `parseFloat`, `Number()` or `toFixed` on any money path. Display only via `centsToPesos()`.
- **Dates:** never extract with `getUTCDate()` / `getUTCMonth()` / `getUTCFullYear()`. Calendar-day comparisons go through `manilaCalendarDay()`. Elapsed time uses milliseconds. Display via `formatManilaDate()`. Codified in SPEC.md §4. *This bug class has appeared multiple times — treat it as a live hazard.*
- **No new dependencies without asking.**
- **No outbound network calls at runtime.** No CDN fonts, analytics, telemetry or error SDKs.
- Validate with Zod at every boundary.

## Database rules

- `ActivityLog` is append-only. No hard deletes on financial records.
- **Never hardcode a value the code is supposed to derive.**
  - *One deliberate exception:* frozen computation snapshots in the seed use hand-verified literal centavo integers, so they stay an independent check on the engine. Do not "fix" these.
- **A code-level fix does not reach rows already in the database.** The `WorkflowStepTemplate` upsert used `update: {}` on both pre-reconciliation branches, so reseeding over an existing database silently ignored every step-definition change. Fixed in this pass (the upsert now applies `update`, and stale step codes — e.g. the retired `RECORD_CRJ` — are deactivated on reseed). The class of bug stands: when changing a rule, say explicitly whether existing data needs a backfill, and offer a dry run.
- Migrations that add constraints should be verified to actually reject bad values.
- **While the database holds only seed data, destructive migrations are fine** — drop, migrate, reseed. No migration path needs preserving. **This licence expires when live data is entered in November 2026.**

## Business rules you must not quietly change

1. The 8% formula, the ₱250,000 deduction (full from Q1, never prorated, `PURELY_SELF_EMPLOYED` only), and the cumulative approach
2. The CWT cutoff rule — `dateReceived` against a per-filing `certificateCutoffDate`, **never period end**
3. `computationSnapshot` immutability once filed; edits raise an `AmendmentAlert`
4. Deadlines: Q1 May 15, Q2 Aug 15, Q3 Nov 15, Annual Apr 15. **No Q4 return exists.**
5. eAFS = adjusted due date + 15 days; early filing does not move it
6. Filing status derivation: `DONE`/`NA`/`SKIPPED` → `COMPLETE`
7. **No books of accounts at all.** CRJ, CDJ, General Journal and General Ledger are the client's responsibility. `lib/books/` and its models are gone — do not re-add them without a dedicated brief.
8. The income model, the blocking rule, and the `Q4` distinction, all above
9. No .DAT generation, no BIR API integration, no email sending
10. The archive's independence from the database

## Never invent BIR specifics

ATC codes, penalty rates, compromise schedules, form field orders. If you are not certain, **leave it empty and flag it** rather than producing something plausible. A wrong ATC code looks correct and gets filed. Unverified items carry `verifiedAgainstIssuance: false` — keep that pattern.

## UI rules

Centered container ~1100px. Tables with aligned columns, not edge-pinned cards. Row text 14px, secondary 13px. Empty panels collapse to one muted line. Rows navigate to detail with a hover state. Status colours: grey pending, blue in progress, amber waiting, red overdue, green done.

**Density is not the goal; being operable is.** "Dense over pretty" was taken too far and produced a first test drive that stopped at step 4 of 16.

**Lead with the work, not the output.** The filing page opens with a next-action line naming the next step, then a compact summary strip, then the checklist — the computation sheet, certificate cutoff, and client confirmation sit collapsed inside the steps they belong to (step 2, step 3), not as full-width panels ahead of or detached from the checklist.

## Security

Will hold real TINs and income data under the Data Privacy Act from November 2026. **There is none in the application today** — the three clients are fictitious seed data. One real client's Q1 figures live in `scripts/real-fixture.local.ts`, gitignored, never pushed — not present in every checkout (this pass's checkout did not have it; say so explicitly if yours doesn't either, rather than reporting `verify-real.ts`'s figures as confirmed). Single `.env` password is adequate for localhost and nothing more. Never commit `data/`, `storage/`, or any `*.local.ts` fixture.

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
- **`scripts/verify-real.ts` is the primary regression guard.** It reproduces one real client's filed Q1 2026 figures to the centavo — gross ₱332,933.90, taxable ₱82,933.90, tax due ₱6,634.71, CWT ₱16,646.70, overpayment ₱10,011.99. It reads a gitignored local fixture (`scripts/real-fixture.local.ts`) that may not exist in your checkout; if you cannot run it, **say so explicitly** rather than omitting it from the report or repeating these figures as freshly confirmed.
- For UI work, do a live walkthrough against the dev server. **Do not report a page as verified if you did not load it.**
- A passing suite says nothing about whether a screen is usable. The first test drive stopped at step 4 of 16 with every test green.

## Convenience

- `Start Bookkeeping App.bat` at the repo root — double-click launcher (untracked).
- `_test-files/` at the repo root — disposable dummy documents for test drives (untracked).
- `npm install` writes an `allowScripts` block into `package.json`. It is machine-local and blocks branch switches; the user stashes before checking out.

## Current priorities

See `CURRENT_STATE.md`. In short:

1. Act on whatever the ongoing test drive finds, step by step.
2. Run `scripts/verify-real.ts` on a machine where the fixture exists; it has gone unexercised on more than one pass now.
3. Build the **document archive browse view** — client → year, with a whole-year zip. It serves what she named as the most important thing the app does, and it is the only genuinely new build left in the backlog.
4. **Before the live Q3 cycle:** a backup for `data/app.db`, and BIR verification of the seeded ATC codes.
5. The live 1701Q is due **November 16, 2026**. Excel remains the master until she decides otherwise.
