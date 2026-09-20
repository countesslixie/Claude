# CURRENT_STATE.md

*Living snapshot. Replace stale content rather than appending.*
*Last reconciled: 2026-09-20, evening — by opening the files on `claude/laughing-darwin-wcnh8u`, not from the conversation that drafted this pass.*

---

## Read this first: the branch this file describes

**This file describes `claude/laughing-darwin-wcnh8u`, and only that branch.** The draft of these four documents handed to this pass assumed `laughing-darwin` sits on top of `peaceful-goldberg`'s declared-sales rework. **It does not.** They are siblings:

```
claude/elegant-clarke-vu1xyd (e17e42c, "Phase 4")
  ├── claude/peaceful-goldberg-hsh6yo  (+f40de1b — declared-sales rework)
  └── claude/laughing-darwin-wcnh8u    (+7bfbd5d — blocking-rule rework)  ← this file
```

`git merge-base` confirms neither branch is an ancestor of the other; their only common commit is `e17e42c`. Verified by running `git merge-base --is-ancestor` both directions, 2026-09-20.

**Consequence: everything D25 and D26 decided is still unbuilt here.** `laughing-darwin` took the sixteen-step blocking rule (D27), the step reorder (D28), the step 13→14 dependency (D29), and the orphaned-panel fix (D30), and built them **on top of the original, pre-rework income model** — `SalesTransaction`, `lib/books/` (the CRJ generator), `ChartOfAccounts`, `JournalEntry`, `ImportBatch`/`ImportMappingProfile`, and the election status field with no enforcement — all still present, unmodified, and passing their original tests. `QuarterlySales` does not exist on this branch. There is no `/clients/[id]/income` route; income entry is still at `/clients/[id]/transactions`, sourced from Form 2307s plus a quick-entry path for non-2307 receipts. There is no election hard-blocker in code — only a dashboard warning label that says filings "are blocked" while nothing blocks them.

This is not a defect in this pass's work; it is a fact about which branch it started from. It is exactly the kind of thing this file exists to say plainly, and exactly the kind of thing the drafting conversation could not have known without opening the tree.

**If a task asks you to build against `QuarterlySales`, the election blocker, or a reduced one-check reconciliation, that code exists on `claude/peaceful-goldberg-hsh6yo`, not here.** Whether to merge that branch's work into this one, or which branch should become the default, is a decision for the bookkeeper — see the branch-consolidation question raised alongside this file.

---

## Where the code is

**Working branch: `claude/laughing-darwin-wcnh8u`.**

| Branch | Contains | Relationship |
|---|---|---|
| `claude/elegant-clarke-vu1xyd` | Base. `origin/HEAD` points here. Last commit `e17e42c` — Phase 4. | Common ancestor of the two below. |
| `claude/peaceful-goldberg-hsh6yo` | Declared-sales income model (`QuarterlySales`), election hard-blocker, filing-page redesign (`next-action-control.tsx`, `computation-sheet-panel.tsx`, `quarterly-sales-card.tsx`), `SalesTransaction`/`lib/books/`/`ChartOfAccounts`/`JournalEntry`/`ImportBatch` deleted. | Sibling of `laughing-darwin`, not its ancestor. |
| `claude/laughing-darwin-wcnh8u` | Corrected blocking rule (D27), step reorder (D28), step 13→14 dependency (D29), orphaned panels moved into steps (D30). Built on the **original** income model — nothing from the paragraph above is here. | Sibling of `peaceful-goldberg`, not its descendant. |

**Claude Code creates a new branch for every pass and does not announce the name unless asked.** After any Claude Code run: `git fetch --all` then `git branch -a`, and look for a `claude/...` branch you do not recognise.

