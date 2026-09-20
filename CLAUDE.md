# CLAUDE.md

*Instructions for Claude Code working on this repository.*
*Last reconciled: 2026-09-20, evening — against the tree on `claude/laughing-darwin-wcnh8u`, not from the conversation that drafted this pass. See the correction note immediately below before reading anything else.*

---

## Read this before anything else: which branch, and what's actually built here

**This file, and everything else in this repo root, describes `claude/laughing-darwin-wcnh8u`.** A sibling branch, `claude/peaceful-goldberg-hsh6yo`, branches from the same commit (`e17e42c`) and contains a different, incompatible rework: a `QuarterlySales` income model, an enforced election blocker, and deletion of `SalesTransaction`/`lib/books/`/`ChartOfAccounts`/`JournalEntry`/`ImportBatch`. **Neither branch is an ancestor of the other** — confirmed with `git merge-base --is-ancestor` both directions, both `false`. If you are handed a brief that assumes both sets of changes exist together on one branch, that assumption is wrong; check which branch you are actually on before writing code.

**On `laughing-darwin` specifically:** the income model is still the original one — `SalesTransaction`, sourced mainly from Form 2307 entries with a quick-entry path for receipts without one. `QuarterlySales` does not exist here. There is no election hard-blocker in code, only an unenforced dashboard warning. `lib/books/` (the Cash Receipts Journal generator) is still present and still generates a book. See `CURRENT_STATE.md` for the full list — it is longer than this paragraph and you should read it, not just this summary.

## What this is

A local-first Next.js application used by **one bookkeeper** to manage Philippine BIR tax compliance for freelance clients on the 8% income tax option. On this branch, it enters income via `SalesTransaction` (from Form 2307s, or quick-entered for receipts with none), computes quarterly and annual tax, tracks a sixteen-step filing workflow per client per period, generates the client's Cash Receipts Journal, and stores the supporting documents.

`PROJECT_MASTER.md` and `DECISIONS.md` describe the **intended** application and the decisions that shape it — including some (D25, D26) not yet implemented on this branch. `CURRENT_STATE.md` says what is actually built here, and is the one to trust when the other two describe something you can't find in the tree. **`SPEC.md` is the original design document and is not current** — see its banner for which sections a decision has since overridden, and note that several sections it still overrides only "on paper": the code they describe (the CRJ, the three-check reconciliation) is still exactly what's running on this branch. Where SPEC.md, PROJECT_MASTER.md, and CURRENT_STATE.md disagree about what's *built*, trust CURRENT_STATE.md, because it is reconciled against the tree and the other two are not.

## Before you finish: state the branch

**End every summary with the branch name you worked on, the branch you branched from, and confirm you pushed.** You create a new branch per pass and the user has no way to guess the name. This has cost several round trips — she reseeded her database twice against code she did not have, and two independent branches now exist partly because a session's starting point wasn't stated clearly enough to catch before more work piled on. One line prevents it.

## Who you are working with

**The user is not a technical person.**

- Explain significant decisions in **plain English**, not in terms of frameworks, patterns or type systems.
- **Never make a major architectural or business-rule change without explaining it first and waiting for a response.**
- When you need a decision, state the options and their practical consequences.
- Terminal commands: give the exact command and say what it does. Do not assume familiarity. Warn before anything destructive.

## Stack

Next.js 15 App Router · TypeScript strict · Prisma + SQLite (`data/app.db`) · Tailwind CSS · Zod · Luxon (`Asia/Manila`) · Decimal.js · Vitest · jszip · exceljs · Server Actions for CRUD

**Not "shadcn/ui" in any load-bearing sense.** `components/ui/*` (`button.tsx`, `card.tsx`, `checkbox.tsx`, `input.tsx`, `label.tsx`, `select.tsx`, `textarea.tsx`) are plain native elements wrapped in Tailwind classes via the `cva`/`cn` convention. `@radix-ui/react-dialog`, `react-label`, `react-select`, and `react-slot` are `package.json` dependencies with **no import anywhere in the codebase** — confirmed by grep, 2026-09-20. Don't assume Radix behavior (focus trapping, portals, ARIA roles) is present just because the package is installed; it isn't wired to anything.

