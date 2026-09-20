# DECISIONS.md

*Append new decisions. Mark superseded ones rather than deleting them.*
*Dates during the build are approximate — most work happened across August 2026.*
*Last reconciled: 2026-09-20 (evening), after two test drives and two rework passes.*

> **A decision being recorded here is not the same as it being built on every branch.** This file is decision history — it doesn't change when the tree changes. `CURRENT_STATE.md` says which branch has actually implemented which decision; check it before assuming a "current" decision below is running in the code you're looking at.

---

**D1 — Local-first, single operator, never deployed** *(2026-08)*
Runs on one laptop: SQLite file, filesystem documents, single `.env` password.
*Why:* will hold real TINs and income data under the Data Privacy Act; local means the data never leaves the machine.
*Implication:* Vercel or any hosting would need hosted Postgres, object storage, and real auth — a project, not a config change.

**D2 — Build phase by phase, stop at every boundary** *(2026-08)*
*Why:* a spec this size invites agent sprawl; each boundary is a review and commit point.

**D3 — Money as integer centavos, Decimal.js, no floats anywhere** *(2026-08)*
*Implication:* float arithmetic on currency is forbidden codebase-wide. One violation reached production code and was fixed in Phase 2b.

**D4 — Tax rates, thresholds, and deadlines live in a versioned `TaxRuleSet`, never hardcoded** *(2026-08)*

**D5 — `/lib/tax/` is pure functions with zero I/O** *(2026-08)*
*Implication:* tests use inline fixtures and must never read seed data or the database.

**D6 — `computationSnapshot` is frozen once filed; edits raise an `AmendmentAlert`** *(2026-08)*
*Why:* silent recomputation produces records that disagree with what BIR received.

**D7 — Transactions are entered quarterly, sourced from the client's 2307s** *(2026-08)*
**❌ SUPERSEDED 2026-09-20 by D26.** Certificates are no longer intended as an income source at all. **Implementation note:** this supersession is built on `claude/peaceful-goldberg-hsh6yo` only. `claude/laughing-darwin-wcnh8u` still runs the pre-D26 model this decision describes.

**D8 — No Excel importer; data is keyed manually** *(2026-08)*
*Implication:* `ImportBatch` tables were left in place unused, and have since been deleted on `peaceful-goldberg` (D25/D26 pass). They remain in place, unused, on `laughing-darwin`.

**D9 — §10 reconciliation rewritten** *(2026-08)*
**❌ LARGELY SUPERSEDED 2026-09-20 by D26 — on `peaceful-goldberg` only.** Two of the three panels presupposed a certificate-to-income conversion that D26 removes; on that branch they were deleted and replaced with one check (annual certificate gross totals against declared sales). **On `laughing-darwin`, the original three checks are still exactly what's built** — see SPEC.md §10 and `lib/reconciliation.ts`, both unchanged there.

**D10 — CWT cutoff is a per-filing `certificateCutoffDate`, not period end** *(2026-08)*
*Why:* the bookkeeper receives Q2 certificates around Aug 5, after the June 30 quarter end. Keying off period end would push **every** certificate a quarter late, understating CWT and overstating tax payable in every period.
*Resolution order:* manual override wins, else `filedAt`, else today (Manila).
*Still current on both branches.* The control moved into step 2 and was rewritten in plain language on `laughing-darwin` on 2026-09-20; the rule itself is unchanged everywhere.

**D11 — No amended returns** *(2026-08)*
*Implication:* late-arriving certificates flow into the next open period rather than reopening a filed one. This is what makes D10 workable.

**D12 — Prior-year excess credit applies in every cumulative period** *(2026-08)*

**D13 — eAFS = adjusted due date + 15 days** *(2026-08)*
Filing early does not move it earlier; only late filing re-anchors to `filedAt + 15`.

**D14 — `internalFilingTarget`: quarterly = adjusted due date (no buffer); annual = Mar 31** *(2026-08)*

