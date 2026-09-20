# DECISIONS.md

*Append new decisions. Mark superseded ones rather than deleting them.*
*Dates during the build are approximate — most work happened across August 2026.*
*Last reconciled: 2026-09-20 (evening), branch reconciliation pass (brief #3).*

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
**❌ SUPERSEDED 2026-09-20 by D26.** Certificates are no longer an income source at all.

**D8 — No Excel importer; data is keyed manually** *(2026-08)*
*Implication:* `ImportBatch` tables were left in place unused, and have now been deleted (D25/D26 pass).

**D9 — §10 reconciliation rewritten** *(2026-08)*
**❌ LARGELY SUPERSEDED 2026-09-20 by D26.** Two of the three panels presupposed a certificate-to-income conversion that no longer exists and were deleted; the CWT-vs-SAWT-batch panel was removed pending the SAWT module. One check replaces them: annual certificate gross totals against declared sales.

**D10 — CWT cutoff is a per-filing `certificateCutoffDate`, not period end** *(2026-08)*
*Why:* the bookkeeper receives Q2 certificates around Aug 5, after the June 30 quarter end. Keying off period end would push **every** certificate a quarter late, understating CWT and overstating tax payable in every period.
*Resolution order:* manual override wins, else `filedAt`, else today (Manila).
*Still current.* The control moved into step 2 and was rewritten in plain language on 2026-09-20; the rule itself is unchanged.

**D11 — No amended returns** *(2026-08)*
*Implication:* late-arriving certificates flow into the next open period rather than reopening a filed one. This is what makes D10 workable.

**D12 — Prior-year excess credit applies in every cumulative period** *(2026-08)*

**D13 — eAFS = adjusted due date + 15 days** *(2026-08)*
Filing early does not move it earlier; only late filing re-anchors to `filedAt + 15`.

**D14 — `internalFilingTarget`: quarterly = adjusted due date (no buffer); annual = Mar 31** *(2026-08)*

**D15 — The system generates the Cash Receipts Journal only** *(2026-08)*
**❌ SUPERSEDED 2026-09-20 by D25 — the system now generates no books at all.**

**D16 — `SKIPPED` counts toward `COMPLETE`, alongside `DONE` and `NA`** *(2026-08)*
*Implication:* the distinction stays visible — "Complete (1 step skipped)" with reasons listed.

**D17 — Seed data derives every derived value; no hardcoded literals for computed fields** *(2026-08)*
*Exception:* frozen computation snapshots use hand-verified literal centavo integers deliberately, so they remain an independent check on the engine rather than a tautology.

**D18 — No .DAT file generation** *(2026-08)*
A keying worksheet in Alphalist field order is the substitute. Built (`lib/sawt/`); not yet reviewed by the bookkeeper against the actual module's field order.

**D19 — Never invent BIR specifics** *(2026-08)*
ATC codes seeded sparse and flagged unverified; penalty rates left `null` with the calculator self-disabling.

**D20 — Date handling rules are codified in SPEC §4** *(2026-08)*
No `getUTC*()` extraction; calendar-day comparisons via `manilaCalendarDay()`; elapsed time by millisecond arithmetic; display only via `formatManilaDate()`. This bug class surfaced six real bugs.

**D21 — Server Actions rather than REST API routes** *(2026-08)*

**D22 — Filing package manifest is a text file, not PDF** *(2026-08)*

**D23 — Pause building; validate against a live cycle before continuing** *(2026-09)*
*Vindicated twice.* Two hours of hands-on use produced every finding in D24–D29. No amount of further building would have produced them.

**D24 — The workflow's document requirements and the receipts entry model are both reopened** *(2026-09-19)*
**✅ FULLY RESOLVED 2026-09-20 by D25, D26 and D27.**
The first test drive stopped at step 4 of 16. Verdict: *"The app is difficult to navigate and follow."* Three of the first four steps that asked for a document had their requirement rejected outright.

---

## 2026-09-20 — first redesign conversation

**D25 — The system generates no books of accounts; the Cash Receipts Journal is dropped from scope** *(2026-09-20)*
Supersedes D15.
*Why:* the bookkeeper receives 2307s once a quarter and has no monthly individual-receipt data in hand. A registered CRJ is a monthly book of individual receipts. The input required to produce one does not exist, and manufacturing a monthly split from a quarterly total would be invention (D19).
*Decision:* CRJ, CDJ, General Journal and General Ledger are entirely the client's responsibility.
*Implication:* the application is no longer an accounting system in any meaningful sense. Its identity is a **filing manager** — income record, tax calculator, process tracker, document archive. There is no ledger layer.
*Flagged to the bookkeeper, outside this system's scope:* dropping the CRJ from the app removes no obligation on her clients to keep registered books.

**D26 — Gross sales are declared by the client per quarter. A 2307 is a credit record only.** *(2026-09-20, revised same day)*
Supersedes D7. **Also supersedes the first version of D26 written earlier the same day**, which had gross receipts as *certificates plus declared amounts*. That was wrong and the bookkeeper corrected it.

*The rule:*
- **Gross sales/receipts come from one place only: the client's declared figure for the quarter.** Certificates contribute nothing to it.
- **A 2307 is authoritative for the withholding and for nothing else.** It reports what one payor paid and withheld.
- Income and credit are two independent inputs, exactly as the 1701Q treats them — gross sales on one line, creditable tax withheld on another.

*Why certificates cannot be the income source:* a 2307 only ever sees income from a payor who is a withholding agent. Income from non-withholding clients and direct consumers appears on no certificate at all. Summing certificates therefore understates gross sales for any client who is not fully withheld — and some of her clients issue no 2307 whatsoever and simply state their quarterly total.

*Consequences:*
- The "create a transaction from a 2307" conversion flow is deleted, not improved. It was rated *"very clunky"* and had no remaining purpose.
- Entry is one figure per client per quarter, `Q1`–`Q4`. Four numbers a year.
- **`QuarterlySales.quarter` includes `Q4`; `Filing.period` does not.** There is no Q4 return, so October–December income has no quarterly filing of its own and is picked up by the annual. These are two different types with two different CHECK constraints — do not merge them.
- The tax engine is unaffected. It stayed validated against the real Q1 2026 filing through the whole change.
- The only surviving reconciliation: certificate gross totals ≤ declared sales, **compared over the taxable year, not per quarter** — because D10 deliberately shifts a certificate's credit into the next open period, so a quarterly comparison would flag a variance nearly every time and be learned-ignored.
- For a declared-income client nothing can be cross-checked against anything at the source level. This is exactly why the `PREPARE_RETURN` acknowledgement's source-of-figure field (added alongside D27, documented there) matters: it's the one place the number's provenance gets written down, even though it isn't itself a cross-check.

---

## 2026-09-20 — second test drive

The second test drive walked all sixteen steps for the first time. These four decisions come from it.

**D27 — The app blocks on documents it receives. It never asks the bookkeeper to prove she did something.** *(2026-09-20)*
Supersedes the *"nothing blocks"* position taken earlier the same day, which was too absolute.

*Three categories, and every step falls into one:*

| Category | Behaviour | Steps |
|---|---|---|
| Documents she **receives** from outside | Blocks `DONE` until attached | 6, 7, 9, 10, 11 (both slots), 13, 14 |
| Actions she **performs** elsewhere | No slot at all | 4, 12, 16 |
| A document delivered **to someone else** | Optional, hidden, never blocking | 15 only |

*The blocking steps* are the submission screenshot, filed form, proof of payment, TRRC, alphalist report and DAT file, acknowledgement email and validation email. Marking one done without its file records something that did not happen — the step *is* the document.

*The no-slot steps* are advising the client, emailing the DAT, and emailing the package. The application was asking her to prove her own work. She rejected this on three separate steps across two test drives; the slots are removed, not merely made optional.

*The single exception — step 15, eAFS.* In her words: *"The email goes directly to the client which sometimes they send to me but sometimes they don't."* The eAFS confirmation is the only document in the cycle addressed to the client rather than to the bookkeeper. Blocking would strand a filing on a file she cannot obtain; removing the slot would make a document she does sometimes receive impossible to keep. **Do not "fix" this inconsistency** — if a future pass finds one optional slot sitting among seven required ones, this is why.

*The `PREPARE_RETURN` source-of-figure field* is a third thing again, distinct from both categories above, added at the same time this decision was implemented: not a document she receives (it's a text field she fills in herself, plus an optional attachment) and not proof of an action she performed (it doesn't ask her to justify a decision, only to record where a number came from). It exists because D26 removed every other way of cross-checking a declared figure. Required text, optional attachment, never blocking — see PROJECT_MASTER.md.

*Unaffected:* the election hard-blocker still blocks. It guards a wrong tax rate, not a missing file.

**D28 — Quarterly sales are recorded before certificates** *(2026-09-20)*
Step 1 is **Record quarterly sales**; step 2 is **Receive Form 2307 from client**. Steps 3–16 keep their numbers.
*Why:* gross sales is the primary figure and the certificates are a credit applied on top. The order now mirrors both the return and the corrected model. It also replaced the orphaned `RECORD_CRJ` step, which survived the CRJ's deletion and sat in the checklist referring to a feature that no longer existed.
*Related:* a filing with no recorded sales must say so in words. A silent `₱0.00` reads as a real answer and it is not one.

**D29 — Waiting blocks exactly one downstream step** *(2026-09-20)*
Marking a step `WAITING` does not block anything, with a single exception: **waiting at step 13 blocks step 14.** A validation email cannot arrive before the acknowledgement it follows.
*Why one edge and not a rule:* the bookkeeper specifically confirmed that waiting at step 10 (TRRC) and step 14 (validation) must **not** block her, because nothing downstream depends on either arriving. This is a physical sequence in one place, not a general principle. Implement it as an explicit dependency, never as "waiting blocks the next step."

**D30 — A document belongs to its step, not to the page** *(2026-09-20)*
The receipts confirmation, the certificate cutoff control and the computation sheet all rendered as page-level panels at the bottom of the filing page, detached from the steps they belonged to. Her reaction: *"Not sure what the bottom boxes are for."*
*Rule:* anything that belongs to a step renders inside that step's card. This is the same error the filing-page reorder fixed at page level — output shown ahead of, or apart from, the work it belongs to.
*Corollary:* **never expose a raw step code** (`PREPARE_RETURN`) in a user-facing label.
*Note from the reconciliation pass below:* the filing page's next-action line and summary strip (from the same test drive's earlier finding, "I don't know what to do with it... I realized I need to scroll down") are a *different* fix for a *different* complaint than this one, and both are kept — see D31.