`exceljs` is still in use — `lib/books/crjExport.ts` and `lib/sawt/keyingWorksheetExport.ts` both import it for XLSX export. It has not been removed.

## Architecture

```
/app                          routes
/lib/tax/                     computation engine — PURE, zero I/O
/lib/workflow/                step template, state machine, due dates, aging,
                               docSlots.ts, clientPackageEmail.ts
/lib/documents/                storage, naming, hashing, computationSheet.ts
/lib/books/                    Cash Receipts Journal generator (assembleCrj.ts,
                               crj.ts, crjExport.ts) — still present on this
                               branch; D25 decided to remove it, not yet done
/lib/sawt/                     SAWT batch, reconciliation helpers, keying
                               worksheet export
/lib/actions/                  Server Actions — the I/O boundary
/lib/validation/               Zod schemas per entity
/lib/reconciliation.ts         three checks (unlinked transactions, unconverted
                               certificates, CWT-vs-SAWT-batch variance) —
                               D26 describes reducing this to one; not done here
/lib/dates.ts                  manilaCalendarDay(), formatManilaDate()
/lib/money.ts                  centsToPesos(), integer-centavo helpers
/components/ui/                plain Tailwind form primitives, see Stack above
/prisma/                       schema, migrations, seed
/storage/                      gitignored document vault
/data/                         gitignored SQLite db
/scripts/                      one-off tools, not part of the app
/tests/
```

**`/lib/tax/` must never import Prisma, `fs`, `next/*`, or anything I/O.** Plain object in, plain object out. Verified unchanged by any rework pass on this branch.

**`lib/documents/computationSheet.ts` and `lib/workflow/clientPackageEmail.ts` are exactly where they say** — both created this pass, both confirmed present at those paths.

## The income model on this branch — read this before touching anything money-related

**This is the original, pre-rework model, not D26's.** `SalesTransaction` is the income record. A row is created either by converting a `Form2307` (the transaction inherits the certificate's payor and withheld amount) or via quick entry for a receipt with no certificate (`components/transaction-quick-entry.tsx`, `/clients/[id]/transactions`).

**D26 decided this should change** — gross sales declared once per quarter by the client (`QuarterlySales`), independent of certificates, which would then only ever report withholding. **That model is not built here.** It exists only on `claude/peaceful-goldberg-hsh6yo`. Do not write code on this branch that assumes a `QuarterlySales` table, a `/clients/[id]/income` route, or that a 2307 no longer feeds a transaction — none of that is true here. If you are asked to implement D26 on this branch, that is new work, not a fact already in place.

**What is true on this branch, unaffected by any of the above:** `Filing.period` has no `Q4` — the annual return covers it. Deadlines and the cumulative tax formula are as SPEC.md §3.2 and §3.6 describe. A filing with no recorded sales should say so in words rather than compute a silent `₱0.00` — this is D26's stated intent and is good practice regardless of which income model is running underneath it; if you build a "no sales" check on this branch, check it against `SalesTransaction`, not a table that doesn't exist here.

## The blocking rule — read this before touching the workflow

**This part of D27–D30 is genuinely built on this branch**, verified against the tree, not carried over unverified from the drafting conversation.

**The app blocks on documents it receives. It never asks the bookkeeper to prove she did something.**

| Category | Behaviour | Steps |
|---|---|---|
| Documents she **receives** from outside | Blocks `DONE` until attached | 6, 7, 9, 10, 11 (both slots), 13, 14 |
| Actions she **performs** elsewhere | No slot at all | 4, 12, 16 |
| A document delivered **to someone else** | Optional, hidden, never blocking | 15 only |

**Step 15 (eAFS) is a documented exception, not an oversight.** Its confirmation email goes to the client, not to the bookkeeper, and often never reaches her. If you find one optional slot sitting among seven required ones, this is why. Leave it.

**The election check is NOT a hard block on this branch**, despite what the dashboard's warning text claims and despite `PROJECT_MASTER.md`/`DECISIONS.md` describing it as "the one other hard block, unaffected." It is genuinely implemented (`lib/workflow/election.ts`, `isElectionBlocked`) only on `peaceful-goldberg`. On `laughing-darwin`, nothing in `lib/actions/` or `lib/workflow/` reads `electionStatus` to block anything — verified by grep, 2026-09-20. Don't rely on it existing; don't remove the dashboard warning either without discussing it, since it's at least an honest signal even if it's not backed by enforcement.