**D15 — The system generates the Cash Receipts Journal only** *(2026-08)*
**❌ SUPERSEDED 2026-09-20 by D25 — the intended system now generates no books at all.** **Implementation note:** D25 is not built on `laughing-darwin`; the CRJ this decision describes is still generated there, unchanged.

**D16 — `SKIPPED` counts toward `COMPLETE`, alongside `DONE` and `NA`** *(2026-08)*
*Implication:* the distinction stays visible — "Complete (1 step skipped)" with reasons listed.

**D17 — Seed data derives every derived value; no hardcoded literals for computed fields** *(2026-08)*
*Exception:* frozen computation snapshots use hand-verified literal centavo integers deliberately, so they remain an independent check on the engine rather than a tautology.

**D18 — No .DAT file generation** *(2026-08)*
A keying worksheet in Alphalist field order is the substitute. Built on `laughing-darwin` (`lib/sawt/`); not independently reviewed against the actual Alphalist module's field order by the bookkeeper.

**D19 — Never invent BIR specifics** *(2026-08)*
ATC codes seeded sparse and flagged unverified; penalty rates left `null` with the calculator self-disabling.

**D20 — Date handling rules are codified in SPEC §4** *(2026-08)*
No `getUTC*()` extraction; calendar-day comparisons via `manilaCalendarDay()`; elapsed time by millisecond arithmetic; display only via `formatManilaDate()`. This bug class surfaced six real bugs (`c31f81a`). Confirmed SPEC.md §4 (a subsection of "Technical Stack," not a standalone section) still carries this text unchanged.

**D21 — Server Actions rather than REST API routes** *(2026-08)*

**D22 — Filing package manifest is a text file, not PDF** *(2026-08)*

**D23 — Pause building; validate against a live cycle before continuing** *(2026-09)*
*Vindicated twice.* Two hours of hands-on use produced every finding in D24–D29. No amount of further building would have produced them.

**D24 — The workflow's document requirements and the receipts entry model are both reopened** *(2026-09-19)*
**✅ FULLY RESOLVED 2026-09-20 by D25, D26 and D27**, on `peaceful-goldberg`. **D27 alone was implemented a second time, independently, on `laughing-darwin`**, against the pre-D26 income model — see the branch note in `CURRENT_STATE.md`.
The first test drive stopped at step 4 of 16. Verdict: *"The app is difficult to navigate and follow."* Three of the first four steps that asked for a document had their requirement rejected outright.

---

## 2026-09-20 — first redesign conversation

**D25 — The system generates no books of accounts; the Cash Receipts Journal is dropped from scope** *(2026-09-20)*
Supersedes D15. **Built on `claude/peaceful-goldberg-hsh6yo`. Not built on `claude/laughing-darwin-wcnh8u`** — `lib/books/` still generates the CRJ there.
*Why:* the bookkeeper receives 2307s once a quarter and has no monthly individual-receipt data in hand. A registered CRJ is a monthly book of individual receipts. The input required to produce one does not exist, and manufacturing a monthly split from a quarterly total would be invention (D19).
*Decision:* CRJ, CDJ, General Journal and General Ledger are entirely the client's responsibility.
*Implication:* the intended application is no longer an accounting system in any meaningful sense. Its identity is a **filing manager** — income record, tax calculator, process tracker, document archive. There is no ledger layer, once this decision is carried out everywhere.
*Flagged to the bookkeeper, outside this system's scope:* dropping the CRJ from the app removes no obligation on her clients to keep registered books.

**D26 — Gross sales are declared by the client per quarter. A 2307 is a credit record only.** *(2026-09-20, revised same day)*
Supersedes D7. Also supersedes the first version of D26 written earlier the same day, which had gross receipts as *certificates plus declared amounts*. That was wrong and the bookkeeper corrected it.
**Built on `claude/peaceful-goldberg-hsh6yo` (`QuarterlySales`). Not built on `claude/laughing-darwin-wcnh8u`** — `SalesTransaction`, sourced from 2307 conversion plus quick entry, is still the income record there.