---

## 2026-09-20, evening — branch reconciliation

**D31 — `claude/peaceful-goldberg-hsh6yo` is canonical; `claude/laughing-darwin-wcnh8u`'s checklist work is re-applied on top of it, not merged** *(2026-09-20)*

*The problem:* D25–D30 above were all decided from test drives, but the two rework passes that implemented them ran as sibling branches off the same base commit (`e17e42c`), not as a sequential stack. `peaceful-goldberg` built D25/D26 (the income model) plus its own version of the filing-page fix; `laughing-darwin` built D27–D30 (the blocking rule, step order, waiting dependency, panel placement) on top of the *pre-D26* income model, because a documentation brief asserted the two branches were already stacked when they weren't. That assertion was wrong and cost a full extra pass to discover and fix.

*The decision:* `peaceful-goldberg` becomes the base, for two reasons beyond the general "pick a base" question:
1. The second test drive that produced D27–D30 was run on `peaceful-goldberg`'s build. Those findings describe *that* application. Re-applying them there returns them to the app they were actually about.
2. `peaceful-goldberg` is where the real Q1 2026 figures were last re-verified against the replaced income model, reproducing to the centavo. That validation does not transfer to a different income-model implementation.

*What "re-applied, not merged" means in practice:* `laughing-darwin`'s commit `7bfbd5d` was read as a reference, not merged wholesale — most of it ported directly (the blocking table, the step 13→14 dependency, the computation-sheet auto-generation, the client email draft, the panel relocation, the completeness-note scope fix, the `WorkflowStepTemplate` seed bug fix, which existed independently on both branches and needed fixing here too), but step 1's link target had to change: on `laughing-darwin` it pointed at `/clients/[id]/transactions` because the declared-sales income form didn't exist there; on this reconciled branch it points at the real `/clients/[id]/income` form, since D26 is already built here.