**Waiting blocks exactly one thing:** waiting at step 13 blocks step 14, because a validation email cannot arrive before the acknowledgement it follows. One explicit dependency edge in `markStepDone`, never generalised — waiting at steps 10 and 14 must not block anything else.

**A document belongs to its step, not to the page.** Anything belonging to a step renders inside that step's card, in `app/(app)/clients/[id]/filings/[filingId]/page.tsx` and `components/workflow-step-card.tsx`. **Never expose a raw step code** (`PREPARE_RETURN`) in a user-facing label.

**The filing page is not restructured into a "next action line + summary strip"** the way `PROJECT_MASTER.md`'s UI section (written from the sibling branch) describes — that's `components/next-action-control.tsx` and `computation-sheet-panel.tsx`, which don't exist here. On this branch, the filing page opens with a header (client, period, status, due date), then amendment alerts if any, then one Workflow card holding the "documents not yet attached" summary and all sixteen step cards in sequence — the computation sheet, certificate cutoff, and client-confirmation panels live collapsed inside steps 2 and 3, not in a separate summary widget. The underlying *principle* — lead with the work, keep derived output collapsed below it — is the same; the specific components are not.

## Coding conventions

- **Money is integer centavos.** Decimal.js for arithmetic. No `parseFloat`, `Number()` or `toFixed` on any money path. Display only via `centsToPesos()`.
- **Dates:** never extract with `getUTCDate()` / `getUTCMonth()` / `getUTCFullYear()`. Calendar-day comparisons go through `manilaCalendarDay()`. Elapsed time uses milliseconds. Display via `formatManilaDate()`. Codified in SPEC.md §4. *This bug class has appeared multiple times — treat it as a live hazard.*
- **No new dependencies without asking.**
- **No outbound network calls at runtime.** No CDN fonts, analytics, telemetry or error SDKs.
- Validate with Zod at every boundary (`lib/validation/`).

## Database rules

- `ActivityLog` is append-only. No hard deletes on financial records.
- **Never hardcode a value the code is supposed to derive.**
  - *One deliberate exception:* frozen computation snapshots in the seed use hand-verified literal centavo integers, so they stay an independent check on the engine. Do not "fix" these.
- **A code-level fix does not reach rows already in the database.** The `WorkflowStepTemplate` upsert once used `update: {}`, so reseeding over an existing database silently ignored every step-definition change — correct code, stale runtime, and nobody could tell. Fixed this pass (the upsert now applies `update`, and stale step codes are deactivated), but the class of bug stands: when changing a rule, say explicitly whether existing data needs a backfill, and offer a dry run.
- Migrations that add constraints should be verified to actually reject bad values.
- **While the database holds only seed data, destructive migrations are fine** — drop, migrate, reseed. **This licence expires when live data is entered in November 2026.**

## Business rules you must not quietly change

1. The 8% formula, the ₱250,000 deduction (full from Q1, never prorated, `PURELY_SELF_EMPLOYED` only), and the cumulative approach
2. The CWT cutoff rule — `dateReceived` against a per-filing `certificateCutoffDate`, **never period end**
3. `computationSnapshot` immutability once filed; edits raise an `AmendmentAlert`
4. Deadlines: Q1 May 15, Q2 Aug 15, Q3 Nov 15, Annual Apr 15. **No Q4 return exists.**
5. eAFS = adjusted due date + 15 days; early filing does not move it
6. Filing status derivation: `DONE`/`NA`/`SKIPPED` → `COMPLETE`
7. **The Cash Receipts Journal is still generated on this branch** (SPEC.md §9) — `lib/books/`, sourced from `SalesTransaction`. D25 decided to remove all books of accounts; that decision has not been carried out here. Don't delete `lib/books/` as a side effect of an unrelated task without a dedicated brief for it.
8. The blocking rule (D27–D30, implemented here) and the `Q4`-in-filings distinction
9. No .DAT generation, no BIR API integration, no email sending
10. The archive's independence from the database

## Never invent BIR specifics