*The rule:*
- **Gross sales/receipts come from one place only: the client's declared figure for the quarter.** Certificates contribute nothing to it.
- **A 2307 is authoritative for the withholding and for nothing else.** It reports what one payor paid and withheld.
- Income and credit are two independent inputs, exactly as the 1701Q treats them — gross sales on one line, creditable tax withheld on another.

*Why certificates cannot be the income source:* a 2307 only ever sees income from a payor who is a withholding agent. Income from non-withholding clients and direct consumers appears on no certificate at all. Summing certificates therefore understates gross sales for any client who is not fully withheld — and some of her clients issue no 2307 whatsoever and simply state their quarterly total.

*Consequences, where built:*
- The "create a transaction from a 2307" conversion flow is deleted, not improved, on `peaceful-goldberg`. It was rated *"very clunky"* and had no remaining purpose. **On `laughing-darwin` this flow still exists** (`app/(app)/clients/[id]/transactions/from-2307/[form2307Id]/page.tsx`).
- Entry is one figure per client per quarter, `Q1`–`Q4`. Four numbers a year, where built.
- **`QuarterlySales.quarter` includes `Q4`; `Filing.period` does not.** There is no Q4 return, so October–December income has no quarterly filing of its own and is picked up by the annual. These are two different types with two different CHECK constraints — do not merge them, wherever `QuarterlySales` is built.
- The tax engine is unaffected on both branches. It stayed validated against the real Q1 2026 filing through the whole change (subject to the fixture-availability caveat in `CURRENT_STATE.md`).
- The only surviving reconciliation, once this decision is fully carried out: certificate gross totals ≤ declared sales, **compared over the taxable year, not per quarter**. **On `laughing-darwin`, the original three checks are still what's running.**
- For a declared-income client nothing can be cross-checked against anything, once this decision is fully carried out. The `PREPARE_RETURN` acknowledgement becomes the only control in the system at that point.

---

## 2026-09-20 — second test drive

The second test drive walked all sixteen steps for the first time, on `peaceful-goldberg`'s declared-sales build. These three decisions come from it. **D27, D28, D29, and D30 were then implemented a second time, independently, on `claude/laughing-darwin-wcnh8u`, against the original pre-D26 income model** — both implementations are described in `CURRENT_STATE.md`.

**D27 — The app blocks on documents it receives. It never asks the bookkeeper to prove she did something.** *(2026-09-20)*
Supersedes the *"nothing blocks"* position taken earlier the same day, which was too absolute. **Built on both `peaceful-goldberg` and `laughing-darwin`**, independently.

*Three categories, and every step falls into one:*

| Category | Behaviour | Steps |
|---|---|---|
| Documents she **receives** from outside | Blocks `DONE` until attached | 6, 7, 9, 10, 11 (both slots), 13, 14 |
| Actions she **performs** elsewhere | No slot at all | 4, 12, 16 |
| A document delivered **to someone else** | Optional, hidden, never blocking | 15 only |

*The blocking steps* are the submission screenshot, filed form, proof of payment, TRRC, alphalist report and DAT file, acknowledgement email and validation email. Marking one done without its file records something that did not happen — the step *is* the document.

*The no-slot steps* are advising the client, emailing the DAT, and emailing the package. The application was asking her to prove her own work. She rejected this on three separate steps across two test drives; the slots are removed, not merely made optional.

*The single exception — step 15, eAFS.* In her words: *"The email goes directly to the client which sometimes they send to me but sometimes they don't."* The eAFS confirmation is the only document in the cycle addressed to the client rather than to the bookkeeper. Blocking would strand a filing on a file she cannot obtain; removing the slot would make a document she does sometimes receive impossible to keep. **Do not "fix" this inconsistency** — if a future pass finds one optional slot sitting among seven required ones, this is why.