**`npm install` writes an `allowScripts` block into `package.json`** (npm's build-script allowlist for prisma, esbuild, sharp) on a real developer machine. It is machine-local and regenerates itself; it is not present in this checkout, which has never run `npm install` interactively outside CI. `git stash` before checking out is part of the routine on a machine where it appears.

---

## Corrections to earlier versions of this file

**This pass's own draft assumed branch stacking that does not exist.** The four documents accompanying this brief described `laughing-darwin` as rework-pass-2-on-top-of-rework-pass-1. `git merge-base --is-ancestor` in both directions returns false either way; the branches share only `e17e42c`. Every claim in the draft about "what's built" on this branch that depended on that stacking (`QuarterlySales`, the election blocker, `SalesTransaction` deletion, the reconciliation reduced to one check, the income route at `/clients/[id]/income`) has been corrected below. This is recorded here, not just fixed silently, because the whole point of this section is that draft claims about build state must be checked against the tree before they're trusted — this pass is itself an instance of that rule.

**Phase 4 was built.** An earlier reconciliation stated flatly that it never existed. The commit log disproves this: `e17e42c — Phase 4: Cash Receipts Journal, SAWT module, XLSX exports` sits on the base branch, and on `laughing-darwin` it is still there, untouched — `lib/books/`, the SAWT batch/reconciliation code, and the XLSX exports all still run and are still tested.

**The test count is 155, confirmed by running the suite** (`npx vitest run`) on this branch, not by grepping source for `it(`/`test(`. 23 files, 155 passing, 0 failing, after `npx tsx prisma/seed.ts` (a fresh `data/app.db` fails 28 of them for lack of a seeded `TaxRuleSet` — that's a fixture-order issue, not a code defect, and resolves once the seed has run).

**There is no real client data in the application and never has been.** The three clients are fictitious seed data. One real client's Q1 2026 figures exist only in `scripts/real-fixture.local.ts`, gitignored, and **not present in this checkout** — see "Known limitations" below.

---

## What this application is, on this branch

**A filing manager built on the pre-rework income model**, with a corrected sixteen-step blocking rule layered on top. The intended long-run shape — declared-sales income, no books of accounts, an enforced election block — is recorded in `PROJECT_MASTER.md` and `DECISIONS.md` as decided, and is **not yet what's running here**.

What genuinely is built and running on this branch:

| Layer | Status here | Role |
|---|---|---|
| Income record | `SalesTransaction`, largely sourced from `Form2307` entries (a "convert 2307 to transaction" flow exists), plus a quick-entry path for receipts with no certificate | Pre-rework model. `QuarterlySales` does not exist here. |
| Books of accounts | `lib/books/` still generates the Cash Receipts Journal, exported as XLSX (`exceljs`) and printable HTML | D25 decided to remove this; not done on this branch |
| Computation | Pure derivation, `/lib/tax/`, unchanged by any rework pass | 8% cumulative, as SPEC.md §3.2 describes |
| Checklist | Sixteen steps; blocks only on documents received from outside (D27); step 1 is Record quarterly sales, step 2 is Receive Form 2307 (D28) | Built on this branch |
| Document archive | Local filesystem under `./storage`, SHA-256, enforced naming | Unchanged, works |

---

## Built and working, on this branch

**Phases 1–3** — Prisma schema and migrations, client CRUD, `ClientTaxYear`, `TaxRuleSet` and `Holiday` settings, single-password auth. Tax engine (`/lib/tax/`, pure). Form 2307 register. Workflow engine, 16-step board, document vault with SHA-256 and enforced naming. Dashboard with six panels. Per-step due dates. Filing package zip.

**Phase 4, as built on the base branch and never removed here** — the Cash Receipts Journal generator (`lib/books/assembleCrj.ts`, `crj.ts`, `crjExport.ts`), sourced from `SalesTransaction`; `ChartOfAccounts`/`JournalEntry`/`JournalEntryLine` in the Prisma schema (unused by the CRJ, kept per SPEC.md §9); the SAWT batch module and reconciliation (three checks — `lib/reconciliation.ts` — not the single check D26 describes); the Alphalist keying worksheet export, XLSX via `exceljs`.

**This pass (brief #2, D27–D30)** — corrected blocking rule: steps 6, 7, 9, 10, 11 (both slots), 13, 14 block `DONE` on a missing document; steps 4, 12, 16 carry no slot at all; step 15 (eAFS) is optional and collapsed. Step reorder: step 1 is now `RECORD_SALES` ("Record quarterly sales," linking to the existing `/clients/[id]/transactions` entry screen — **not** a new declared-sales model, just a link to the pre-existing page), step 2 is `RECEIVE_2307` with its own slot made optional. Step 13 → 14 dependency implemented as a single explicit check in `markStepDone`. Step 3 (`PREPARE_RETURN`) generates its own computation sheet as HTML into the vault on completion (`lib/documents/computationSheet.ts`) — no upload. Step 16 offers a package-download button and a copyable, auto-filled client email draft (`lib/workflow/clientPackageEmail.ts`). The computation sheet, certificate cutoff control, and the receipts-confirmation panel (retitled "Client confirmation," no more raw `PREPARE_RETURN` in the UI) now render inside their own step cards instead of as page-level panels at the bottom. The "documents not yet attached" banner lists only `DONE`/`IN_PROGRESS` steps, so it is empty on a fresh filing.

**Bug found and fixed during this pass** — the seed's `WorkflowStepTemplate` upsert used `update: {}`, so reseeding over an existing database never applied template changes; a step definition could be corrected in code and silently ignored at runtime. Fixed, and stale step codes (the retired `RECORD_CRJ`) now get `isActive: false` on reseed instead of lingering.

**Not on this branch** (exists only on `claude/peaceful-goldberg-hsh6yo`): `QuarterlySales`, the election hard-blocker (`lib/workflow/election.ts`), deletion of `SalesTransaction`/`lib/books/`/`ChartOfAccounts`/`JournalEntry`/`ImportBatch`, the income entry route at `/clients/[id]/income`, the reconciliation reduced to one check, and the `next-action-control.tsx`/`computation-sheet-panel.tsx`/`quarterly-sales-card.tsx` filing-page redesign.

**Not independently verified this pass** — the claim (carried over from the drafting conversation) that a real client's actual Q1 2026 figures reproduce through `computeFiling` to the centavo (gross ₱332,933.90, tax due ₱6,634.71, etc.). `scripts/verify-real.ts` reads a gitignored local fixture, `scripts/real-fixture.local.ts`, that **does not exist in this checkout** — it lives only on whichever laptop holds it. This pass did not run it and cannot confirm those figures from this environment. Tax-engine unit tests (`tests/tax/`) do pass here, which is a different and weaker guarantee.

---

## Test drives

**First — 2026-09-19.** Stopped at step 4 of 16. *"The app is difficult to navigate and follow."* Three requirements rejected outright, all of them demands for self-produced documents. Produced D24.

**Second — 2026-09-20.** Walked all sixteen steps, on `peaceful-goldberg`'s declared-sales build. Produced D25–D30 — the income model, the blocking rule, the step order, the waiting dependency, and the orphaned panels. **D27–D30 were then implemented separately, a second time, on `laughing-darwin`, against the older income model** — see the branch note at the top of this file.

**Third — status unknown to this pass.** The drafting conversation describes it as "in progress" against `laughing-darwin`. This file cannot confirm what it found; nothing in the repo records it yet.

---

## Not built (on this branch)

Everything under "Not on this branch" above, plus:

**The document archive browse view** — client → year, with a whole-year zip. Still the only genuinely new build in the backlog on either branch, and named as the most important thing the app does.

**Remainder of Phase 4's original intent that predates the rework decisions** — a calendar view; nothing else is outstanding from Phase 4 itself, since the SAWT batch module, keying worksheet, and XLSX exports are already built and present here (see "Built and working" above — the earlier drafting conversation believed these were gone; they are not, on this branch).

**Phase 5, deferred by decision:** email/IMAP integration, multi-user, .DAT generation, importers.

**Outstanding smaller items:**
- Per-step prep targets — all prep steps share `internalFilingTarget`, so every prep row shows the same date (SPEC.md §3.6, documented as a known, accepted limitation).
- PDF manifest in the filing package — ships as text, deliberate (D22).
- `SPEC.md` still describes the pre-rework system in several places now decided against (see the banner added to `SPEC.md` this pass) and, separately, still accurately describes what's actually running on this branch in several others (§7.1's step-16 dependency check, §9's CRJ, §10's three-check reconciliation) — the banner distinguishes decided-but-unbuilt from still-accurate rather than marking the whole file stale.

---

## Needs the bookkeeper's review

1. **Whether the two branches should be reconciled** — see the recommendation raised alongside this pass.
2. **Third test drive comments**, whatever they are — not visible from the repo.
3. **ATC codes** — only `WI010` and `WI011` seeded, both `verifiedAgainstIssuance: false`. Must be confirmed against the current BIR list before live use.
4. **SAWT keying worksheet field order** — exists on this branch (`lib/sawt/`), unlike the earlier draft's belief that it didn't; still needs a bookkeeper review against the actual Alphalist Data Entry Module field order.

---

## Open questions

- **Revenue recognition basis** — assumed collection. A per-client toggle was proposed, not built, on either branch.
- **eAFS on quarterly filings** — included for all periods and skippable per filing (this branch: optional, hidden, non-blocking, per D27); whether genuinely required quarterly remains open.
- **SAWT/eSubmission deadline** — configurable, defaults to the return deadline, never independently confirmed.
- **Which branch is canonical** — raised this pass, not decided.

---

## Known limitations

- Late-filing penalty calculator exists but **self-disables** — surcharge and interest rates are `null`, no compromise schedule, no verified BIR figures.
- Seed `waitingSince` timestamps are relative to wall-clock time at seed run, so ageing dates shift on every reseed. Expected.
- No PDF generation anywhere.
- **The election field is recorded but not enforced on this branch.** `Client.taxYears[].electionStatus` exists and the dashboard shows a warning ("Q1 filings are blocked until confirmed") when it isn't `ELECTED`, but nothing in `lib/actions/` or `lib/workflow/` actually blocks anything on it — the warning text overstates what the code does. The enforcement (`lib/workflow/election.ts`, `isElectionBlocked`) exists only on `peaceful-goldberg`.
- **`@radix-ui/react-dialog`, `react-label`, `react-select`, and `react-slot` are installed dependencies with no import anywhere in `app/`, `components/`, or `lib/`.** `components/ui/*` are plain HTML elements wrapped with Tailwind classes via the `cva`/`cn` convention, not built on these Radix primitives. "Tailwind + shadcn/ui" in the stack description is generous; treat `components/ui/*` as the actual UI layer and verify before assuming any Radix behavior (portals, focus trapping, accessibility roles) is present.
- **`data/app.db` has no backup.** Housekeeping while the data is seeded; a real single point of failure the day it is not.
- **`scripts/verify-real.ts` could not run this pass** — the fixture it reads is gitignored and not present in this checkout. See "Not independently verified this pass" above.

---

## Next, in order

1. **Decide which branch is canonical**, or how to reconcile them — blocks almost everything else below, since the two branches disagree on the income model.
2. Whatever the third test drive found, if it exists.
3. Run `scripts/verify-real.ts` somewhere the fixture exists, to close the unexercised regression guard.
4. Build the document archive browse view.
5. **Before live data in November:** solve the `data/app.db` backup, confirm the ATC codes, and decide whether the election check needs to actually block on this branch or only on whichever branch goes live.
6. **The live 1701Q is due November 16, 2026** (statutory Nov 15 is a Sunday). Excel remains the master until the branch decision is made.