*Kept from `peaceful-goldberg`, not replaced:* the next-action line and summary strip at the top of the filing page. This and D30's panel-relocation are different fixes for different findings from different points in the test-drive history (see D30's note above) — not two implementations of the same fix, so there was nothing to choose between.

*Recorded here, not just fixed silently:* this is the same failure mode D24's "Phase 4 was never built" correction warned about — a status claim (here, "these two branches are stacked") asserted without opening the tree, shaping a whole pass's understanding of what existed. `git merge-base --is-ancestor` in both directions would have caught it before any code was written. Verify branch relationships the same way you'd verify any other claim about what's built: by opening something, in this case the git history rather than a source file.

---

## 2026-09-20, evening — brief #4a

**D32 — The sixteen steps are wrapped in five groups: Prepare, File, Pay, SAWT, Close** *(2026-09-20)*

*The groups:*

| Group | Name | Steps |
|---|---|---|
| 1 | Prepare | 1 Record quarterly sales · 2 Receive Form 2307 · 3 Prepare computation · 4 Advise client |
| 2 | File | 5 File return · 6 Save submission screenshot · 7 Save filed form · 10 Receive TRRC |
| 3 | Pay | 8 Make payment · 9 Save proof of payment |
| 4 | SAWT | 11 Alphalist entry · 12 Email DAT · 13 Acknowledgement · 14 Validation |
| 5 | Close | 15 eAFS · 16 Email package to client |