ATC codes, penalty rates, compromise schedules, form field orders. If you are not certain, **leave it empty and flag it** rather than producing something plausible. Unverified items carry `verifiedAgainstIssuance: false` — keep that pattern.

## UI rules

Centered container ~1100px. Tables with aligned columns, not edge-pinned cards. Row text 14px, secondary 13px. Empty panels collapse to one muted line. Rows navigate to detail with a hover state. Status colours: grey pending, blue in progress, amber waiting, red overdue, green done.

**Density is not the goal; being operable is.** "Dense over pretty" was taken too far and produced a first test drive that stopped at step 4 of 16.

**Output belongs inside the work it derives from, not ahead of it.** The old filing page opened with a full-screen computation sheet above the checklist. On this branch that's fixed by moving the computation sheet, the certificate cutoff, and the client-confirmation panel inside steps 2 and 3 (D30) — not by adding a separate summary-strip component, which is a different branch's approach to the same principle.

## Security

Will hold real TINs and income data under the Data Privacy Act from November 2026. **There is none in the application today** — the three clients are fictitious seed data. One real client's Q1 figures are said to live in `scripts/real-fixture.local.ts`, gitignored — **not present in this checkout**; do not assume you can run `scripts/verify-real.ts` without checking first. Single `.env` password is adequate for localhost and nothing more. Never commit `data/`, `storage/`, or any `*.local.ts` fixture.

## How to approach changes

- **Do only what was asked.** Do not refactor, reformat, rename or "improve" code outside the scope of the task. If you notice something wrong nearby, report it — do not fix it unsolicited.
- **Verify identifiers against the working tree before editing.** Briefs describe intent — including intent drafted from a conversation with no repo access — and can get branch state, not just names, wrong. This file is itself a correction of exactly that kind of error, found this pass.
- If a request is ambiguous, ask. Do not guess and build.
- Prefer fixing the root cause over the symptom.
- **If your own earlier work or summary turns out to have been wrong, say so directly.**
- **Do not report a phase, feature, or branch's contents as complete or as containing something without opening the files.** A claim that this branch contained another branch's rework was handed to this pass as fact; it took one `git merge-base` call to disprove.

## How to test

- Tests first for anything in `/lib/tax/` — write them, show them failing, then implement.
- Tax tests use inline fixtures. **Never read seed data or the database.**
- Every bug fix gets a regression test verified to fail under the old code.
- Run the full suite, typecheck and build before reporting done. On a fresh database, run `npx tsx prisma/seed.ts` first — the suite depends on seeded `TaxRuleSet` rows and fails ~28 tests without it.
- **`scripts/verify-real.ts` is the primary regression guard**, when its fixture is present. It reads a gitignored local fixture, `scripts/real-fixture.local.ts`, that does not exist in every checkout — **it was not present in this one, and this pass did not run it.** If you cannot run it, **say so explicitly** rather than omitting it from the report or repeating a prior pass's figures as if you'd confirmed them yourself.
- For UI work, do a live walkthrough against the dev server. **Do not report a page as verified if you did not load it.**
- A passing suite says nothing about whether a screen is usable. The first test drive stopped at step 4 of 16 with every test green.

## Convenience

- `Start Bookkeeping App.bat` at the repo root — double-click launcher, untracked, not present in this container checkout.
- `_test-files/` at the repo root — disposable dummy documents, untracked, not present here.
- `npm install` writes an `allowScripts` block into `package.json` on a real developer machine. It is machine-local and blocks branch switches there; the user stashes before checking out.

## Current priorities

See `CURRENT_STATE.md`. In short:

1. **Decide which branch is canonical** — `laughing-darwin` (this one) or `peaceful-goldberg`, or how to reconcile them. Almost everything else waits on this.
2. Run `scripts/verify-real.ts` wherever its fixture actually exists.
3. Build the **document archive browse view** — client → year, with a whole-year zip. The only genuinely new build left in the backlog on either branch.
4. `SPEC.md` now carries a dated banner (this pass) naming which sections a decision has superseded — read it before trusting any SPEC.md section on its own.
5. **Before the live Q3 cycle:** a backup for `data/app.db`, BIR verification of the seeded ATC codes, and a decision on whether the election check needs real enforcement before then.
6. The live 1701Q is due **November 16, 2026**. Excel remains the master until the branch decision is made.