*Unaffected, as intended:* the election hard-blocker still blocks. **In code, this is true only on `peaceful-goldberg`** (`lib/workflow/election.ts`). On `laughing-darwin` the election check is recorded but not enforced — see `CURRENT_STATE.md`.

**D28 — Quarterly sales are recorded before certificates** *(2026-09-20)*
Step 1 is **Record quarterly sales**; step 2 is **Receive Form 2307 from client**. Steps 3–16 keep their numbers. **Built on both branches**, though what step 1 links to differs: `/clients/[id]/income` (a new declared-sales form) on `peaceful-goldberg`, versus the pre-existing `/clients/[id]/transactions` on `laughing-darwin`.
*Why:* gross sales is the primary figure and the certificates are a credit applied on top. The order now mirrors both the return and the corrected model. It also replaced the orphaned `RECORD_CRJ` step, which survived the CRJ's deletion-on-`peaceful-goldberg` (and, on `laughing-darwin`, survived alongside a CRJ that was never deleted at all) and sat in the checklist under a title referring to a feature question already settled by D25 for that branch.
*Related:* a filing with no recorded sales must say so in words. A silent `₱0.00` reads as a real answer and is not one.

**D29 — Waiting blocks exactly one downstream step** *(2026-09-20)*
Marking a step `WAITING` does not block anything, with a single exception: **waiting at step 13 blocks step 14.** A validation email cannot arrive before the acknowledgement it follows. **Built on `laughing-darwin`** as a single explicit check in `markStepDone`.
*Why one edge and not a rule:* the bookkeeper specifically confirmed that waiting at step 10 (TRRC) and step 14 (validation) must **not** block her, because nothing downstream depends on either arriving. This is a physical sequence in one place, not a general principle. Implement it as an explicit dependency, never as "waiting blocks the next step."

**D30 — A document belongs to its step, not to the page** *(2026-09-20)*
The receipts confirmation, the certificate cutoff control and the computation sheet all rendered as page-level panels at the bottom of the filing page, detached from the steps they belonged to. Her reaction: *"Not sure what the bottom boxes are for."* **Built on `laughing-darwin`** by moving each panel into its step's card. `peaceful-goldberg` addresses the same complaint with a different mechanism (a next-action-line-plus-summary-strip component ahead of the checklist) — see `CURRENT_STATE.md`; the two are not the same implementation of this decision.
*Rule:* anything that belongs to a step renders inside that step's card. This is the same error the filing-page reorder fixed at page level — output shown ahead of, or apart from, the work it belongs to.
*Corollary:* **never expose a raw step code** (`PREPARE_RETURN`) in a user-facing label.

---

## 2026-09-20 — documentation pass, evening

**D31 — `claude/peaceful-goldberg-hsh6yo` and `claude/laughing-darwin-wcnh8u` are siblings, not a stack** *(2026-09-20)*
The four documents drafted for this documentation pass described `laughing-darwin` as built on top of `peaceful-goldberg`'s declared-sales rework. `git merge-base --is-ancestor` in both directions returns `false` either way; their only common commit is `e17e42c` (Phase 4). Every claim in the draft that depended on the stacking — `QuarterlySales`, the election blocker, `SalesTransaction`'s deletion, and others — was true of `peaceful-goldberg` and false of `laughing-darwin`, and has been corrected in `CURRENT_STATE.md`, `CLAUDE.md`, and `PROJECT_MASTER.md`.
*Why recorded here, not just fixed silently:* this is the same failure mode D24's "Phase 4 was never built" correction warned about — a status claim asserted without opening the tree, which then shapes a whole pass's understanding of what exists. It is recorded as a decision-log entry because the fix (this documentation pass) depended on treating the draft as unverified rather than authoritative, which is itself a decision about how to use these documents going forward: verify before writing, every time, no matter how detailed or confident the source.
*Not yet decided:* whether the branches should be reconciled, and if so which direction. Raised to the bookkeeper alongside this pass; see `CURRENT_STATE.md`.