*Why now:* a clean quarter was sixteen separate "Mark done" clicks and a sixteen-column board no one could read at a glance. Grouping doesn't change what any step requires — D27's blocking rule, D28's step order, D29's waiting rule are all untouched — it only changes where "done" is clicked and how the board is laid out. One "Mark done" per group marks every step in it at once; the driver is the click count (five instead of sixteen) and a five-column board instead of a sixteen-column one.

*The TRRC (step 10) sits with File (group 2), not Pay.* In the bookkeeper's words: "this is part of the filing process in eBIR." The TRRC is eBIRForms' confirmation that the return was *received* — it confirms the filing, not the payment. The schema already agreed before this decision: step 10's `category` has always been `FILING`, never `PAYMENT`.

*Step numbers are NOT renumbered to make groups contiguous, and that is deliberate.* Group 2 (File: steps 5, 6, 7, 10) is not contiguous — group 3 (Pay: steps 8, 9) sits between step 7 and step 10 numerically, because the TRRC arrives after payment in practice. Renumbering the TRRC to sit earlier (e.g. as step 8) would place it ahead of payment in the list and imply the bookkeeper waits for BIR's confirmation before paying — she does not. **Step numbers record the order things happen; groups record what things belong to.** These are two different facts about a step and collapsing them into one number would lose one of the two.

*Consequence, worth stating plainly:* group 2 (File) will routinely still be open — waiting on the TRRC — after group 3 (Pay) is fully done. This is normal work, not out-of-order completion, and raises no warning anywhere in the app. On the board, a card sits in its earliest incomplete *group* (group order, not raw step sequence), carrying that group's waiting state (e.g. "File — waiting on BIR, 12d") so a filing awaiting only the TRRC doesn't read as unfiled.

*Grouping reuses the seeded `category` field for three of five groups (File = `FILING`, Pay = `PAYMENT`, SAWT = `SAWT`), but not literally as the group.* Step 4 (`ADVISE_CLIENT`, category `CLIENT_COMM`) joins Prepare; step 16 (`SEND_CLIENT_PACKAGE`, also `CLIENT_COMM`) joins Close instead — reusing `category` outright would have put both in the same group despite belonging to different points in the cycle. Group membership is therefore its own fixed lookup table (`lib/workflow/groups.ts`), not a repurposing of `category`; `category` itself is untouched everywhere else it's read (seed, `WorkflowStep.category`, the step card).

*Blocking is unaffected — it only surfaces one level up.* A group's "Mark done" is disabled, with a plain-language reason next to it, while any step inside it is missing a required document — the same seven blocking steps as D27 (6, 7, 9, 10, 11 both slots, 13, 14), just reported once per group instead of once per button. Prepare and Close block on nothing, for now (Prepare gains a block in a later brief once step 2's 2307 scan becomes required). The election hard-blocker and the step 13→14 dependency (D29) are both unaffected; they still apply exactly as before, they just aren't part of the group's pre-click doc-slot message (neither was surfaced as a disabled-button reason at the single-step level before this pass either — this pass didn't add that, so it doesn't add it here).

*What didn't change:* Filing.status is still derived from steps, never from groups — there is no hand-set or separately-derived group-level status anywhere. Waiting is unchanged: per-step "Mark waiting" stays inside the expanded group; only the *collapsed* summary is new, surfacing any step's waiting state at the group level. Every per-step control (attach, skip with reason, mark waiting) is unchanged and still reachable by expanding a group.
