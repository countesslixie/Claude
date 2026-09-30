# DECISIONS.md

*Append new decisions. Mark superseded ones rather than deleting them.*
*Dates during the build are approximate — most work happened across August 2026.*
*Last reconciled: 2026-09-29 — brief #5p documentation pass (D94-D96 added: keep the payment lock, filing-order guard agreed not built, steps 13/14 renames agreed not built; supersession markers added on D6, D17, D27, D70, D73, D76, D82, D92), on top of brief #5o (D83-D93), on top of brief #5n (D78-D82: the mid-year guard, the BIR-wait tag, the slim filing bar, "Nothing to pay", and the rebuilt seed), on top of brief #5m (D70-D77), six groups replacing D32's five, BIR Confirmations built, and the Pay group built (closing D55's item 56/58 gap) — on top of brief #5l (D68-D69), brief #5k (D64-D67), brief #5j (D60-D63), brief #5i, brief #5h (D49-D59, briefs #5d-#5g), brief #5c, brief #5b (D48), brief #5a (D43-D47) and the documentation pass (brief #4f) through briefs #4c-#4e.*

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
**✅ Implemented 2026-09-29 by D83, and locked in by D94.** Until brief #5o this was decided but not honoured: nothing in production ever wrote `computationSnapshot`. Now step 5 Done writes it in the same transaction; see D83.

**D7 — Transactions are entered quarterly, sourced from the client's 2307s** *(2026-08)*
**❌ SUPERSEDED 2026-09-20 by D26.** Certificates are no longer an income source at all.

**D8 — No Excel importer; data is keyed manually** *(2026-08)*
*Implication:* `ImportBatch` tables were left in place unused, and have now been deleted (D25/D26 pass).

**D9 — §10 reconciliation rewritten** *(2026-08)*
**❌ LARGELY SUPERSEDED 2026-09-20 by D26.** Two of the three panels presupposed a certificate-to-income conversion that no longer exists and were deleted; the CWT-vs-SAWT-batch panel was removed pending the SAWT module. One check replaces them: annual certificate gross totals against declared sales.

**D10 — CWT cutoff is a per-filing `certificateCutoffDate`, not period end** *(2026-08)*
**❌ SUPERSEDED 2026-09-21 by D34 (brief #4b).** A certificate's credit period is now decided by which filing's step 2 it was entered under, not by `dateReceived` against a cutoff date. `certificateCutoffDate`, the manual override field, and the resolver function are all removed.

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
**⚠️ Checked 2026-09-28 (brief #5h) against D49's form-line rework:** `prisma/seed.ts`'s `buildSnapshot()` still hand-builds the *old* shape — the same fields `LegacyFilingComputationResult` has, centavo-rounded, no item numbers, no `isOverpaymentLine` — not the new `computeQuarterlyForm`/`computeAnnualForm` form-line shape. This is correct, not stale: it's exactly what `lib/tax/types.ts` already says happens to any snapshot frozen before brief #5d — never rewritten (locked rule #3), so it may not match the new shape despite sharing a `formType`. The exception above still holds; read it now as "an independent check on the legacy engine path," since that's the path these particular seeded, already-filed snapshots exercise. A *new* seeded filing computed fresh would go through the new form-shaped functions instead — `buildSnapshot()` was not changed to do that, since nothing asked it to and the seeded filings it's used for are meant to look already-filed.
**❌ SUPERSEDED for the seed 2026-09-29 by D82 and D83.** The old scenario seed and its hand-built `buildSnapshot()` are gone. The rebuilt seed files returns through the real `markStepDone`, which now freezes a genuine snapshot (D83), so the frozen-snapshot exception has nothing left to cover in the seed. D17's main rule (derive, never hardcode) stands.

**D18 — No .DAT file generation** *(2026-08)*
A keying worksheet in Alphalist field order is the substitute. Built (`lib/sawt/`); not yet reviewed by the bookkeeper against the actual module's field order.

**D19 — Never invent BIR specifics** *(2026-08)*
ATC codes seeded sparse and flagged unverified; penalty rates left `null` with the calculator self-disabling.

**D20 — Date handling rules are codified in SPEC §4** *(2026-08)*
No `getUTC*()` extraction; calendar-day comparisons via `manilaCalendarDay()`; elapsed time by millisecond arithmetic; display only via `formatManilaDate()`. This bug class surfaced six real bugs.

**D21 — Server Actions rather than REST API routes** *(2026-08)*

**D22 — Filing package manifest is a text file, not PDF** *(2026-08)* — **⛔ superseded 2026-09-30 by D103: the package zip has no manifest at all.**

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
**⚠️ PARTIALLY SUPERSEDED 2026-09-21 by D33 (brief #4b).** "One figure per client per quarter" is superseded — a quarter's gross sales is now the sum of one or more per-customer rows. Everything else below (a 2307 contributes nothing to gross sales, income and credit are independent inputs, the `QuarterlySales.quarter`/`Filing.period` split, the tax engine reading one summed gross figure) is unchanged.

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
- For a declared-income client nothing can be cross-checked against anything at the source level. ~~This is exactly why the `PREPARE_RETURN` acknowledgement's source-of-figure field (added alongside D27, documented there) matters: it's the one place the number's provenance gets written down, even though it isn't itself a cross-check.~~ **❌ SUPERSEDED 2026-09-26 by D37 (briefs #4c/#4d).** That field is gone. There is no longer any place, anywhere, that the number's provenance gets written down — see D37.

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

**⚠️ Step 2's row updated 2026-09-21 by D35 (brief #4b).** Step 2 (RECEIVE_2307) was optional/non-blocking when this table was written (D26 had just made 2307 entry safe to skip). It now blocks — see D35 — once step 2 was rebuilt to hold the certificates themselves rather than pointing at a separate optional slot.

*The blocking steps* are the submission screenshot, filed form, proof of payment, TRRC, alphalist report and DAT file, acknowledgement email and validation email. Marking one done without its file records something that did not happen — the step *is* the document.

*The no-slot steps* are advising the client, emailing the DAT, and emailing the package. The application was asking her to prove her own work. She rejected this on three separate steps across two test drives; the slots are removed, not merely made optional.

*The single exception — step 15, eAFS.* In her words: *"The email goes directly to the client which sometimes they send to me but sometimes they don't."* The eAFS confirmation is the only document in the cycle addressed to the client rather than to the bookkeeper. Blocking would strand a filing on a file she cannot obtain; removing the slot would make a document she does sometimes receive impossible to keep. **Do not "fix" this inconsistency** — if a future pass finds one optional slot sitting among seven required ones, this is why.
**❌ SUPERSEDED 2026-09-29 by D89.** Step 15 now has no document slot at all, so the third category ("a document delivered to someone else — optional, hidden, never blocking") is retired; step 16's forwarding line went with it. D93 also makes step 15 conditional on there being a Form 2307.

~~*The `PREPARE_RETURN` source-of-figure field* is a third thing again, distinct from both categories above, added at the same time this decision was implemented: not a document she receives (it's a text field she fills in herself, plus an optional attachment) and not proof of an action she performed (it doesn't ask her to justify a decision, only to record where a number came from). It exists because D26 removed every other way of cross-checking a declared figure. Required text, optional attachment, never blocking — see PROJECT_MASTER.md.~~
**❌ SUPERSEDED 2026-09-26 by D37 (briefs #4c/#4d).** This field, and the attachment slot it carried, are both gone. See D37 for what the bookkeeper decided and why.

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

**⚠️ The one-click "Mark done" per group is gone, superseded 2026-09-28 by D62 (brief #5i), her decision.** A group no longer has a "Mark done" of its own at all — every step finishes on its own per-step control, and the group header only ever reports Pending or Done. Everything else below — the five groups, their membership, the non-contiguous File group, and the board's layout — is untouched and still current.
**⚠️ The table of five groups is superseded 2026-09-29 by D70 (brief #5m §1), her decision.** There are now SIX groups — steps 10 (RECEIVE_TRRC) and 14 (SAWT_VALIDATION) move out of File and SAWT respectively into a new BIR Confirmations group. See D70. What survives from this entry: step numbers are still not renumbered to match group order (the reasoning below for why still holds, just with a sixth group now sharing in it), and the "she waits, nothing downstream depends on it" reasoning for the TRRC's own placement is exactly what motivated giving it (and step 14) their own group rather than leaving this table's five untouched.

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
**⚠️ Narrowed 2026-09-29 by D75 (brief #5m §3.1), her decision.** The TRRC moved to its own group (D70) before this could keep meaning "File" — what survives is the general shape (a later-group step can finish before an earlier-group one, and vice versa, with no warning). What's now DIFFERENT: Pay itself is no longer independent of File the way it once was — D75 makes Pay wait for ALL of File (5, 6, 7) to be Done before it even opens, so "Pay finishing before File" is no longer possible at all; what remains true is Pay finishing before BIR Confirmations (the TRRC's new home), which behaves exactly as this paragraph originally described.

*Grouping reuses the seeded `category` field for three of five groups (File = `FILING`, Pay = `PAYMENT`, SAWT = `SAWT`), but not literally as the group.* Step 4 (`ADVISE_CLIENT`, category `CLIENT_COMM`) joins Prepare; step 16 (`SEND_CLIENT_PACKAGE`, also `CLIENT_COMM`) joins Close instead — reusing `category` outright would have put both in the same group despite belonging to different points in the cycle. Group membership is therefore its own fixed lookup table (`lib/workflow/groups.ts`), not a repurposing of `category`; `category` itself is untouched everywhere else it's read (seed, `WorkflowStep.category`, the step card).

*Blocking is unaffected — it only surfaces one level up.* A group's "Mark done" is disabled, with a plain-language reason next to it, while any step inside it is missing a required document — the same seven blocking steps as D27 (6, 7, 9, 10, 11 both slots, 13, 14), just reported once per group instead of once per button. Prepare and Close block on nothing, for now (Prepare gains a block in a later brief once step 2's 2307 scan becomes required). The election hard-blocker and the step 13→14 dependency (D29) are both unaffected; they still apply exactly as before, they just aren't part of the group's pre-click doc-slot message (neither was surfaced as a disabled-button reason at the single-step level before this pass either — this pass didn't add that, so it doesn't add it here).
**⚠️ "A plain-language reason next to it" is superseded 2026-09-26 by D41 (brief #4e).** The reason is a hover tooltip on the "Mark done" button now, not standing text next to it. The blocking rule described here is otherwise unchanged.

*What didn't change:* Filing.status is still derived from steps, never from groups — there is no hand-set or separately-derived group-level status anywhere. Waiting is unchanged: per-step "Mark waiting" stays inside the expanded group; only the *collapsed* summary is new, surfacing any step's waiting state at the group level. Every per-step control (attach, skip with reason, mark waiting) is unchanged and still reachable by expanding a group.

---

## 2026-09-21 — brief #4b (the bookkeeper walked the five-group structure; these three came out of that walkthrough)

**D33 — A quarter's gross sales is the sum of per-customer rows, not one typed figure** *(2026-09-21)*
Partially supersedes D26 — the "one figure per client per quarter" clause only. Everything else D26 established (a 2307 contributes nothing to gross sales, income and credit are independent inputs, the `QuarterlySales`/`Filing.period` split) is unchanged, and `/lib/tax/` is unaffected: the engine still receives one summed gross figure per quarter, computed from the rows rather than typed directly.

*The rule:* a `QuarterlySalesCustomer` row per customer (name + amount); `QuarterlySales.grossSalesCents` is derived by summing them on every save, never itself an input. Rows are added and removed freely. ~~The per-quarter fields (non-operating income, the source-of-figure note, notes) stay per quarter, not per customer — D26's `PREPARE_RETURN` source-of-figure control is unaffected.~~ **❌ The source-of-figure note is superseded 2026-09-26 by D37 (briefs #4c/#4d) — that field and control are both gone.** The per-quarter Notes field remains (non-operating income, notes stay per quarter, not per customer).

*"No sales this quarter" is a deliberate ₱0* — `QuarterlySales.noSalesThisQuarter` — distinct from a quarter with no row at all. `hasSalesRecordedForPeriod` (rework brief #2 §3.1) is unaffected: it still keys on row existence, and a deliberate no-sales quarter is a row, so it reads as "recorded," correctly.

*Draft vs. Save:* Save as draft stores the rows without marking step 1 (`RECORD_SALES`) done; Save does both, by calling the same `markStepDone` the per-step control always used (so the election hard-blocker still applies). ~~Once step 1 is done, further edits — draft or final — never undo it; the quarter stays editable until its own return is filed.~~ **⚠️ SUPERSEDED 2026-09-22 by D40 (brief #4d).** Saving an edited, already-final quarter as a draft now *does* revert step 1 to open — the bookkeeper asked for a real Edit/Cancel flow on the income page, and a draft save has to mean draft. The quarter otherwise stays editable until its own return is filed, unchanged. This does not change what step 3 (`PREPARE_RETURN`) generates: the computation sheet always reads the live `QuarterlySales` figures at generation time, same as before, whether the quarter behind them is a draft or finalized.

*Step 1's card is now fully derived* — no Start, Mark waiting, Mark done, Skip, or skip-reason box left on it at all; it shows "Waiting on client" until a final Save, then "Done," plus the quarter's total once saved, with one button through to income entry. ~~The income page, opened from a filing (`?filingId=`), shows only that filing's own quarter as editable and every other quarter of the year as a read-only table (quarter, customers, total, source) with links to their own filings; opened without a filing, every quarter renders read-only the same way.~~ **⚠️ The "source" column is superseded 2026-09-21 by D37 (brief #4c) — removed along with the field it displayed.** The read-only table's remaining columns (quarter, customers, total) and the read-only-elsewhere behavior are unchanged; see D40 for how the editable quarter itself now also opens read-only once final. A quarter is read-only once its own filing's step 5 (`FILE_RETURN`) is `DONE`.

**D34 — A certificate's credit period is the filing it was entered under, locked once filed** *(2026-09-21)*
Supersedes D10 entirely. `certificateCutoffDate`, `Filing.certificateCutoffOverride`, and `resolveCertificateCutoffDate()` are removed — from the screen and from `lib/tax/cwt.ts`'s cumulative CWT assembly and `lib/sawt/`'s eligibility selection. ~~and `scripts/verify-real.ts`'s fixture shape~~ **❌ SUPERSEDED 2026-09-26 by D42 (brief #4e) — `scripts/verify-real.ts` and its fixture arrangement are deleted outright, not merely updated.**

*The rule:* `Form2307.claimedOnFilingId` is set once, at entry (under a filing's step 2), and never reassigned. `sumCwtThroughPeriod` now takes each certificate's claimed *period* and a target period, and includes it if its claimed period is that period or an earlier one in the same taxable year — the same cumulative shape as before, just keyed on where it was entered rather than when it arrived. ~~`dateReceived` is kept as a recorded fact on the certificate; it no longer decides anything.~~ **❌ SUPERSEDED 2026-09-22 by D38 (brief #4d) — `dateReceived` is removed from `Form2307` entirely, not merely stripped of its deciding role.**

*Why this still works:* D11 (no amended returns) is unchanged, and is exactly what makes this safe — step 2's certificate list locks the moment its filing's step 5 (`FILE_RETURN`) is `DONE`, so a certificate can never be added to, or removed from, a period already filed. A certificate that arrives after filing is entered under whichever filing is next open (usually the next quarter or the Annual) — her choice, made simply by which filing's step 2 page she's on when she enters it; there is no dropdown to pick a period.

*Confirmed unaffected:* the annual certificates-vs-declared-sales check (`lib/reconciliation.ts`) compares over the whole taxable year regardless of which quarter a certificate is claimed on, so this change doesn't touch it — a certificate entered under any quarter still counts toward the same annual total either way.

**D35 — Step 2 blocks: "all certificates received" plus a scan on every row** *(2026-09-21)*
Updates D27's table (step 2's row) and fits D27's own category rule — a 2307 is a document she receives from outside, so it belongs with the blocking steps, not the optional ones. It was optional at D27's writing because entry hadn't been rebuilt yet; it now has somewhere real to point at.

*The rule:* step 2 (`RECEIVE_2307`) holds one row per certificate — payor, income amount, tax withheld, ~~date received,~~ and its own scan (`Document.form2307Id`), with the remaining existing `Form2307` fields (TIN, address, ATC code, rate, the certificate's own period) behind a "more" disclosure. **❌ "Date received" is superseded 2026-09-22 by D38 (brief #4d) — the field is gone from the form and the row.** `Filing.certificatesAllReceivedAt` records the "All certificates received" checkbox. Step 2 is `DONE` only when that checkbox is ticked **and** every row has a scan attached — the first blocking rule inside Prepare. Unlike step 1, this is a genuine two-way toggle: unticking (to add a late-arriving row before filing) reverts step 2 to "Waiting on client," not to some separate unresolved state.

*Skip stays, by hand, with a reason* — for clients who never issue 2307s or a quarter with none. There remains no automatic "no 2307s" client setting; that was a deliberate choice, not an oversight (mirrors D26/D28's certificate-independence design). **⚠️ Refined 2026-09-22 by D39 (brief #4d) — Skip now shows only while zero certificate rows exist; the checkbox above takes over once one is entered.**
**⚠️ Skip is no longer step 2's only manual control once used, as of 2026-09-28, D60 (brief #5i).** A skipped step 2 stays visible in place, with an **Undo skip** button alongside its reason — see D60.

*The old separate Form 2307 register screen* (`/clients/[id]/form-2307`) is now read-only — entry moved into step 2. It still shows the annual certificates-vs-sales reconciliation and the SAWT keying-worksheet link, and each row links to the filing it was claimed on, but its own entry form and route (`/form-2307/new`) are gone.

**D36 — Prepare's own "Mark done" is disabled until steps 1 and 2 are resolved** *(2026-09-21, same brief)*
Steps 1 and 2 now complete themselves (D33/D35), so Prepare's group-level "Mark done" only ever has steps 3-4 left. It is disabled, with a plain-language reason, until step 1 is `DONE` and step 2 is `DONE` or `SKIPPED` — a return can't be prepared without the sales figure or the certificates. *Proposed by Claude and flagged to the bookkeeper; if she objects, it comes out.* Implemented as `prepareGroupBlockReason()` in `lib/workflow/groups.ts`, consulted by both the group card (client-side disable) and `markGroupDone` (server-side enforcement) — one function, not two copies that could drift.
**⚠️ The "plain-language reason" wording is superseded 2026-09-26 by D41 (brief #4e).** The reason no longer renders as standing text — it's a hover tooltip on the disabled button now. The rule itself (disabled until steps 1/2 resolve, enforced server-side) is unchanged.
**⚠️ The group-card consumer is gone, superseded 2026-09-28 by D62 (brief #5i).** `markGroupDone` is deleted and the group card carries no "Mark done" of its own to disable. `prepareGroupBlockReason()` still gates step 3, but now solely from inside `markStepDone` — one consumer, not two.

---

## 2026-09-21 to 2026-09-26 — briefs #4c, #4d, #4e (bookkeeper walkthroughs of the rebuilt Prepare group)

**D37 — The `PREPARE_RETURN` source-of-figure field and the client-confirmation attachment are both removed; nothing now records where a declared figure came from** *(2026-09-21/22, briefs #4c and #4d)*
Supersedes the source-of-figure portions of D26 and D27 (see the ❌ markers added to both above).

*What went, across two briefs:* Brief #4c removed the required source-of-figure text field from the income page and from step 3's acknowledgement, plus the "Source" column in the read-only other-quarters table. Brief #4d then removed the rest of step 3's acknowledgement outright — the yes/no "have you confirmed with the client that all receipts are accounted for" question, its optional note, the Confirm button, and the optional client-confirmation-message attachment slot (`client_confirmation_evidence`). Both `Filing.receiptsAcknowledgedAt` and `Filing.receiptsAcknowledgedNote` are dropped from the schema (confirmed absent, 2026-09-26).

*Why, stated plainly rather than glossed over:* the bookkeeper made both calls knowingly, one brief apart, having watched the field in actual use. With both gone, **there is no control of any kind over a declared income figure.** The per-quarter Notes field (`QuarterlySales.notes`) still exists and can hold anything she chooses to write, but nothing asks for an entry and nothing requires one — it is a free-text field, not a substitute control. The only surviving reconciliation of any kind is still the annual certificates-vs-declared-sales check (`lib/reconciliation.ts`), which was never a source-level check to begin with.

*What step 3 holds now:* the computation sheet it generates itself, plus the ordinary step controls (Start, Mark done, Skip). Nothing else.
**⚠️ "Start, Mark done, Skip" is out of date as of 2026-09-27, brief #5f — see D54.** Step 3 lost Start and Skip both; only Mark done is left.

**D38 — `dateReceived` is removed from `Form2307` entirely** *(2026-09-22, brief #4d)*
Completes D34 — D34 had already stopped `dateReceived` from deciding a certificate's credit period, but kept the column itself as "a recorded fact." Brief #4d removed it outright, after switching its last two readers first:
- The SAWT keying worksheet (`lib/sawt/keyingWorksheet.ts`) sorted its rows by `dateReceived`; it now sorts by `payorName`, then `payorTin` as a tie-breaker.
- The annual certificates-vs-declared-sales check (`lib/reconciliation.ts`) needed no code change at all — it already keyed on `Form2307.taxableYear`, itself set from the filing a certificate was entered under at creation time, never from `dateReceived`. A regression test was added to prove this (a certificate entered under a 2025 ANNUAL filing counts in 2025, not 2026, even though the old dateReceived-keyed logic would have miscounted a January-received certificate into the following year).

The certificate entry form, the saved row, the schema column, the seed, and every test referencing the field were all updated to match.

**D39 — Step 2's "All certificates received" checkbox only renders once at least one certificate row exists** *(2026-09-22, brief #4d)*
With zero certificate rows, step 2 shows only "Add certificate" and "Skip" (with its reason box) — ticking a checkbox that describes zero rows made no sense, and skipping is the only sensible action for a client who won't have any. Once one or more rows exist, the checkbox appears and Skip is hidden — skipping no longer makes sense once certificates are actually being entered. Removing the last row reverts to the first state, and unticks the checkbox if it had been ticked. The underlying blocking rule (D35) is unchanged: `DONE` still requires the checkbox ticked and every row scanned.

**D40 — The income page shows draft/final state explicitly, opens read-only with an Edit button once final, and a final Save returns to the filing page** *(2026-09-22, brief #4d)*
Extends D33. D33's original "once step 1 is done, further edits never undo it" is **also superseded here** — see the note added to D33 above.

*What changed:* the editable quarter's card now names its own state at the top — no label if nothing's saved yet, "Draft saved [date] — not final. Step 1 is still open." for a draft, "Saved [date] — step 1 is done." once final. A final quarter opens **read-only** with an **Edit** button; Edit reveals the same form plus a **Cancel** button (discards unsaved changes, returns to read-only). Saving an edited quarter as a draft now reverts step 1 to open, with the "Draft saved" label — this is the one place D33's "never undo it" no longer holds, per the bookkeeper's explicit request for a working Edit/Cancel flow. A quarter that's only ever been a draft still opens directly editable, no toggle, as before. A successful final Save now leaves the income page and returns to the filing page automatically; Save as draft stays on the income page with a short "Draft saved" confirmation instead. On the filing page, step 1's own card shows a "DRAFT" tag beside the total whenever it isn't final, so a draft figure can't be mistaken for a finished one.

**D41 — All standing block-reason text is removed from the checklist; the reason becomes a hover tooltip on the disabled control** *(2026-09-26, brief #4e)*
**Reverses the "plain-language reason next to it" wording in D32 and D36.** The bookkeeper found the identical sentence rendering in up to three places at once for the same rule: under a group's header, under a disabled per-step "Mark done," and under the top-of-page "Next action" banner (a third spot found during this brief, not named in D32/D36's original wording but rendering the exact same text) — plus a red "Missing required documents: …" line using the same mechanism on File/Pay/SAWT. All of it is gone. Every disabled "Mark done" (group or step) now carries its reason as a `title` attribute instead — discoverable on hover, not occupying the page.

*Explicitly unchanged:* the rules themselves, and their server-side enforcement — nothing about what blocks a step or a group changed, only where the explanation is displayed. The short amber "waiting on …" summary beside each group's name is unaffected and stays as the one piece of standing status text.
**⚠️ The group half of "per step or per group" is moot as of 2026-09-28, D62 (brief #5i).** A group no longer has a "Mark done" to disable, so there's no group-level tooltip left to speak of — only a Pending/Done status label. The principle itself (a reason lives on hover, never as standing text) is unchanged and still governs every per-step "Mark done," including the disabled ones.

*Prepare's summary, fixed as part of the same brief:* it used to read "waiting on Client, 0d" regardless of which of its two self-completing steps (quarterly sales, Form 2307) was actually the holdup — no more informative than the standing text it sat next to, once that text was gone. It now names the specific thing outstanding: "waiting on quarterly sales," "waiting on Form 2307," or both, falling through to the ordinary waiting-step label once both are resolved (e.g. step 4 genuinely marked waiting on the client).

*Checked and left alone:* the separate "N documents not yet attached" note (`lib/workflow/completeness.ts`) is a different mechanism — gaps on `DONE`/`IN_PROGRESS` steps, dismissible, not a blocking reason — and does not render as any of the removed lines.

**D42 — The real-figures regression guard is an ordinary committed test, not a script reading a local fixture** *(2026-09-26, brief #4e)*
Supersedes the `scripts/verify-real.ts` / `scripts/real-fixture.local.ts` arrangement entirely (see the ❌ marker added to D34 above, where that arrangement is also mentioned).

*Why:* confirmed 2026-09-26 that `scripts/real-fixture.local.ts` — gitignored by design, holding one real client's filed Q1 2026 figures — has never actually existed on any machine this project has run on: not on the `vm` checkout Claude Code runs from, and not on the bookkeeper's own laptop either. The guard it was meant to provide had therefore never once actually run, on any pass.

*The replacement:* `tests/tax/realFilingQ1_2026.test.ts`, an ordinary test with an inline fixture (as `/lib/tax/` tests require — D5), running with the rest of the suite every time. It carries the same five amounts already written elsewhere in these notes (gross ₱332,933.90, taxable ₱82,933.90, tax due ₱6,634.71, CWT ₱16,646.70, overpayment ₱10,011.99) and nothing else — no client name, TIN, payor name, or address. The ₱16,646.70 CWT figure is represented as a single certificate, named "Payor A," for the full amount: the real split behind that total was never recoverable in any environment this project reaches, so one certificate is what's actually verifiable rather than a plausible-looking invention. Verified to fail on a one-centavo drift in any input and to pass again once reverted, before being committed.
`npm run verify:real` is removed along with the script it ran.
**⚠️ The centavo figures above are what this test asserted as of this brief (2026-09-26) — superseded 2026-09-27 by D49 (brief #5d).** The test itself was rewritten to assert the filed form's own whole-peso figures instead (tax due ₱6,635.00, total credits ₱16,647.00, overpayment ₱10,012.00) — see D49 and CLAUDE.md's "How to test." What's unchanged: it is still `tests/tax/realFilingQ1_2026.test.ts`, still an ordinary committed test with an inline fixture, still running with the rest of the suite, still carrying no client-identifying data.

---

## 2026-09-26 — brief #5a (bookkeeper's walkthrough of step 2: ATC codes, a saved customer/payor list, entry fixes)

**D43 — ATC codes get a maintenance screen, and the rate becomes a property of the code, not a separately-typed figure** *(2026-09-26, brief #5a)*

*The rule:* Settings gains an ATC codes screen (alongside Holidays and Tax rule sets, `lib/actions/atcCodes.ts`, `app/(app)/settings/atc-codes/`), backed by the existing `AtcCode` table (D19) — add, edit, deactivate (no hard delete; `isActive` is how a code stops being offered). `verifiedAgainstIssuance` is shown plainly everywhere a code appears — the list, the edit form, the certificate form's picker — never tucked away, per D19: an unverified code must never look authoritative.

On the certificate form, the free-text "ATC code" box and separate "Rate (%)" box are gone. ATC code is now a picker of the *active* codes only (`components/atc-code-select.tsx`); choosing one fills the rate from `AtcCode.rateBps`. The rate field stays visible and editable — the certificate is authoritative over the code when they disagree, not the other way around — and if she types a different rate, `Form2307.rateOverridden` records the disagreement while her value is what's saved (`lib/actions/form2307.ts`'s `addCertificate`). If the active-codes list is empty, the picker says so in place of an empty dropdown and links to Settings, rather than silently blocking her with no explanation.

*What did NOT change:* no code is seeded by this brief — WI010 and WI011 stay exactly as they were, both unverified (D19's "never invent" applies as much to this pass as to the original seed).

**D44 — "Customers / payors": one saved list per client, shared by step 1's customer field and step 2's payor field, but never linked to either's numbers** *(2026-09-26, brief #5a, her decision)*
**⚠️ Renamed "Payors" on screen 2026-09-27 by D48 (brief #5b)** — the label only; the `Payor` model/table and every internal field name below are unchanged.

*Why:* a company recorded as a customer in step 1 is usually the same company that issues a 2307 in step 2. Free-typed twice in two different screens, it drifts — two spellings of the same payor, one screen with a TIN and the other without.

*The rule:* a new `Payor` model, one row per client (name, TIN, address, usual ATC code, active flag; `@@unique([clientId, name])`). Step 2's payor-name field and step 1's customer-name field both read this list through the same component (`components/payor-name-field.tsx`) — a native `<datalist>` so free typing still works, not a combobox library. Picking a saved name on step 2 fills TIN, address and ATC (and therefore the rate, via D43); picking one on step 1 fills only the name, since step 1 has nothing else to fill. Either way the fill is a one-time autocomplete, not a link: everything stays independently editable on that one row/certificate afterward, and editing there never rewrites the saved entry. Typing a name that isn't on the list offers to save it inline, right there (`createPayorInline`, `lib/actions/payors.ts`) — no trip to a separate screen before finishing a certificate or a customer row. A small per-client screen (`/clients/[id]/payors`) covers add/edit/deactivate for when she wants to fix a saved entry, but it is explicitly not the only way in.

*What this is not:* a link between income and certificates. `QuarterlySalesCustomer` and `Form2307` both stay exactly as free-typed rows with no foreign key to `Payor` — picking a saved name changes what gets typed into those rows, never what the rows themselves mean. D26 and D33 are untouched: gross sales is still only the sum of step 1's per-customer rows, and a certificate still contributes nothing to it. Confirmed no path exists, before or after this brief, for a certificate to affect gross sales.

*Seed:* the sample clients get a few starter entries (`prisma/seed.ts`'s `seedPayors`) matching names already used elsewhere in the seed, so the picker isn't empty on a fresh database.

**D45 — Payor TIN, payor address and ATC code are now required on a certificate** *(2026-09-26, brief #5a)*

Alongside the payor name, income amount, tax withheld and period covered that were already required. Validated with Zod server-side (`lib/validation/form2307.ts`'s `certificateEntrySchema`) as well as on the form — refusing an empty required field never depended on the form alone. The "more fields" disclosure these three used to sit behind (with the withholding rate) is gone: once they joined the main form, nothing required was left behind a disclosure, so the disclosure itself was removed rather than kept empty (`components/certificate-form.tsx` replaces the old inline form in `components/receive-2307-step-card.tsx`).

**D46 — The scan is part of saving the certificate; D35 is now satisfied by construction, not earned afterward** *(2026-09-26, brief #5a, her decision)*

*The rule:* the file input moved into the certificate form itself and is required — `addCertificate` (`lib/actions/form2307.ts`) refuses to save without one, attaching it in the same action via a shared helper (`saveDocumentForStep`, factored out of `lib/actions/documents.ts`'s `uploadDocument` so both share one code path). If the scan fails to save (e.g. a disk-write error), the just-created `Form2307` row is hard-deleted rather than left as an orphan with no scan — it was never persisted "for real" from her point of view. There is no more separate upload step on a saved row afterward; what remains is **Replace scan** — a saved row's scan is one-for-one, not accumulating, so uploading a new one automatically soft-deletes whichever one it replaces (never a hard delete — SPEC.md's no-hard-deletes-on-financial-records rule still applies to the superseded copy).

*What did NOT change:* D35's actual blocking rule (step 2 is `DONE` only once "all certificates received" is ticked **and** every row has a scan) is unchanged — it's just unreachable to violate now, since a row can't exist without a scan in the first place. A row from before this brief that somehow lacks one still blocks exactly as D35 always said, and still offers "Attach scan."

**D47 — Three entry-form and collapse fixes to step 2, from watching it in use** *(2026-09-26, brief #5a)*

1. *The form now closes after saving.* Before this fix, a blank "Add certificate" form stayed open below the saved row permanently — the specific thing that made step 2 impossible to collapse. `components/certificate-form.tsx` calls back to its parent once the server action reports `saved`, which closes it back to an "Add certificate" button.
2. *Step 2 collapses to a summary line once resolved* (Done or Skipped) — e.g. "3 certificates · ₱16,646.70 withheld" — with a "Show rows" link, matching the same collapse-when-resolved shape the group cards already use. This is a client-side default (expanded while unresolved, collapsed once resolved at the point the card first renders), not a change to what `DONE`/`SKIPPED` mean.
3. *While "All certificates received" is ticked, no certificate can be added or removed.* The Add button and each row's Remove action are hidden — not merely disabled — with one short line saying to untick first; unticking restores both. This is enforced server-side too (`addCertificate`/`deleteCertificate` both refuse while `Filing.certificatesAllReceivedAt` is set), not only by hiding the buttons, so the rule holds even if the action is ever called directly. This is a deliberate, narrow exception to D41's "no standing block-reason text" — the checkbox already means "the set is complete," so the line explains a state she just set herself, not a rule blocking her from something she's trying to do; it is one line, appears in exactly one place, and disappears the moment she unticks it.

*Checked and confirmed unaffected by this whole brief:* D26/D33 (gross sales stays step-1-only, a certificate contributes nothing to it), D34 (a certificate still counts in the filing it was entered under, locked once filed), D35 (restated more precisely by D46 above), D39 (Skip still shows only while there are no rows), D3 (money stays integer centavos on the Decimal.js path — the percent-to-basis-points conversion used for the rate here is the same `percentToBps` #4c already added, no new float arithmetic anywhere).

---

## 2026-09-27 — brief #5b (bookkeeper's walkthrough of brief #5a's saved payor list)

**D48 — Saving a new payor opens a small dialog for its full details; a certificate can offer to fill a gap back onto it; the list is called "Payors" on screen** *(2026-09-27, brief #5b, her decisions)*

*Why:* D44 (brief #5a) only ever saved the bare name from step 1, so TIN, address and ATC still had to be typed on the payor's first certificate. And a payor saved from step 1 with no TIN or address would go on to trip step 2's required fields (D45) with nothing to autofill from.

*The dialog:* clicking "Save … to payors" (step 1's customer-name field or step 2's payor-name field, both via `components/payor-name-field.tsx`'s `onRequestSave`) now opens `components/payor-details-dialog.tsx` — a native `<dialog>` (`showModal()`, Escape-to-close and focus containment for free), not Radix (still installed unused, still not to be started). It offers name (pre-filled from what she typed, editable), TIN, address and usual ATC code (D43's picker). Only the name is required — she often records income long before she has a payor's TIN, and a blank field is saved blank, not invented (D19 by extension). Cancel, the dialog's own X, or Escape leaves the row's typed name exactly as it was, unsaved — the same outcome as today's "Not now". One dialog instance, used identically from both step 1 and step 2; step 1 still only had a name to fill from picking a saved entry, but can now capture the rest at save time instead of never.

*Fill-back:* on step 2, when she fills a certificate field (TIN, address, ATC) that is blank on the row's matched saved payor, a one-line offer appears — "Save this as `<payor>`'s `<field>` too?" — calling `fillPayorDetail` (`lib/actions/payors.ts`) on Save. Her choice; nothing here is automatic. The action itself only ever fills a field that is still blank when it runs (checked server-side, not just by the offer's own condition) — if the payor already has a value, that value is returned untouched and the offer never even appears, per D45's rule that the certificate is authoritative over the payor when they disagree, never the other way around.

*The rename:* "Customers / payors" becomes "Payors" everywhere it was user-facing — step 1's column header, the "Add customer"/"Customer name" text, the saved-list screen and its heading and empty state, the save prompt, and the client-page nav link. **Screen text only.** Left alone, deliberately, per the brief: the `Payor` Prisma model and table, `QuarterlySalesCustomer` and its `customerName` column, the `customers`/`CustomerRow`/`customerName` identifiers throughout `components/quarterly-sales-card.tsx` and the income page, and every test and comment that names these internals. None of it was worth a migration or a wire-format rename for a label change.

*Confirmed unaffected:* D26/D33 (the saved list still only fills a row/certificate, never links income to credit), D45 (certificate required fields, unchanged), D46 (scan-on-save, unchanged), D47's tick-locks-the-list rule (unchanged), D41 (no standing block-reason text — the fill-back offer is a one-line, dismissible, opt-in prompt, not a block).

---

## 2026-09-27 — brief #5d (bookkeeper's walkthrough of step 3: the computation itself)

**D49 — The computation follows the BIR form's own lines, with its whole-peso rounding** *(2026-09-27, brief #5d, her decision)*

*Which forms.* The sheet mirrors the 1701Q (items 47–58, 61–63; 59–60 left out, never used on this form) and the 1701A column A (items 47–49, 52–60, 63–65; 50–51, 61–62 left out — the annual form has no prior-quarter carry and no separate items 61/62 to total before its own item 63). Every line carries the form's own item number and wording (`lib/tax/compute.ts`'s `computeQuarterlyForm`/`computeAnnualForm`, confirmed against their `breakdown[]` arrays).

*The rounding.* Rounding is half-up to the whole peso, at exactly the items eBIRForms rounds. Money is still stored as integer centavos: a rounded line is just a multiple of 100.
- The 1701Q builds its cumulative income from each quarter's own rounded item 49 (item 50 is simply the previous quarter's own item 51) — never a rounded raw multi-quarter total.
- The 1701A rounds its input lines (47, 52, 57–60) before computing from them; 49/53/55/56/64/65 are then computed from those already-whole figures.

*Why.* She was shown the app disagreeing with her real filed Q1 return (₱6,634.71 vs the form's ₱6,635.00). She chose to follow the form.

*This amends locked rule #1 (the rounding only).* The formula, the ₱250,000 rule and the cumulative approach are unchanged.

*Exact figures stay exact.* The VAT threshold monitor and the annual certificates-vs-sales check still use unrounded figures — only the computation sheet itself follows the form's rounding.

*Only two forms are in scope: the 1701Q and the 1701A.* She has no mixed-income clients.
- Form 1701 has no sheet. It still runs through the old `computeFiling`, renamed `LegacyFilingComputationResult`/`LegacyFilingComputationInput` in `lib/tax/types.ts`.
- The `MIXED_INCOME` code and the seed client stay, for the day a mixed-income client does arrive.

*Markers:*
- on D42: the real-figures test now asserts the form's figures line by line (tax due ₱6,635.00, total credits ₱16,647.00, overpayment (₱10,012.00)), not the old centavo figures — see the marker added there.
- on D3: unaffected — money is still integer centavos throughout; whole-peso rounding just means a rounded line is a multiple of 100, computed via the same `Decimal.js`/`roundToWholePesoCents` path as every other money figure.

## 2026-09-27/28 — briefs #5d, #5e, #5f (the Prepare group's remaining walkthroughs: step 3's reopening, step 4, and mid-year clients)

**D50 — A change to the figures behind a prepared computation reopens steps 3 and 4** *(2026-09-27, brief #5d; refined 2026-09-27, brief #5e; extended 2026-09-27, brief #5f; extended again 2026-09-28, brief #5i)*

**⚠️ Extended 2026-09-28 by D61 and D60 (brief #5i).** The same figures-changing step 1 saves listed below now also un-skip a Skipped step 2 (D61); undoing step 2's skip by hand (D60's Undo skip) is itself a reopening trigger, same as adding or removing a certificate. Both are additions to *what reopens*, not changes to the rule itself.

*The rule.* While the filing is unfiled (step 5, `FILE_RETURN`, not Done), a change after step 3 is Done sets steps 3 and 4 back to `PENDING`. **⚠️ The next sentence is superseded 2026-09-28 by D62 (brief #5i)** — there is no group-level "Mark done" left to revert; the Prepare group's header simply reads Pending again, derived live from its steps the same as before. ~~The Prepare group's own "Mark done" reverts from a Done pill back to a button as a consequence, since it's derived live from its steps.~~

*What reopens* (`lib/actions/workflowSteps.ts`'s `reopenPreparedFiling`, called from each of these):
- A final save of step 1 that actually changed the figures behind the computation (`lib/actions/quarterlySales.ts`).
- A draft save of step 1, when step 1 was previously final (going from Done back to "waiting on client" is itself the figures-changed case here).
- Adding or removing a certificate (`lib/actions/form2307.ts`'s `addCertificate`/`deleteCertificate`).
- A saved change to item 61/63 on this filing (`lib/actions/filings.ts`'s `updateFilingOtherCredits`) — and it propagates forward to every later filing of the same taxable year that still inherits the figure, stopping at the first one with its own saved value.
- A saved change to the starting figures (`lib/actions/startingFigures.ts`'s `saveStartingFigures`) — reopens every unfiled filing of the year at once, since the starting figures feed all of them.

*What doesn't:*
- A save that changes nothing (`quarterlySales.ts`'s `figuresChanged` guard; `updateFilingOtherCredits`'s `changed` guard).
- Replace scan (`lib/actions/documents.ts` — a scan swap never touches the figures).
- Unticking "All certificates received" on its own (`lib/actions/filings.ts`'s `setAllCertificatesReceived`) — **#5e reversed #5d here, her decision:** #5d had this reopen steps 3/4 too; she found that too eager, since unticking alone changes nothing about the figures — it only reverts step 2 itself. Only actually adding or removing a certificate reopens anything downstream.

*What happens when it reopens.* Each step transition is logged in `ActivityLog`, same as any other step update. The saved computation sheet is regenerated when step 3 is marked Done again (`ensureComputationSheetSaved`); the prior copy is soft-deleted, never overwritten in place. Step 4's saved advice message is cleared at the same time, so the card rebuilds a fresh live preview rather than showing stale saved text until step 4 is marked Done again.

*Filed filings are untouched* — `reopenPreparedFiling` no-ops the moment `FILE_RETURN` is Done, regardless of which caller reaches it.

*Why.* She found step 3 still showing Done on top of a draft (unfinal) step 1 — the sheet had been generated for figures that no longer held.

**D51 — Step 4 (Advise client)** *(2026-09-27, briefs #5d–#5f, her decisions)*

*Controls.* Step 4 is no longer a waiting step — Start and Mark waiting are both gone (`components/workflow-step-card.tsx`'s `controlsMode="markDoneOnly"`); it was never actually something the client responds to in a way worth tracking. Its own Mark done is blocked until step 3 (`PREPARE_RETURN`) is Done, enforced server-side (`lib/workflow/groups.ts`'s `adviseClientBlockReason`, consulted inside `markStepDone` itself). **⚠️ The rest of this sentence is superseded 2026-09-28 by D62 (brief #5i)** — `markGroupDone` is deleted, so there is no group-level path left to bypass in the first place; `markStepDone`'s own check is the only enforcement, which is exactly what made it safe to remove the group action. ~~— the group's own "Mark done" can't bypass it either, since `markGroupDone` calls the same per-step check in ascending sequence order.~~ Step 4 shows no message at all until step 3 is Done.

*The message.* A copyable client message in her own wording, built by a pure function (`lib/workflow/clientTaxAdviceMessage.ts`'s `buildClientTaxAdviceMessage`). It comes in three versions: payable (states the amount and the client due date, asks when she'll pay or whether to advance it), quarterly overpayment (states there's nothing to pay this quarter, applied to the next return), and annual overpayment (names the year-end election — refund, TCC, or carry-over — only if one is actually set; otherwise says she'll be in touch about it). The "If you have any questions…" closing line from #5d's first draft was removed in #5f — her edit.

*When step 4 is marked Done,* the exact text is saved on the filing (`Filing.adviceMessageSubject`/`Body`/`SavedAt`), and the card collapses to "Advised [date] · Amount payable ₱X" (or "Overpayment ₱X"). Reopening (D50) clears the saved text; marking step 4 done again rebuilds the message fresh from the live figures.

*The client's due date* — shown inside the message only, changes no deadline elsewhere. It's the BIR adjusted due date minus `TaxRuleSet.clientPaymentLeadDays` (default 10, never a literal in code), shifted **earlier**, never later, to the previous working day if that lands on a weekend or a `Holiday`-table date (`lib/tax/deadlines.ts`'s `clientPaymentDueDate`).

*Still true:* step 4 has no document slot at all (D27) — advising the client is an action she performs elsewhere, and the app doesn't ask her to prove it.

**D52 — "Waiting on …" shows only for a step actually waiting** *(2026-09-27, brief #5d)*

The label (`components/workflow-step-card.tsx`) now keys on the step's live `status === WAITING_EXTERNAL`, not the seeded `isWaitingState` template flag that used to gate it. It had been wrong on every step the template marks `isWaitingState: true` — `RECORD_SALES`, `RECEIVE_2307`, `RECEIVE_TRRC`, `SAWT_ACK` and `SAWT_VALIDATION` (confirmed against `prisma/seed.ts`'s step-template rows) — each of which could show "waiting on X" beside a Done pill once actually resolved, because the flag that gates the label is permanent but the status it was describing had moved on.

**D53 — The group button has three states** *(2026-09-27, brief #5e)*

**⚠️ SUPERSEDED 2026-09-28 by D62 (brief #5i), her decision.** There is no group "Mark done" at all any more, in any state — only two things remain, a grey Pending label and a green Done pill, and neither is a button. The clickable middle state this entry describes is gone entirely; read on for history only.

`components/workflow-group-card.tsx`'s "Mark done" now reads: a non-clickable grey **Pending** label (the block reason as its hover tooltip, D41-compliant) while blocked; the ordinary clickable **Mark done** button once the group can be finished; a green **Done** pill once every step in it is resolved.

*Why.* A disabled "Mark done" looked like a button she could press and nothing would happen — the same complaint, one level up, that motivated tooltips over standing text (D41).

*Also confirmed:* Prepare closes itself the moment steps 1–4 are all resolved — there is no separate "close the group" click; the group card's own state is entirely derived from its steps, same as before this brief. She confirmed she wants it this way.

*Marker on D36:* its "disabled, with a plain-language reason" wording is superseded twice over now — first by D41 (tooltip, not standing text), and the disabled state itself is now the "Pending" label described here, not a disabled button.

**D54 — Step 3 can't be started or skipped** *(2026-09-27, brief #5f, her decision: "it is the heart of the app")*

Start and Skip are both gone from step 3's card (`controlsMode="markDoneOnly"`, same mechanism as D51's step 4). `lib/actions/workflowSteps.ts`'s `skipStep` refuses `PREPARE_RETURN` outright, server-side, so the rule can't be bypassed by calling the action directly. Step 3 holds the credits box (item 55 read-only, item 61 editable — see D55), which now sits **above** the computation sheet it generates, so she fills in credits first and reads the result after.

*Marker on D37:* its "the ordinary step controls (Start, Mark done, Skip)" line describing step 3 is now out of date — see the marker added there.

**D55 — The credit lines: 55, 56 and 61** *(2026-09-27, brief #5e; reworked 2026-09-27, brief #5f, her decisions)*

*Item 61 / 63 (other tax credits) — one figure per return, not per year.* Stored on `Filing.otherCreditsCents`/`otherCreditsDescription`; `null` means "not yet saved on this filing." It inherits the previous filing's own saved figure (or, for the year's first in-app filing, the starting figures' item 61) until it's saved here — `lib/filingComputation.ts`'s `effectiveOtherCreditsFor` walks that chain, never copying an inherited figure in as if it were locally saved. Save/Edit/Cancel, same shape as the income page's D40 pattern; locked once this filing's own step 5 is Done. **This supersedes brief #5e's first version, which briefly lived as a year-level field on `ClientTaxYear`** — one taxable year, one figure, no per-quarter override — before she asked for it to vary return by return instead. `ClientTaxYear` itself carries no such field today; confirmed absent from `prisma/schema.prisma`.

*Item 55 / 57 (prior year's excess credit) — display-only on step 3, entered only in the starting figures.* It still appears in full on every return of the year (D12, unchanged) — `ClientTaxYear.priorYearExcessCreditCents` is the one figure the tax engine reads, written once from the starting figures (D56) and never edited on the year record directly any more: the Taxable-years table's credit column and the tax-year edit form's credit field are both gone (`lib/validation/clientTaxYear.ts` no longer accepts it). Automatic carry-over from last year's own Annual overpayment into next year's starting figure is **not built** — deferred to the Pay-group work, and first actually matters for the 2026→2027 boundary.

*Item 56 / 58 (payments for earlier quarters) — calculated, not typed:* the sum of `Filing.amountPaidCents` across this taxable year's earlier, already-filed filings. **Known gap:** nothing in the app writes `amountPaidCents` yet for a return filed inside the app, so this line reads ₱0 for any quarter actually prepared and filed here — only a mid-year client's *outside* starting figure (`StartingFigures.amountPaidThisReturnCents`, D56) currently feeds it. The Pay-group build is what's expected to close this.

## 2026-09-27 — brief #5f (mid-year clients; the live Q3 cycle is coming and every current client joins mid-year)

**D56 — Starting figures for a client joining mid-year** *(2026-09-27, brief #5f, designed with her 2026-09-27)*

*Why.* Every current client's Q1 and Q2 2026 were filed from Excel, so at go-live every client joins the app mid-year — there was no "first quarter in the app" scenario the original design assumed.

*What she enters,* per client-year, typed from the client's latest return filed outside the app, into `StartingFigures` (one row per `clientId`/`taxableYear`):
- `latestOutsideReturn`: `NONE`, `Q1`, `Q2` or `Q3`
- item 55 (prior year's excess credit) — always entered, regardless of `latestOutsideReturn`
- item 51 (cumulative taxable income as of that return)
- items 57 and 58 (withholding for previous quarters, and for that quarter)
- item 56 (payments for previous quarters) and, separately, the amount actually paid on that return itself
- item 61 with its description
- optional non-operating income so far this year

*Rules* (`lib/validation/startingFigures.ts`): non-operating income can't exceed cumulative income. The figures are read-only after Save, with an Edit button (same shape as D40's income-page pattern). They're locked for good once the year's first in-app return is filed (`lib/startingFigures.ts`'s `isStartingFiguresLocked` — derived from whether that filing's own step 5 is Done, never a stored flag).

*How the figures flow:* into 1701Q items 50 (previous cumulative), 55, 56 and 57 on the year's first in-app return; into 1701A items 47, 52, 58 and 59 for a client whose whole year is reconstructed from starting figures, with declared full-year sales computed as item 51 minus non-operating income. The VAT threshold monitor includes the starting cumulative income, not just what's been declared in the app.

*Outside quarters.* A period `latestOutsideReturn` names as already filed gets **no `Filing` row generated at all** (`lib/workflow/filingGeneration.ts`'s `generateFilingsForClientYear` skips it outright) — that absence is what keeps it off the board, the dashboard, and every overdue/aging check; there's no workflow to be behind on. `Filing.filedOutsideApp` is a separate, narrower flag for the rarer case where a `Filing` row already existed (generated before starting figures later named that period outside) — `saveStartingFigures` sets or clears it on whatever rows already exist, rather than deleting them. **Corrected here against the code, not as the brief for this pass described it:** a flagged (`filedOutsideApp: true`) row is *not* hidden on the client page — it renders explicitly as "Filed outside the app," greyed out with no status or deadline, rather than either vanishing or being shown as ordinary work (confirmed in `app/(app)/clients/[id]/page.tsx` and `app/(app)/clients/[id]/income/page.tsx`, and stated plainly in the schema comment on the flag itself). The *ordinary* case shows no line simply because there is nothing to iterate — no row was ever created — not because of a deliberate suppression rule.
Saving starting figures **does not itself create the newly-inside period's `Filing` row** — it only reclassifies existing rows' `filedOutsideApp` flag and reopens filings that inherit (D50). Bringing a newly-inside period onto the board still takes an ordinary (idempotent, safe to re-run) call to "Generate filings" afterward — that's the actual mechanism behind her observation that Q2 appeared once she moved `latestOutsideReturn` from Q2 back to Q1.

*Known limit.* The annual certificates-vs-sales check only ever sees certificates entered in the app, so for a mid-year client it covers only the in-app portion of the year — it can't falsely flag a problem, but it isn't a full-year check for that client.

*Order for a new client:* add the client → add the tax year → enter the starting figures → generate filings. Either order of the middle two works, since generation simply skips whatever starting figures currently name as outside.

**D57 — `npm install` regenerates the database client** *(2026-09-27, brief #5f)*

A `postinstall` script now runs `prisma generate` (`package.json`). *Why:* she hit a red error screen twice from a stale Prisma Client after pulling a migration, before realizing `npm install` alone doesn't regenerate it.

---

## 2026-09-28 — brief #5g (the new look)

**D58 — The new look** *(2026-09-27/28, brief #5g, her decisions)*

*Palette,* copied from her other app and defined once as CSS variables in `app/globals.css`, exposed to Tailwind via `@theme inline` (Tailwind v4 — confirmed via `@import "tailwindcss"` and the absence of a `tailwind.config.*` file; no upgrade, per locked rule #9): purple `#7046C6` (`--purple-600`) for place and clickable things, her own red/green/amber, a lavender-grey page background (`--background`), white cards (`--surface`).
- Status colours: grey pending, **purple** in progress (was blue — her decision), amber waiting, red overdue, green done.
- The `--faint` grey (`#8a879a`) measures 3.49:1 against white — below the usual 4.5:1 text minimum. **Kept knowingly:** she read it and found it fine. (Flagged again here rather than silently accepted, since it's a real accessibility number, not a design opinion.)

*Font.* Plus Jakarta Sans, weights 400/500/600/700, Latin subset, `.woff2`, fetched once via `npm pack @fontsource/plus-jakarta-sans` and committed into the repo (`app/fonts/plus-jakarta-sans/`, with its OFL licence alongside), loaded via `next/font/local`. `next/font/google` was rejected outright — it fetches from Google at every build or `dev` start, which is exactly the outbound request locked rule #7 forbids, and fails silently (plain fallback font, no warning) the moment the laptop is offline. Verified live with all non-localhost network requests blocked: the app renders identically, and zero external requests are attempted. Tabular figures (the font's own `tnum` OpenType feature, confirmed present) are applied to money columns wherever amounts line up — the computation sheet, and the 2307/SAWT/tax-rule-set tables.

*Menu.* A left-side menu headed "BIR Filing Manager" / "8% Tax Rate," replacing the old top bar: Dashboard (ungrouped) · **Work** (Filings, Clients) · **Settings** (Tax rule sets, Holidays, ATC codes). The Settings *heading itself* links to `/settings` — the old hub page, otherwise now unreachable from the menu, that still lists what's built and what's coming later. Icons come from `lucide-react`, a `package.json` dependency since before this brief but never actually imported until now — not a new dependency.

*Archive documents stay plain.* The generated computation sheet's HTML (`lib/documents/computationSheetHtml.ts`) uses the new font stack and plain ink/faint/line/amber/green hex values directly — no purple, no dependency on the app's own stylesheet — since it's meant to outlast the app and be read as a standalone file.

**D59 — An overpayment shows in parentheses** *(2026-09-28, brief #5g)*

1701Q item 63 and 1701A item 65 now show an overpayment as **"(₱X)"**, with the row labelled "… — overpayment" (e.g. "63. Tax Payable/(Overpayment) — overpayment"), both on screen (`components/computation-sheet-panel.tsx`) and in the saved computation-sheet HTML. `BreakdownLine` gained an `isOverpaymentLine` flag for exactly this row; `lib/money.ts`'s `formatBreakdownAmount()` is the one place that turns it into parentheses, used by both renderers.

*Why.* Her walkthrough of #5f found item 63 showing a plain positive figure indistinguishable from tax payable, even though the sheet's own heading already correctly said "Overpayment" — the heading was right, the table row wasn't.

*Not coloured.* Deliberately no red or green here — it's a figure, not a verdict, and D58's status colours are a different mechanism for a different kind of information.

*Unchanged:* step 4's own advice message (D51) already said "Overpayment" in words and wasn't touched.

---

## 2026-09-28 — brief #5i (the Prepare group's remaining walkthrough: skipped steps, the group button, the counter, status labels)

**D60 — A skipped step stays in its group, and can be undone** *(2026-09-28, brief #5i, her decision)*

*The rule.* A skipped step is a decision she made, not a step that doesn't apply — it must never be hidden the way `NA` is. It renders in place inside its group, in step order, collapsed by default like Done, with a grey Skipped pill and its reason on one line. A new **Undo skip** control (`unskipStep`, `lib/actions/workflowSteps.ts`) restores the step to whatever its own rules say next — step 2 reruns `recomputeReceive2307Status` (via `reopenSkippedReceive2307`) rather than being forced back to "Not started"; every other skippable step returns to `PENDING`, its ordinary state before it was ever skipped. Refused once the filing's own step 5 (`FILE_RETURN`) is Done — the same lock step 2's certificate list already has (D34/D11). The skip reason is never silently discarded: it's kept in the `ActivityLog` "before" snapshot even once the live row's own `skippedReason` is cleared.

*Which steps this applies to — stated plainly so nothing gets "fixed" that was never broken.* Only steps that can be skipped at all get an Undo skip: not step 1 (self-completing, D33, never had a Skip control), not step 3 (D54 refuses Skip outright, server-side), and not step 4 (never had a Skip — confirmed by her on the walk). Do not add an unskip path for any of these three; there is nothing to undo.

*The toggle.* The top-of-workflow "Show N skipped/NA" toggle now covers `NA` steps only — relabelled "Show N not applicable," counting only `NA` steps. A Skipped step was never meant to sit behind the same toggle as a step that doesn't apply; conflating the two is exactly what let a skipped step 2 disappear from view before this brief.

*The counter.* A group's own count now reads Done + Skipped together over its applicable steps (`NA` excluded from both numbers), with a "N skipped" suffix whenever the group has one — "4 of 4 · 1 skipped · Done." *Why:* "3 of 4 · Done" (Skipped left out of the numerator) made her go looking for a step she thought she'd missed, when nothing was actually outstanding.

**D61 — Editing the income reopens a skipped step 2** *(2026-09-28, brief #5i, her decision)*

*The rule.* While a filing is unfiled, the same step 1 saves that already reopen steps 3 and 4 under D50 (a final save that changes the figures, or a draft save of a previously-final step 1) also un-skip a Skipped step 2 (`lib/actions/quarterlySales.ts`, calling `reopenSkippedReceive2307`). Step 2's status is recomputed from its real state, not assumed — she watched it return to "Waiting on client." The skip reason is kept in the log, same as D60's manual Undo skip, logged alongside the existing figures-changed entry (e.g. "Step 2 reopened: sales changed.").

*Why.* A different declared figure may mean an unexpected certificate she didn't know to expect when she first skipped step 2.

*Consequence, stated plainly because it reads like a bug if you don't know it's intended.* Un-skipping step 2 this way re-blocks step 3's own gate (`prepareGroupBlockReason`, inside `markStepDone`) until step 2 is resolved again — this is intended, not an oversight. A filed filing, and a step 2 that's already Done or still open (never skipped), are both untouched.

**D62 — No group has a "Mark done"; a group is finished only when its own steps are** *(2026-09-28, brief #5i, her decision)*

**Supersedes D32's one-click-per-group "Mark done" and D53's three-state group button, entirely.** `markGroupDone` (`lib/actions/workflowSteps.ts`) is deleted outright, not merely hidden behind a disabled state — nothing can bypass a step's own rules through it any more. `components/workflow-group-card.tsx` loses the button along with it.

*Why.* The button let her mark steps 3 and 4 done at once without actually doing either — a single click that looked like progress but skipped the very work the click was supposed to represent.

*What's left.* The group header reports status only, never offers an action: a non-clickable grey **Pending** label, its tooltip naming the steps still open (e.g. "Step 2, step 3 and step 4 not done."), or a green **Done** pill once every step in the group is Done or Skipped. Every step still finishes on its own per-step control — Start/Mark waiting/Mark done/Skip where a step has them, Mark done only where it doesn't (steps 3 and 4, D54/D51). `prepareGroupBlockReason` is unaffected and still gates step 3 from inside `markStepDone` itself; only the group button's own use of it is gone.

*What doesn't change.* Grouping itself, group membership, the non-contiguous File group, and the board's layout (D32) all stand exactly as before — this decision touches only how, and whether, a group is marked done, nothing about what the five groups are or what belongs in each.

**D63 — Status pills show plain labels, never raw codes** *(2026-09-28, brief #5i)*

*The rule.* `filingStatusLabel()` (`lib/workflow/status.ts`) now maps every `FilingStatus` value to a plain, sentence-case word or phrase — Not started, In progress, Waiting on client, Waiting on BIR, Blocked, Complete (the existing "Complete (N steps skipped)" wording is unchanged) — instead of humanizing only the `COMPLETE`-with-skips case and rendering every other value as its bare enum. A matching `stepStatusLabel()` does the same for every `WorkflowStepStatus` value: Pending, In progress, Waiting, Done, Skipped, Not applicable. Neither helper is CSS-uppercased — sentence case is the actual rendered text, not a class doing the work on top of it. D58's status colours are unaffected; this changes labels only.

*Where it's applied.* Everywhere a status renders: the filing page's summary strip and step pills, the board's cards, and the client page's filings table. **The one raw code actually found and fixed** was the board's own status filter dropdown (`app/(app)/filings/page.tsx`), which listed the bare enum as each option's visible text.

*Confirmed out of scope, left alone.* `Form2307`'s own status enum (`RECEIVED`/`RECORDED`/`CLAIMED_ON_RETURN`/`INCLUDED_IN_SAWT`/`ACKNOWLEDGED`/`VALIDATED`), rendered raw on the certificate register page (`/clients/[id]/form-2307`) — a separate enum, not named by this brief. `FilingStatus.NA` has a label ("Not applicable") for completeness but is confirmed unreachable — `deriveFilingStatus` never produces it.

---

## 2026-09-28 — brief #5k (the File group's first walkthrough: steps 5, 6, 7, 10)

**D64 — Server Actions upload limit raised to 25 MB; a too-large file gets a plain message, never the error overlay** *(2026-09-28, brief #5k)*

*The bug.* Every upload in this app goes through a Server Action, and Next's own default body-size limit is 1 MB. A real screenshot or scanned PDF routinely exceeds that, so choosing one and clicking Upload produced Next's own dev-mode error overlay ("Body exceeded 1 MB limit…") instead of anything she could act on — confirmed live on step 6, and the same underlying limit sits behind every other upload control in the app (step 2's certificate scan included), just never hit by a small enough test file before now.

*The fix.* `next.config.ts` sets `experimental.serverActions.bodySizeLimit` to `"25mb"` — confirmed as the correct key for the installed Next.js version (15.5.23) against `node_modules/next/dist/server/config-schema.js`, not from memory. 25 MB comfortably covers a phone screenshot or a multi-page scanned certificate (this app's largest realistic document) while still bounding a single upload to something the local SQLite/disk setup absorbs without special handling.

*The real fix is client-side, not just a bigger ceiling.* `lib/upload.ts`'s `fileTooLargeMessage()` is checked in every upload control before the file ever leaves the browser — the generic doc slot (`components/workflow-step-card.tsx`), step 2's certificate form (`components/certificate-form.tsx`) and its per-row Replace scan (`components/receive-2307-step-card.tsx`), and the new steps-6/7/10 card (`components/file-group-doc-step-card.tsx`) — showing one line under the file picker, e.g. "This file is 31.0 MB — the limit is 25 MB," instead of ever submitting. `lib/actions/documents.ts`'s `saveDocumentForStep` re-checks the same limit server-side as a backstop (a direct call, a stale client), returning a clean `{ok: false}` rather than letting Next's own limit throw.

*Verified live,* not just asserted: logged in, opened this filing, uploaded a real ~4 MB screenshot to step 6 and a ~3 MB PDF to step 7 — both saved, no overlay, both steps turned Done. Then tried a 31 MB file on step 6's Replace and on step 2's certificate form — both showed the plain message, Save/Replace stayed usable, no crash either time. The 1 MB crash itself isn't really unit-testable (it's Next's own request-handling behavior, not application logic), so this live walkthrough is its regression check, not an automated test.

**D65 — Steps 5, 6, 7 and 10 have no Start and no Skip, enforced server-side** *(2026-09-28, brief #5k, her decision)*

None of File's four steps should ever offer Start or Skip (or the skip-reason box) — joining step 3's existing no-skip exception (D54). `skipStep` and `markStepInProgress` (`lib/actions/workflowSteps.ts`) both refuse `FILE_RETURN`, `SAVE_SUBMISSION_SS`, `SAVE_FORM_COPY` and `RECEIVE_TRRC` directly, the same way `skipStep` already refused `PREPARE_RETURN` — so the rule holds even if the action is called directly, not only when the UI hides the control. The step-code list itself (`FILE_GROUP_NO_START_NO_SKIP`) lives in `lib/workflow/groups.ts`, shared by both actions and by the filing page's `hideStart` prop on `NextActionControl`.

*Checked, not assumed:* the seed's own `SKIPPED`-row logic (`instantiateWorkflowSteps` in `prisma/seed.ts`) only ever produces a `SKIPPED` row for `RECEIVE_2307`, never for any of these four — confirmed by reading the function, not by memory. No seed change or backfill was needed for this decision.

**D66 — Step 5 renamed "File return via eBIRForms"** *(2026-09-28, brief #5k, her decision)*

She doesn't use eFPS. `WorkflowStepTemplate`'s seed row for `FILE_RETURN` drops "/eFPS" from its title. Because a `WorkflowStep` row keeps its own copy of `title`, taken from the template only once (at `instantiateWorkflowSteps` time), the template change alone doesn't reach a filing already in the database — the same class of bug CLAUDE.md's "Database rules" already flags for the old `update: {}` template upsert. `prisma/seed.ts`'s `seedWorkflowStepTemplate()` therefore also runs a one-line backfill (`workflowStep.updateMany` on the old exact title) so a plain reseed reaches already-created filings too, not only new ones. She needs to run `npx tsx prisma/seed.ts` once for this to reach her own database; the backfill itself is idempotent and touches nothing else.

*Searched, not guessed:* grepped the whole codebase for "eFPS" — the only other hits are `Client.eFPSEnrolled` (a real, unrelated field: whether the client herself is eFPS-enrolled, in `components/client-form.tsx`, the client detail/edit pages, `lib/validation/client.ts`, `lib/actions/clients.ts`) and `SPEC.md`'s own historical text (banner-noted, body left as history per its own rule). Neither is this step's label, and neither was touched.

**D67 — Steps 6, 7 and 10 unlock once step 5 is Done, show the upload box directly, and complete themselves on upload; step 10 alone keeps Mark waiting** *(2026-09-28, brief #5k, her decisions)*

*The problem.* Each of File's three document steps hid its upload box behind an "Attach" link, could be worked on before the return was even filed, and still needed a separate Mark done after the file was attached — three extra clicks around a fact that was already true the moment the file existed (D27: the file is the step).

*The new shape, one bespoke card (`components/file-group-doc-step-card.tsx`) for all three:*
1. **Before step 5 is Done:** the card sits in its place, in step order, with the Pending pill and one muted line — "Available once step 5 is done." No upload box, no controls at all. This is status about the step's own state, the same as the amber "waiting on…" group summary D41 already allows, not a block-reason attached to some other control — so it's fine as standing text.
2. **Once step 5 is Done:** the upload box (file picker, date defaulting to today, Upload) renders directly, no link to open it first.
3. **Uploading marks the step Done by itself** — no Mark done button exists on these three cards at all (`lib/actions/workflowSteps.ts`'s `recomputeFileGroupDocStepStatus`, the same self-completing shape D46 already gave step 2). The old amber "Required to mark this step done" line is gone with it — there's no button left for it to explain.
4. **Removing the only file reverts the step to `PENDING`** (never back to `WAITING_EXTERNAL`, even for step 10 — a vanished file just means "not done," not "now actively waiting," which she sets herself). Checked, not assumed: no UI anywhere calls `deleteDocument` for a generic doc slot today (confirmed by grep) — only step 2's certificate rows have a "Remove" of their own — so no new remove control was added; the rule is enforced in `recomputeFileGroupDocStepStatus` regardless, so it holds the moment something does call it. **⚠️ Superseded for step 10 by D68 (brief #5l):** once step 10 waits on BIR automatically, "a vanished file just means not done" no longer holds for it specifically — a TRRC is still owed, so it goes back to `WAITING_EXTERNAL`, not `PENDING`. Steps 6 and 7 are unaffected by D68 and still revert to `PENDING` exactly as written here.
5. **Once Done, the file renders as an ordinary saved document row** (name, date, view) with a **Replace** action — one-for-one, the prior file soft-deleted, never accumulated — the same pattern D46 gave step 2's scan. `lib/actions/documents.ts`'s `saveDocumentForStep` soft-deletes the previous non-deleted document for the same step+slot whenever a new one lands on `SAVE_SUBMISSION_SS`/`SAVE_FORM_COPY`/`RECEIVE_TRRC`.
6. **Enforced server-side:** attaching to any of the three is refused in `saveDocumentForStep` itself while step 5 isn't Done, not only by the UI hiding the box.

*Step 10 specifically.* ~~It alone keeps **Mark waiting** (`markStepWaitingExternal`, unchanged), available once step 5 is Done, same as the upload box.~~ **⚠️ Superseded by D68 (brief #5l, her decision): step 10 has no manual Mark waiting at all any more — it enters `WAITING_EXTERNAL` by itself the instant step 5 is marked Done.** Uploading the TRRC marks it Done regardless of whether it was ever marked waiting — if it was, the waiting state simply clears, since `recomputeFileGroupDocStepStatus` sets the live status to `DONE` outright; the "waiting on…" label already keys off live status (D52), so it disappears on its own with no extra code. ~~**Deliberately not built:** step 10 does not automatically go into waiting the moment step 5 is Done. That's a reasonable idea, but she didn't ask for it — raised as an open question for her, not built speculatively.~~ **⚠️ She said yes — see D68.** The open question this raised (§1 of brief #5k) was answered the very next pass: a TRRC is always owed once the return is filed, and waiting for a manual click meant the BIR aging clock never started until she remembered to click it.

*What this does NOT touch, stated because it would otherwise read as ambiguous.* The blocking rule itself (D27) — these three still can't be Done without their document, just satisfied by construction now, the same as D46 did for step 2. File's membership and non-contiguous order (D32) — TRRC is still step 10, still in File, still finishes after Pay with no warning. The group header (D62) — Pending or Done, never a button. D29 — waiting at step 10 still blocks nothing downstream. The Pay group's own step 9, which has the exact same Attach-then-Mark-done pattern this brief just retired for 6/7/10 — deliberately left alone; she walks Pay next and decides there, not this brief.

*Verified live and in tests.* The live walkthrough (see D64) also covers this decision's own behavior: steps locked/unlocked correctly, upload auto-completing, Replace keeping Done with the new file, the File group header reading "4 of 4 · Done" once all three plus step 5 resolved. Automated coverage in `tests/actions/workflowSteps.test.ts` (a new "brief #5k" describe block): `skipStep`/`markStepInProgress` refusals for all four step codes, attach-refused-before-step-5, attach-completes-after-step-5, replace-keeps-Done-with-old-file-soft-deleted, remove-reverts-to-PENDING, a step-10 upload clearing a prior waiting state, step 16's package-readiness check still finding documents attached this way, and the completeness note never counting a locked step as missing (it only ever scans `DONE`/`IN_PROGRESS` steps, and a locked step stays `PENDING` by construction).

---

## 2026-09-29 — brief #5l (the File group, finished: the TRRC waits by itself, and the File header reads correctly)

**D68 — Step 10 (RECEIVE_TRRC) starts waiting on BIR by itself the moment step 5 is Done; Mark waiting is gone** *(2026-09-29, brief #5l, her decision — the open question D67 raised, answered)*

*The rule.* `markStepDone` (`lib/actions/workflowSteps.ts`), when marking `FILE_RETURN` (step 5) Done, now also moves `RECEIVE_TRRC` (step 10) to `WAITING_EXTERNAL` in the same action, stamping `waitingSince` to that exact moment (the same `Date` object used for step 5's own `completedAt`, not a second, slightly-later `new Date()` call). This is a one-way transition: step 10 can only be `PENDING` at that point, since D67 already locks it until step 5 is Done, so a later no-op call to `markStepDone` on an already-Done `FILE_RETURN` never re-triggers it. Step 10's own **Mark waiting** button is gone from its card (`components/file-group-doc-step-card.tsx`) and the server action refuses it outright: `markStepWaitingExternal` now checks `stepCode === "RECEIVE_TRRC"` before its usual `isWaitingState` check and returns `{ok: false}` — enforced so it can't be bypassed by calling the action directly, the same reasoning behind every other step-code-specific refusal in this file.

*Why.* A TRRC is always owed once the return is filed — it isn't conditional on her remembering to click anything. Waiting for a manual "Mark waiting" meant the BIR aging clock never started until she happened to click it, so a late TRRC could sit invisible instead of reaching the dashboard's red "Waiting on BIR" list. This is the open question D67 (brief #5k) raised and deliberately left unbuilt; she said yes the next pass.

*Uploading still completes it either way.* `recomputeFileGroupDocStepStatus` (unchanged in this respect) sets step 10 straight to `DONE` on upload — via `waitingSince: null` now added to that branch's own update, clearing the stamp along with the status — regardless of how long it had been waiting or whether it had ever been anything else. The "waiting on…" label already keys off live status (D52), so it disappears the moment status flips, no extra code needed.

*Removing the only file reverts to `WAITING_EXTERNAL`, not `PENDING` — the one place D67's own §4.4 rule doesn't hold for step 10 any more.* `recomputeFileGroupDocStepStatus`'s "document removed" branch now special-cases `RECEIVE_TRRC`: instead of reverting to `PENDING` (still correct for steps 6/7, untouched), it goes back to `WAITING_EXTERNAL` with `waitingSince` reset to step 5's (`FILE_RETURN`) own `completedAt` on the same filing — a real, already-existing record of when the return was actually filed, not "now." Using "now" would have reset the aging clock to zero every time a bad file got removed and replaced, understating how long BIR has actually had it; her return was filed when it was filed, not when the file happened to be swapped. `Filing.filedAt` exists in the schema but is never actually written by the production `markStepDone` path (confirmed by grep — only the seed script sets it) — not reliable enough to use here, so the FILE_RETURN step's own `completedAt` column is the record relied on instead.

*What does NOT change.* D29 (waiting at step 10 blocks nothing downstream, including Pay) — confirmed with a live regression test: Pay's own two steps complete freely while step 10 sits in `WAITING_EXTERNAL`. Pay finishing before File still raises no warning (D32). Steps 6 and 7 are untouched — they unlock when step 5 is Done and don't wait on anyone; only step 10 has ever had a `waitingOnLabel`. Replace (one file swapped for another while already Done) is unaffected — it stays Done with the new file, same as D67.

*Existing data, checked not assumed.* Only three seeded Q2 configs in `prisma/seed.ts`'s `seedTY2026Cycle` ever produce a filing where `FILE_RETURN` is Done: one already has `RECEIVE_TRRC` explicitly `WAITING_EXTERNAL` (`waitingAtStepCode: "RECEIVE_TRRC"`, dela-cruz-j), one stops before step 5 is even reached (`doneThroughSequence: 3`, santos-m), and one has `RECEIVE_TRRC` already Done as part of a higher `doneThroughSequence` (13, reyes-p). None land in the "step 5 Done, step 10 still Pending" state this decision would otherwise leave stale. **No seed change and no backfill were needed.** She does not need to reseed for this decision on its own (brief #5k's D66 title backfill is the only reseed reason still outstanding from that pass).

**D69 — The File group's own collapsed-summary line, not the generic doc-slot fallback** *(2026-09-29, brief #5l, her decision)*

*The bug, in her own words:* before step 5 was even done, File's header read "waiting on submission-page screenshot, filed form pdf, trrc email/pdf" — wrong twice over. Steps 6/7/10 are locked then (D67), not waiting on anything, and the text was built from doc-slot labels lowercased wholesale, turning "PDF" and "TRRC" into "pdf" and "trrc."

*The fix.* `lib/workflow/groups.ts` gains `fileGroupOutstandingLabel()`, called by `summarizeGroup` for the File group specifically, entirely replacing the generic `missingRequiredSlots`-and-lowercase fallback for this one group (every other group still uses the generic path, unchanged):
- Step 5 not Done → `null`. No text at all — the "N of 4" count and the grey Pending label already say enough; a locked step is not a waiting one.
- Step 5 Done and step 6 and/or 7 still without a file → `"waiting on submission screenshot, filed form"` — only the ones actually missing, always in step order (6 before 7), using **fixed, plain, hand-written names** (`FILE_GROUP_SHORT_NAMES`), never a doc slot's own `label`.
- Step 10 waiting on BIR → `"waiting on BIR, Nd"`.
- Both at once → `"waiting on submission screenshot, filed form · BIR, Nd"` — one `"waiting on"`, the two clauses joined with `" · "`.
- Group Done → `null`.

Since `summarizeGroup` is the one function both the filing page's own group card (`app/(app)/clients/[id]/filings/[filingId]/page.tsx`) and the board card (`app/(app)/filings/page.tsx`) call for this text (confirmed by reading both call sites), fixing it here fixes both automatically; no separate board-side change was needed. **Verified live, before and after:** a filing with step 5 not yet Done showed no amber text under File on both the filing page and its board card (previously it would have shown the broken sentence above); once step 5 was marked Done, both read "waiting on submission screenshot, filed form · BIR, 0d"; the dashboard's own "Waiting on BIR" row picked it up too, once every numerically-earlier step (6, 7, 8, 9) was also resolved — see the note below.

*A separate, pre-existing dashboard nuance, found while verifying this, not caused by it.* The dashboard (`app/(app)/page.tsx`) shows exactly one step per filing per row, chosen by `currentStepCode` — the earliest unresolved step by **raw step sequence across all sixteen steps**, not by group and not by `Filing.status`. Immediately after filing, with steps 6/7 (sequence 6, 7) still Pending, `currentStepCode` picks step 6 — not step 10 — so the filing shows under "Needs my action now" ("Save submission-page screenshot"), not "Waiting on BIR," even though step 10 is genuinely waiting at that moment. It only appears under "Waiting on BIR" once every step numbered lower than 10 (6, 7, 8, 9) is also resolved. This is a pre-existing dashboard design (one row per filing, by raw sequence) that predates this brief and D68 alike — D68 just makes it newly relevant, since step 10 can now be waiting far earlier in a filing's life than before. Not fixed here — not asked for, and changing how the dashboard picks its one representative step is a larger, separate decision.
**✅ FIXED 2026-09-29 by D74 (brief #5m §2).** The dashboard's "Waiting on BIR" row now scans every filing for any of steps 10/13/14 currently waiting, independent of the filing's one "representative" step; "Needs my action"/"Waiting on client" pick that representative step by group order now, not raw sequence — see D74.

*Checked, not changed, per her instruction:* Pay, SAWT and Close all still build their own summary through the generic fallback. None of them lock a step behind an earlier one the way File's steps 6/7/10 were locked behind step 5, so they don't share File's "reads as waiting when it's actually locked" bug. They do share the milder lowercasing quirk (e.g., SAWT's "DAT file" renders as "dat file") — noted for her to decide on when she walks each group, not changed here.

*Tests.* `tests/workflow/groups.test.ts` gained a `fileGroupOutstandingLabel` describe block covering every row of the table above as a pure-function test (matching where `summarizeGroup`'s other tests already live). `tests/actions/workflowSteps.test.ts` gained a "brief #5l" describe block: step 5 done moves step 10 to `WAITING_EXTERNAL` with `waitingSince` set and leaves 6/7 `PENDING`; an upload on step 10 completes it and clears `waitingSince`; removing the only TRRC returns it to `WAITING_EXTERNAL` with step 5's own `completedAt`; Replace keeps it Done; `markStepWaitingExternal` refuses `RECEIVE_TRRC`; and the D29 regression (Pay completes freely while step 10 waits). One pre-existing test (`marking RECEIVE_TRRC WAITING_EXTERNAL flips the filing status to WAITING_BIR`) was rewritten, since it called the now-refused `markStepWaitingExternal` directly — it now drives the same outcome through `markStepDone(FILE_RETURN)`, the real path. Full suite (**331 tests, 37 files**), typecheck, and build all verified.

---

## 2026-09-29 — brief #5m (six groups, BIR Confirmations, and the Pay group built)

**D70 — Six groups: Prepare, File, Pay, eAFS, BIR Confirmations, Client package** *(2026-09-29, brief #5m §1, her decision)*

**Supersedes D32's table of five entirely.** The groups, in order:

| # | Group | Steps |
|---|---|---|
| 1 | Prepare | 1 Record quarterly sales · 2 Receive Form 2307 · 3 Prepare computation · 4 Advise client |
| 2 | File | 5 File return · 6 Submission screenshot · 7 Filed form |
| 3 | Pay | 8 Make payment · 9 Save proof of payment |
| 4 | eAFS | 11 Alphalist entry · 12 Email DAT · 13 SAWT acknowledgement · 15 eAFS |
| 5 | BIR Confirmations | 10 TRRC · 14 SAWT validation |
| 6 | Client package | 16 Email package to client |

*Why.* The TRRC (10) and the SAWT validation (14) are the two things she only ever WAITS to receive from BIR, with nothing downstream depending on either (D29). Inside File and SAWT they held those groups open and made finished work look unfinished — File would sit "3 of 4" for days waiting on a document that had nothing to do with the submission screenshot or the filed form sitting right next to it. Pulling both into their own group means every OTHER group (Prepare, File, Pay, eAFS) is entirely her own work, resolvable without waiting on anyone; BIR Confirmations comes after all of them because nothing in it can start before its own trigger fires; Client package goes last because it needs documents from both File and BIR Confirmations (step 16's package-readiness check, unchanged — see below).

*Naming.* "eAFS" is her own chosen name for group 4, kept even though it also holds the three SAWT steps (11, 12, 13) — she declined renaming it to include "SAWT." `lib/workflow/groups.ts`'s `GroupCode` type is `"PREPARE" | "FILE" | "PAY" | "EAFS" | "BIR_CONFIRMATIONS" | "CLIENT_PACKAGE"`.

*What doesn't change.* Step numbers are untouched — File (5, 6, 7) and Pay (8, 9) still sit ahead of BIR Confirmations (10, 14) numerically even though BIR Confirmations is now a LATER group; step numbers record sequence, groups record meaning (D32's own principle, unchanged). Group membership is still the fixed lookup table in `lib/workflow/groups.ts`, never `category` repurposed. `currentGroupCode` (the board's own "which group is a filing sitting at" function) needed no logic change at all — it already just iterates `WORKFLOW_GROUPS` in order; six groups instead of five just falls out of the array having six entries. The board (`app/(app)/filings/page.tsx`) and the filing detail page's checklist both map over `WORKFLOW_GROUPS` directly, so both render six columns/cards automatically — no board-specific code changed.

*No certificates for this filing.* Steps 11–14 are still auto-`NA` when `requiresSawt` is false, exactly as before.  *(Pre-D93 wording: as of D93 step 15 is conditional too, so 11–15 are all `NA` with no Form 2307 and eAFS shows no applicable step at all.)* This now splits across two groups: eAFS shows only step 15 applicable (11/12/13 all `NA`), BIR Confirmations shows only step 10 applicable (14 `NA`). Both groups read Done once their one applicable step resolves — `summarizeGroup`'s existing `NA`-exclusion logic (brief #5i) needed no change; confirmed with a test.

*The 13→14 dependency (D29) crosses groups now but is unaffected* — it's enforced in `markStepDone` by step CODE (`SAWT_ACK`/`SAWT_VALIDATION`), never by group, so moving step 14 into a different group changed nothing about how the check itself works. In practice D71 (below) now enforces the same relationship a second, stronger way — step 14 can't even be attempted before step 13 is Done — but the original `markStepDone` check is left in place, not deleted, and still functions if called directly. Proven with two tests: one exercising the real D71 lock/auto-wait/complete flow end to end, one calling `markStepDone` on step 14 directly (bypassing D71's lock by hand) to confirm the legacy check alone still refuses it correctly.

*Step 16's package-readiness check (steps 7, 9, 10, 14) is unchanged* — `lib/workflow/docSlots.ts`'s `SEND_CLIENT_PACKAGE_DEPENDENCIES` is still a flat step-code list, reads nothing about groups. Confirmed by an existing test continuing to pass unmodified.

*Group header text — generalising D69 to all six groups, not just File (D73 below).* Never show "waiting on…" text for a step she hasn't reached, whether locked (File before step 5, Pay before File, BIR Confirmations before its own gating step) or simply not yet possible. Every group now has its own dedicated summary function in `lib/workflow/groups.ts` — `fileGroupOutstandingLabel` (narrowed, see D69's marker), `payGroupOutstandingLabel` (D75), `birConfirmationsOutstandingLabel` (D71), `eafsGroupOutstandingLabel` (D73), Prepare's own inline logic (unchanged, brief #4e), and Client package (no function at all — step 16 never has anything to say). The old generic "any `WAITING_EXTERNAL` step's `waitingOnLabel` plus, failing that, any missing required document" fallback is gone outright — it was File's exact original bug (D69) and would have reproduced the identical bug for Pay and BIR Confirmations if left in place.

**D71 — Step 14 behaves exactly like step 10 always has** *(2026-09-29, brief #5m §2, her decision)*

Locked ("Available once step 13 is done.") until step 13 (`SAWT_ACK`) is Done. The moment it is, step 14 moves to `WAITING_EXTERNAL` automatically, `waitingSince` stamped to that same instant — the identical mechanism D68 gave step 10 off step 5, now generalised: `lib/actions/workflowSteps.ts`'s `markStepDone` loops over `BIR_CONFIRMATIONS_UNLOCK_STEP_CODE` (`{ RECEIVE_TRRC: "FILE_RETURN", SAWT_VALIDATION: "SAWT_ACK" }`) rather than special-casing `FILE_RETURN` alone. The upload box shows directly once unlocked; uploading completes the step; removing the only file reverts it to `WAITING_EXTERNAL` again, `waitingSince` reset to step 13's own `completedAt` (not step 10's D68 quirk of reading `FILE_RETURN`'s `completedAt` — each of the two reads its OWN gating step). No Start, no Mark waiting (`markStepWaitingExternal` refuses `SAWT_VALIDATION` by step code, same as it already refused `RECEIVE_TRRC`), no Skip (`NO_START_NO_SKIP_STEP_CODES` gained `SAWT_VALIDATION`), no Mark done button on the card at all — `components/file-group-doc-step-card.tsx` (kept its name; used for five step codes now, not just File's three) renders it identically to steps 6/7/10.

*Her own caveat, recorded because it matters for the SAWT walk still to come:* she hasn't walked SAWT yet. Making step 14 behave exactly like step 10 follows from D70 putting them in the same group, not from a dedicated SAWT walkthrough — she can revisit this when she gets there.

**D72 — No Log follow-up on any BIR wait; one combined "Waiting on BIR · Nd" pill** *(2026-09-29, brief #5m §2, her decision)*

*Log follow-up is gone, not just hidden.* She can't follow up with BIR on any of steps 10, 13 or 14 — there's no phone number to call, no portal to check. The button is removed from every card that can show one of these three (the bespoke self-completing card for 10/14, the generic `WorkflowStepCard` for 13) and from the dashboard's "Waiting on BIR" row. `lib/actions/workflowSteps.ts`'s `logFollowUp` also refuses these three step codes server-side now — `BIR_WAIT_STEP_CODES` (`RECEIVE_TRRC`, `SAWT_ACK`, `SAWT_VALIDATION`) — so it can't be bypassed by calling the action directly. The day-count itself stays (aging is still computed and shown); only the follow-up button goes. `WorkflowStep.followUpCount` stays in the schema, unused for these three step codes from now on — no migration needed to drop a column that other rows/steps may still increment (Client waits, unaffected by this decision, still use it).

*One pill, not three.* Before this, a waiting BIR step showed grey "waiting on BIR" text beside the title, a separate aging pill (green while young), and a separate amber "Waiting" status pill, all at once. Both `components/file-group-doc-step-card.tsx` and `components/workflow-step-card.tsx` now collapse all three into one: `"Waiting on BIR · Nd"`, toned amber while waiting and red once past twice `expectedResponseDays` (the same thresholds `deriveStepAging` already computed) — **never green**, even on day zero. This only fires when `waitingOnLabel === "BIR"`, so it applies to steps 10, 13 and 14 and nothing else (Client waits, e.g. step 1/2, keep their own separate rendering, untouched).

*BIR Confirmations' own header text* (part of D70's per-group functions): `"waiting on TRRC, Nd"`, `"waiting on SAWT validation, Nd"`, or both joined `" · "` with one `"waiting on"` stated once — no text at all while neither step has started waiting (i.e. before step 5 or step 13 is Done, matching D73's rule below).

**D73 — Group header text never shows "waiting on…" for a step not yet reached; always a fixed plain name** *(2026-09-29, brief #5m §1, generalises D69)*

D69 (brief #5l) fixed this specifically for File. The same bug existed in the OLD generic fallback for every other group: it read `missingRequiredSlots` on any unresolved step regardless of whether that step was actually reachable, so a screenshot from her walkthrough showed Pay reading "waiting on payment confirmation" and SAWT reading "waiting on generated report, dat file, acknowledgement email, validation email" on a filing whose sales weren't even recorded yet. Both are wrong the same way File's old bug was wrong: a locked/unreachable step is not a waiting one.

*The fix, generalised across all six groups* (see D70's own paragraph on this): every group now has its own dedicated function that only ever reads a step's LIVE status (`WAITING_EXTERNAL`), never "does this step have a doc slot that happens to be empty." eAFS and Client package haven't been walked yet (her own note) — until they are, eAFS shows text only for step 13 genuinely waiting (`"waiting on SAWT acknowledgement, Nd"` — a fixed plain name, never the generic `waitingOnLabel` "BIR" and never a lowercased doc-slot label), and Client package shows nothing at all (step 16 has no waiting state of its own, D27).
**✅ Update 2026-09-29:** eAFS was walked and built in brief #5o (D85–D89, D93), and Client package is the only group not yet walked. The eAFS header rule above still holds; when the whole group is `NA` it reads "Not applicable — no Form 2307" instead (D93).

**D74 — The dashboard lists BIR waits independently and follows group order** *(2026-09-29, brief #5m §2, fixing the nuance brief #5l/D69 found but didn't fix)*

*Before.* `app/(app)/page.tsx` picked exactly one "representative" step per filing via `lib/workflow/status.ts`'s `currentStepCode` — the earliest unresolved step by RAW SEQUENCE across all sixteen, regardless of group. A filing whose only genuinely outstanding work was step 10 waiting on BIR would still show under "Needs my action now" for whichever numerically-earlier step (6, 7, 8, 9) happened to still be open, and only migrate to "Waiting on BIR" once ALL of those resolved too — the exact bug D69 noted as "found while verifying this, not caused by it, not fixed."

*After.* Two separate fixes, both in `lib/workflow/groups.ts`:
- `currentStepCodeByGroupOrder` — the same "representative step" concept, but picking it from WITHIN the earliest incomplete GROUP (in that group's own step order), not by raw sequence across all sixteen. `app/(app)/page.tsx`'s "Needs my action" and "Waiting on client" rows now use this instead of `currentStepCode`.
- `BIR_WAIT_STEP_CODES` (`RECEIVE_TRRC`, `SAWT_ACK`, `SAWT_VALIDATION`) — the dashboard's "Waiting on BIR" row no longer derives from the one representative step at all; it scans every active filing's FULL step list for any of these three currently `WAITING_EXTERNAL` and lists one row per (filing, step) pair found. A filing can appear more than once here if two of the three happen to be waiting at once (a real, if unusual, possibility — step 10 and step 13 wait independently of each other).

*Consequence, intended, not a bug:* the same filing can now appear in BOTH "Needs my action" (for its own next step, by group order) and "Waiting on BIR" (for step 10 or 14, independent of what else is open) at the same time. This is exactly what she asked for — the two rows answer different questions and shouldn't gate each other.

*Row keys.* Since more than one BIR-wait row can now belong to the same filing, `waitingBirRows`' key is `` `${filing.id}-${step.stepCode}` ``, not `filing.id` alone (a duplicate-key regression the old single-row-per-filing design never had to guard against).

**D75 — Pay opens once File is Done; step 8 records amount/date/channel; step 9 self-completes** *(2026-09-29, brief #5m §3, her decisions)*

*Her own working pattern, stated plainly because it shapes the whole design:* she pays the client's tax herself, then receives the proof by email, sometimes days later. The full amount is always paid, never in parts. Keeping steps 8 and 9 separate lets her stop between paying and receiving the proof — exactly as before, unchanged.

*3.1 — Pay is locked until File (5, 6, 7) is fully Done, not just step 5.* `lib/workflow/groups.ts`'s `payGroupBlockReason` checks all three of File's step codes against the FULL step list passed to it (not the group-filtered subset `summarizeGroup` normally works with internally — Pay's own gate needs to read a DIFFERENT group's steps, so `summarizeGroup` special-cases this one call to use the outer, unfiltered list). Enforced server-side in `markStepDone`'s own `MAKE_PAYMENT` branch and again, explicitly, at the top of `lib/actions/filings.ts`'s new `savePayment` action (so a locked save fails before writing anything to the filing, not after). Pay's header shows no text at all while locked (D73).

*3.2 — Step 8 (Make payment).* No Start, no Skip (`PAY_GROUP_NO_START_NO_SKIP` joins `NO_START_NO_SKIP_STEP_CODES`) — a fixed sequence, the same reasoning D65 gave File's own steps. One new action, `savePayment` (`lib/actions/filings.ts`), validates three required fields with Zod (`lib/validation/payment.ts`) — amount paid, date of payment, paid through (free text, offered via a native `<datalist>` of this client's own previously-used channels, no new dependency) — and, in one save, writes them to `Filing.amountPaidCents`/`paymentDate`/`paymentChannel` (SPEC.md had always named these columns; nothing wrote them from inside the app until now) and calls the ordinary `markStepDone` on step 8 (so the File-done gate and the election hard-blocker both still apply, unduplicated). The amount field defaults to this return's own computed tax payable (never an overpayment — a return in that state has nothing to pay at all, see D76); she can change it, and if her figure disagrees, one muted line reads "Differs from tax payable ₱X" — informational, never a block. Once Done, the card collapses to "Paid ₱X on [date] through [bank]" with an Edit button (Save/Cancel — the same D40/D55 pattern `OtherCreditsForm` already uses), editable until `isPaymentLocked` (below) says otherwise.

*This closes D55's own known gap.* Item 56 (1701Q) / item 58 (1701A) — payments for earlier quarters — already read `Filing.amountPaidCents` for every earlier filed period in the same taxable year (`lib/filingComputation.ts`'s `priorPeriodPaymentsCentsThrough`, built in brief #5f); nothing had ever written that field for a return filed inside the app, so it always read ₱0. `savePayment` is the missing writer. Confirmed with a test: a Q1 payment saved via `savePayment` appears as Q2's own item 56.

*Editable until locked, not until filed.* `lib/filingComputation.ts`'s new `isPaymentLocked(clientId, taxableYear, period)` — editable until the NEXT filing of the same taxable year has ITS OWN step 5 (`FILE_RETURN`) Done, not until THIS filing's own step 5 is Done. Different from every other per-return lock in this app (item 61, the certificate list, the income quarter — all lock on the filing's OWN step 5): the amount only becomes load-bearing for someone else's figures once that later return has actually been filed with it baked in, so it stays open a little longer than the others on purpose. No next filing yet (e.g. this is the year's last period) means never locked by this rule.

*Reopening (extends D50).* Saving step 8 for the first time, or editing it afterward, changes item 56/58 on every LATER filing of the same taxable year — unlike item 61's inheritance chain, there's no "chain break" to stop at: every later filing's own item 56/58 always depends on THIS filing's actual paid amount (summed cumulatively), so `savePayment` calls `reopenPreparedFiling` on every later period in the year, relying on that function's own guards (no-op if unfiled-but-not-yet-prepared, no-op if already filed) rather than pre-filtering.

*3.3 — Step 9 (Save proof of payment).* Locked ("Available once step 8 is done.") until step 8 is Done, then behaves exactly like steps 6/7/10/14 — upload box shown directly, no "Attach" link, uploading completes it, Replace swaps one file for another, no Mark done/Start/Skip of its own. **Unlike steps 10/14, it never enters `WAITING_EXTERNAL` on its own** — `PAY_UNLOCK_STEP_CODE` (`{ SAVE_PROOF_PAYMENT: "MAKE_PAYMENT" }`) is deliberately absent from `BIR_CONFIRMATIONS_UNLOCK_STEP_CODE`, so `recomputeFileGroupDocStepStatus`'s "no file left" branch reverts it to `PENDING`, the same as steps 6/7, never to a waiting state. The header line "waiting on proof of payment" (`payGroupOutstandingLabel`) is what tells her it's outstanding instead — there's no proof-of-payment "BIR" to wait on, only her own next action.

*Bug she found and asked to be confirmed fixed, not newly caused:* after an upload, a doc-slot's own box used to stay open below the saved file. Checked specifically for step 9 once it moved to the D67-style card: fixed, the same way it already was for 6/7/10 — `showReplace` starts `false` and the upload handler resets it to `false` again on success. No OTHER doc slot in the app was found still leaving its box open after upload (the generic `WorkflowStepCard`'s slot-open state — `openSlots` — already closes on a successful upload too; confirmed by reading, not just asserting).

**D76 — Nothing to pay makes steps 8 and 9 NA automatically** *(2026-09-29, brief #5m §3.4, her decision)*

*The rule.* The instant step 5 (`FILE_RETURN`) is marked Done, `markStepDone` checks this return's own computation: if it's an overpayment, or exactly ₱0 payable, both step 8 and step 9 move straight to `NA` (only if they're still `PENDING` — a one-way transition, the same shape D68 already established for the auto-wait). No clicks needed; Pay reads "Nothing to pay" (or "Nothing to pay — overpayment ₱X" when it genuinely is one) and counts as resolved (green Done pill) the moment step 5 is Done. The two overpayment filings from her own walkthrough (Rosario Garcia ₱8,200 and another at ₱10,600) are exactly the cases this was built from — both had been showing steps 8/9 as ordinary open work before this decision.

*Implementation note, worth recording plainly.* This is meant to key off the FROZEN `computationSnapshot` (D76's own wording says "when the snapshot freezes") — but the production `markStepDone` path has never actually written that field; confirmed by grep, only `prisma/seed.ts` does. This is a pre-existing gap this brief did not create and was not asked to close (the schema's own `Filing.filedAt` has the identical property, already noted in D68). A LIVE recomputation (`assembleAndComputeFiling`) at the exact instant step 5 is marked Done is the practical equivalent and is what's actually implemented — functionally identical for every case that matters here, since nothing else can have changed the figures between "step 5 marked Done" and "the check runs" (they're the same action).
**❌ No longer true as of 2026-09-29 (D83).** `markStepDone` on step 5 now writes `computationSnapshot`, and the nothing-to-pay decision reads that frozen result (`getFilingSheet`), not a fresh recomputation.

*Item 56/58 on a later return treats this return's payment as ₱0* when 8/9 are NA — confirmed by a test: `priorPeriodPaymentsCentsThrough` never reads a value for a filing whose `amountPaidCents` was never written (NA'd steps never call `savePayment`), so it naturally contributes 0, no special-casing needed.

**D77 — The Next banner never offers a control the step's own card doesn't have** *(2026-09-29, brief #5m §4, her decision)*

*What she saw.* A fresh filing's banner read "Next: Step 1 of 16 — Record quarterly sales" with a Mark done button — step 1 has none, it completes itself (D33). On step 8, the banner offered Start and Mark done — step 8 needs three fields filled in first, not a bare click.

*The fix.* `components/next-action-control.tsx` gains a `mode` prop, computed per step code by `lib/workflow/groups.ts`'s `nextActionModeForStepCode`, checked against every one of the sixteen steps' real controls (not just the two she happened to see):
- **`"goToStep"`** — steps 1, 2, 6, 7, 9, 10, 14 (self-completing, no bare control at all) and step 8 (needs fields filled in first). The banner offers a single "Go to step" link, no buttons.
- **`"markDoneOnly"`** — steps 3, 4, 5, whose own card already offers Mark done and nothing else (`controlsMode="markDoneOnly"`). The banner keeps Mark done, gated by the same server-side checks the card's own button already uses.
- **`"full"`** (the default, every other step — 11, 12, 13, 15, 16) — unchanged: Start + Mark done, the shape every step used to get regardless of whether it fit.

*Before/after, every step checked:*

| Step | Before | After |
|---|---|---|
| 1 Record quarterly sales | Start + Mark done (neither exists) | Go to step |
| 2 Receive Form 2307 | Start + Mark done (neither exists) | Go to step |
| 3 Prepare computation | Mark done only (already correct) | Mark done only (unchanged) |
| 4 Advise client | Mark done only (already correct) | Mark done only (unchanged) |
| 5 File return | Mark done only (already correct) | Mark done only (unchanged) |
| 6 Submission screenshot | Start + Mark done (neither exists) | Go to step |
| 7 Filed form | Start + Mark done (neither exists) | Go to step |
| 8 Make payment | Start + Mark done (needs fields, not a click) | Go to step |
| 9 Proof of payment | Start + Mark done (neither exists) | Go to step |
| 10 TRRC | Start + Mark done (neither exists) | Go to step |
| 11 Alphalist entry | Start + Mark done (both real) | Unchanged |
| 12 Email DAT | Start + Mark done (both real) | Unchanged |
| 13 SAWT acknowledgement | Start + Mark done (both real) | Unchanged |
| 14 SAWT validation | Start + Mark done (neither exists) | Go to step |
| 15 eAFS | Start + Mark done (both real) | Unchanged |
| 16 Email package | Start + Mark done (both real) | Unchanged |

*Why 11–13/15/16 needed no change.* Their own cards genuinely offer both Start and Mark done as real controls (plus Skip/doc upload, which the banner never surfaced anyway) — the banner's existing pair is a true subset of what the card offers, so nothing was wrong there to begin with.

---

## 2026-09-29 — brief #5n (mid-year guard, BIR tag, sticky bar, "Nothing to pay", a clean seed)

**D78 — Generate refuses for a client engaged mid-year with no starting figures** *(2026-09-29, brief #5n §1, her decision)*

*What happened.* She created a client with Engaged since = July 1, 2026 and clicked Generate for 2026: Q1, Q2, Q3 and Annual were all created, so Q1 and Q2 showed as overdue work. Correct by D56's rules — only `StartingFigures.latestOutsideReturn` keeps an outside quarter from being generated, and she hadn't entered any — but it happened silently.

*The rule.* Starting figures stay the ONE place that says which quarters were filed outside the app. `engagedSince` never excludes a quarter on its own. `generateFilingsForClientYear` (`lib/workflow/filingGeneration.ts`) refuses — before creating anything — when all three hold: the client's `engagedSince` falls inside the taxable year after January 1; at least one quarterly period ended before `engagedSince` (Manila calendar days, D20 — `lib/workflow/midYearGuard.ts`'s `quartersEndedBeforeEngagement`); and no `StartingFigures` row exists for that client and year. Enforced in the function itself, so the "Generate" action and anything else that calls it are covered — not just the button. Any saved starting-figures row satisfies it, including "latest outside return: none" (then Generate runs normally and creates all four). No override button.

*The message* names the client (first word of the registered name), the date and the affected quarters, and links to that year's starting-figures screen — or to "New tax year" when the year has no tax-year row yet, since that screen can't open without one: "Benedicto started July 1, 2026. Enter Benedicto's starting figures first, so Q1 and Q2 aren't created as work." (The brief's own example said "her"; the wording avoids a pronoun, since none is stored.)

*Confirmed reading, as the brief asked.* A client engaged February 10 lists **no** quarter — Q1 hadn't ended yet — so generation is allowed. Same for January 1 or earlier, no `engagedSince` at all, or a different year. A client engaged April 1 lists Q1 only; October 1 lists Q1, Q2 and Q3. The Annual never appears (Dec 31 is never before an in-year date).

*"Add tax year" checked:* `createClientTaxYear` (`lib/actions/clientTaxYears.ts`) creates only the tax-year row and never generates filings, so it needs no guard.

**D79 — Board cards carry a "TRRC · Nd" / "SAWT validation · Nd" tag while waiting on BIR, outside the BIR Confirmations column** *(2026-09-29, brief #5n §2, her decision)*

She keeps D70's rule (a card sits in its earliest unfinished group — one card per filing, in the column of her next piece of work), so a filed-and-paid filing with eAFS work still open sits in eAFS. New: when a card is in any column other than BIR Confirmations and step 10 and/or step 14 is `WAITING_EXTERNAL`, a small tag shows "TRRC · 2d" and/or "SAWT validation · 8d". Days and colour come from `deriveStepAging` — the same function as the step pill — via `lib/workflow/aging.ts`'s `birWaitTags` / `birWaitTone`; both step cards' "Waiting on BIR" pill now call `birWaitTone` too, so there is one copy of the amber/red rule (amber while waiting, red at twice `expectedResponseDays`, never green). A card already in BIR Confirmations gets no tag; its own wait line turns **red** once either wait is past twice its expected days (added while verifying the walkthrough — her scenario G expects that card to read red).

**D80 — A slim bar pinned to the top of the filing page** *(2026-09-29, brief #5n §3, her decision)*

Once the page header scrolls out of view, a bar fixed to the content area (`left-60`, beside the menu, never over it) shows only: "Rosario Garcia — TY2026 Q3 · Next: Step 8 Make payment · Go to step" — or "… · Complete" with no link. It isn't rendered at all while the real header is on screen (an `IntersectionObserver`, no new dependency; `components/filing-sticky-bar.tsx`). D58's colour tokens and a border-bottom, no shadow.

*"Go to step" (`components/go-to-step.tsx`) now really expands the right group and scrolls to the step.* **The brief said the bar should behave "exactly like the Next banner's link (D77)," and described that link as expanding the group — it didn't:** D77's banner link was a plain `#checklist` anchor, so it only jumped to the top of the whole Workflow card. Found against the tree, not the brief. Both the banner's "Go to step" and the bar's now share one behaviour: each group card listens for the step being requested and opens itself; every step card is wrapped in `id="step-<STEPCODE>"` with `scroll-margin-top` of 80px against the bar's ~37px, so the first line of the card is never covered (measured: the step lands 80px below the top). The banner's separate "Go to checklist" link in Mark-done modes is unchanged.

*Known, not changed here:* both the banner and the bar name the earliest unresolved step by raw step sequence (`currentStepCode`), so a filing whose only open work is eAFS reads "Next: Step 10 — TRRC" (a step she can only wait on), while the board and dashboard already pick by group order (D74). Left alone as outside the brief; see CURRENT_STATE.md.

**D81 — "Nothing to pay — overpayment ₱X" in muted grey; no counter on an all-NA group** *(2026-09-29, brief #5n §4, her decision)*

Pay's note after steps 8/9 both go NA reads "Nothing to pay — overpayment ₱8,200.00" (or plain "Nothing to pay" for exactly ₱0), built by `lib/workflow/groups.ts`'s `nothingToPayLabel` from `lib/money.ts`'s formatting, in muted grey (`text-faint`) — amber means waiting and nothing is waiting. The "0 of 0" counter is hidden for **any** group whose steps are all NA (`groupCounterLabel` returns null); the Done pill and the note are enough. Filings filed before brief #5m kept a live payment form because D76's NA rule only runs when step 5 is marked Done — no backfill, since the database is reseeded (D82), and the new seed reaches this state by really marking step 5 done.

*Rosario Garcia's Q3 is ₱8,200.00 on a fresh seed.* The ₱8,600.00 seen during the #5m walkthrough cannot be reproduced from a fresh seed, because a fresh seed used to leave her Q3 empty — any overpayment came from figures typed during the walkthrough. Under her starting figures (item 55 ₱0; item 56 = ₱2,000 + ₱8,000 = ₱10,000; item 57 = ₱10,000 + ₱15,000 = ₱25,000; item 58 = ₱0, no certificates; item 61 = ₱0) the overpayment is ₱15,000 − 8% × Q3 sales, so ₱8,200 is Q3 sales of ₱85,000 and ₱8,600 is ₱80,000: a ₱5,000 difference in the Q3 sales typed in produces exactly the ₱400. Nothing is counted twice — the ₱8,000 paid on Q2 sits only in item 56, the ₱15,000 Q2 withholding only in item 57. Most likely a sales figure was edited between two walkthrough runs. The new seed enters ₱85,000 through `saveQuarterlySales`, so the figure is now reproducible and asserted by a test.

**D82 — The seed is rebuilt as labelled fictitious scenarios, driven through the real actions, with no half-worked overdue filings** *(2026-09-29, brief #5n §5, her request)*

The old seed mixed sample clients, hand-set step statuses and half-worked overdue Q2 filings ("Blocked" cards in odd columns). `prisma/seed.ts` now keeps only the reference data (TaxRuleSet, Holiday, AtcCode — WI010/WI011 still unverified, D19 — and the step template) and hands the rest to `prisma/seedScenarios.ts`: eight fictitious clients, one scenario each, each with a one-line "Sample …" note, driven by `saveStartingFigures`, `generateFilingsAction`, `saveQuarterlySales`, `addCertificate`, `setAllCertificatesReceived`, `skipStep`, `markStepDone`, `savePayment` and `uploadDocument` (so auto-waiting D68/D71, nothing-to-pay NA D76, item 56 D75, the mid-year guard D78 and SHA-256/naming all come from the real code). Seeded documents are small one-page PDFs (or a text file for the DAT) reading "SAMPLE — …", written through the normal storage path. Every past-due filing is Complete or doesn't exist; Annual filings (due April 2027) exist Not started. See CURRENT_STATE.md's "Sample data" table.

*Set by hand, and why:* the `Client`, `ClientTaxYear` and `Payor` rows (their create actions redirect into a page, which can't run outside Next); `waitingSince` on steps 10/14 and the `completedAt` of the step that started the wait (the app stamps "now", so a seeded wait would always read 0 days); nothing else. **No `computationSnapshot` is written** — production `markStepDone` has never frozen one (D76's note), so seeded filed returns are unfrozen exactly like one filed in the app today; D17's frozen-snapshot exception therefore has nothing to cover in the new seed (the old `buildSnapshot` is gone with the old scenarios). `waitingSince` ages are relative to seed time (D17's era note): D ≈ 2 days, E ≈ 3, F ≈ 1, G TRRC ≈ 8 (red) and SAWT validation ≈ 3.
**❌ Now false (D83, 2026-09-29):** filing a sample return through the real action writes a real snapshot and `filedAt`, and `tests/seed/seedScenarios.test.ts` asserts it. The rest of this entry stands.

*Re-running.* Reference data is upserted, so `npx tsx prisma/seed.ts` is safe to repeat; the sample clients are only built when none exist (all present → left alone; some present → stops and says to reset). The seed does NOT wipe a database: to start clean use `npx prisma migrate reset --force`. This also corrects older docs that said the plain seed command "replaces all data". Tested: `tests/seed/seedScenarios.test.ts` seeds a throwaway database twice and checks every scenario.

---

## 2026-09-29 — brief #5o (freeze filed returns; the eAFS group built)

*Documentation for this brief was deliberately light (her instruction); brief #5p's documentation pass then brought all five docs up to date.*

**D83 — A filed return's computation is frozen at step 5 and every reader uses it; later differences raise an `AmendmentAlert`** *(2026-09-29, brief #5o §1)*

*This is D6 / locked rule #3 finally implemented.* What was missing: nothing in production ever wrote `Filing.computationSnapshot` (or `filedAt`) — the only frozen snapshots that ever existed were hand-written in the old seed, which is why the rule looked as if it worked. The `AmendmentAlert` model and page card did exist, but the only creator (`checkAndRecordAmendments`, called from `saveQuarterlySales` alone) required a snapshot *and* a `filedAt`, so it could never fire. Readers before this brief: the page (sheet, summary strip, Pay's default, step 16's email) and the saved-HTML writer were already snapshot-aware but always fell back to live; step 4's message and D76's nothing-to-pay decision always recomputed live; the filing package reads no figures at all.

*The rule.* `markStepDone` on `FILE_RETURN` computes the full result (the form-line shape — every item, `isOverpaymentLine`, the credit figures used, the sourceNotes) and writes it to `computationSnapshot` (and sets `filedAt`) **in the same database transaction** as marking the step Done; the write only lands where the snapshot is still null, so nothing — not even marking step 5 Done twice — can overwrite it. `lib/filingComputation.ts`'s `getFilingSheet`/`readFilingSheet` is now the one reader of a filing's own figures (snapshot when filed, live before); step 4's message, D76's decision, the saved HTML and the page all go through it. A test scans `lib/actions` to prove only `workflowSteps.ts` writes the field. **Later returns still read real data** — Q3's item 56 is Q1/Q2's actual `amountPaidCents`, never their snapshots; only a return's own figures freeze.

*Amendment alerts.* After any change that could feed a filed return of the same year — declared sales, a saved payment, a certificate added or removed, item 61, the starting figures — `checkAndRecordAmendments` recomputes every snapshotted filing of the year live (no longer narrowed by a period-end date: an earlier quarter's payment reaches *later* returns) and, if any item or the net payable now differs, raises an alert (deduplicated while an identical one is unread). The filing page shows one amber block per unread alert: what changed, `item N: old → new (+diff)` per changed item, the net effect, and a Dismiss button (D11 — informational; she files no amended returns). `lib/tax/amendment.ts` holds the pure item-by-item comparison. The old multi-alert card with an Acknowledge note field is replaced.

*Found against the tree, not as the brief described it:* most edit routes are already locked once the later return is filed — Q1's payment (D75's `isPaymentLocked`), item 61, certificates and the starting figures all lock at filing — so "edit Q1's payment after Q2 is filed" is refused by the screen rather than changing Q2. The freeze still matters (D76 and the readers were live), and alerts fire where an edit *is* reachable: an earlier quarter left open while a later one is filed out of order (its sales, item 61 or certificates), and any direct data change. **Answered by D94:** the lock stays, alongside the freeze.

*Existing data / reseed.* The new seed drives filings through the real actions, so seeded filed returns now carry real snapshots (tested). **A database seeded before this brief has filed returns with no snapshot, and must be reseeded** (there is no backfill; seed-only data, so none is needed).

**D84 — "Next" follows group order and skips locked and BIR-waiting steps; one shared helper** *(2026-09-29, brief #5o §2)*

`lib/workflow/groups.ts`'s `nextActionForFiling` (with `stepLockReason`, the one place that knows every gate): the first open step in group order that is her work — steps that are locked, or `WAITING_EXTERNAL` on 10/13/14, are skipped. Only when nothing of hers is left does it return the BIR wait ("Next: waiting on BIR — TRRC, 3d · eAFS validation, 3d", no button, no link); nothing open at all is "complete". The filing page's Next banner, the slim bar (D80) and the dashboard's "Needs my action" all call it, so they can't disagree. Before this the banner and bar named the lowest-numbered open step, so scenarios D/E/F read "Next: Step 10 — TRRC". `nextActionModeForStepCode` now treats 11 and 13 as go-to-step and 12 and 15 as Mark done only.

**D85 — The eAFS group opens once File and Pay are Done** *(2026-09-29, brief #5o §3)*

Steps 11, 12, 13 and 15 are locked ("Available once Pay is done.") until File (5, 6, 7) is Done and Pay (8, 9) is Done *or* NA (D76 — "nothing to pay" counts). Enforced server-side on every action: uploads to 11/13 (`saveDocumentForStep`) and Mark done on 12/15 (`markStepDone`) are refused with that message, and within the group 12 needs 11, 13 needs 12. Header text while locked is empty (D73).

**D86 — Step 11 has two direct upload boxes and completes when both files are present** *(2026-09-29, brief #5o §4)*

Generated report and DAT file, shown directly, no Attach link (D67's pattern). No Start, Mark done or Skip — all refused server-side. `recomputeFileGroupDocStepStatus` now requires **every** required slot to have a file (this is the first two-slot step on that machinery), so removing either file returns the step to Pending; Replace works per file. `FileGroupDocStepCard` takes a list of slots.

**D87 — Step 12 shows the eSubmission email draft and saves it when marked Done** *(2026-09-29, brief #5o §4)*

`lib/workflow/eSubmissionEmail.ts` (pure, like step 4's message) builds To / Subject / Body from her real sent email: subject `SAWT {1701Q|1701A|1701} {period end MMDDYYYY} {REGISTERED NAME IN CAPITALS} {12-digit TIN}`; body Name / TIN / RDO / Period, one per line. Period ends come from a fixed table (0331/0630/0930/1231 + year — no date arithmetic, D20); the 12-digit TIN is the 9-digit TIN plus the 3-digit branch code, digits only. **The address is a setting: `TaxRuleSet.eSubmissionEmail`** (default `esubmission@bir.gov.ph`, editable on the tax rule set screen; new migration — confirm it against BIR before live use, D19). The card shows Copy buttons for To, Subject and Body, names the DAT file saved on step 11 with a download link, and shows one muted "RDO code missing — add it on the client page" line (never blocking) when the client has none. Mark done only (no Start/Skip); locked until 11 is Done. Marking it Done saves the exact draft on the filing (new `Filing.dataEmailTo/Subject/Body/SavedAt`, D51's pattern) and the card collapses to "Emailed [date] — SAWT 1701Q …" with a Show email link. Uses the registered name uppercased, not a separately stored surname (her decision); the draft text on screen is editable for shortening by hand, but what's saved is the built draft.

**D88 — Step 13 waits on BIR automatically after step 12 and completes on upload** *(2026-09-29, brief #5o §4)*

`BIR_CONFIRMATIONS_UNLOCK_STEP_CODE` gained `SAWT_ACK: "EMAIL_DAT"`, so the D68/D71 machinery does the rest: marking step 12 Done flips step 13 to `WAITING_EXTERNAL` with `waitingSince` set to that moment; the upload box shows directly; uploading completes it; removing its only file returns it to waiting with `waitingSince` = step 12's `completedAt`. One "Waiting on BIR · Nd" pill, no Log follow-up (D72). No Start, Mark waiting, Mark done or Skip — refused server-side. Because step 13 now completes through an upload, the auto-wait loop was extracted (`startGatedBirWaits`) and is also called from the upload-completion path, so step 13 Done still starts step 14's wait (D71). The 12 → 13 → 14 chain is tested end to end.

**D89 — Step 15 has no document slot and no Skip; D27's third category is retired; step 16's forwarding line is removed** *(2026-09-29, brief #5o §4, her decision: it needs no attachment)*

The optional `eafs_confirmation` slot is gone from the template and from existing rows (seed backfill sets `requiredDocSlots` to `[]`). Mark done only; Start and Skip refused server-side. **This retires D27's one documented exception** ("a document delivered to someone else — optional, hidden, never blocking"): the blocking table's third category is now empty. Step 16's client email no longer asks the client to forward an eAFS confirmation and no longer lists one (`clientPackageEmail.ts`, its input field and tests removed).

**D93 — The whole eAFS group (11, 12, 13, 15) is NA when no Form 2307 is saved on the filing** *(2026-09-29, brief #5o §4, her decision)*

Step 15 joined the conditional steps (with 11–14): no certificate claimed on the filing (`requiresSawt` false) means 11, 12, 13, 14 and 15 are all `NA`. **This settles the open question "is eAFS required on quarterly returns?" (SPEC §17 item 2): eAFS only when there are certificates.** The NA state follows the live certificate list until step 5 is Done (D34 locks the list from then on): `recomputeRequiresSawt` — the mechanism that already set 11–14 NA at generation and un-NA'd them — now also sets untouched steps NA again when the last certificate is removed, and does nothing once the return is filed. The eAFS header for an all-NA group reads "Not applicable — no Form 2307" (muted grey, a Done pill, no counter, no Expand — same treatment as D81/D91). *Knock-ons, checked:* the board places a no-certificate filing past eAFS straight into BIR Confirmations (Rosario Garcia Q3); the Next helper skips the group; step 16's package-readiness check expected nothing from 11–15 (its dependencies are 7, 9, 10, 14, and 14 is NA too) and Rosario's filing can still reach Complete once the TRRC is in. **Consequence for the sample data:** scenario F (Felipe Ocampo) now carries a certificate, otherwise his eAFS group would be NA rather than locked.

**D90 — Step 10 renamed "Save TRRC email"** *(2026-09-29, brief #5o §4, her decision)*
Template, existing rows (seed backfill, same pattern as D66's rename of step 5), and every place the old title appeared: the group card, the package-readiness message (`docSlots.ts`), tests.

**D92 — Step 14 renamed "Save eAFS validation email"; the short names become "eAFS validation"** *(2026-09-29, brief #5o §4, her decision)*
**❌ SUPERSEDED 2026-09-29 by D96** (agreed with her after brief #5o; built 2026-09-30, brief #5q): step 14 goes back to a SAWT name, "Save SAWT validation email", and the short names return to "SAWT validation".
Template, rows and the readiness message, as D90. `BIR_WAIT_SHORT_NAME` (`lib/workflow/aging.ts`) is the one place the short names live: BIR Confirmations' header reads "waiting on eAFS validation, Nd"; the board tag reads "eAFS validation · Nd" (D79); the Next banner and bar use it too.

**D91 — An all-NA group doesn't expand to an empty box** *(2026-09-29, brief #5o §5)*
Chosen: **no Expand is offered** (rather than a "steps don't apply" line). A group whose every step is NA — and none is being shown by the "Show N not applicable" toggle — renders as a plain header with its note (Pay's "Nothing to pay — overpayment ₱X", eAFS's "Not applicable — no Form 2307") and no expandable body. If the toggle shows the NA steps, the group expands as usual.

**Known stale list from this brief: resolved by brief #5p's documentation pass** (see the "Last reconciled" lines of each file).

---

## 2026-09-29 — after brief #5o (her decisions, documentation pass brief #5p)

**D94 — Keep D75's payment lock, and the matching locks on certificates, item 61 and the starting figures, alongside D83's frozen returns** *(2026-09-29, her decision)*

*The locks:* a return's payment (`Filing.amountPaidCents`) stays editable until the NEXT return of the same year is filed (`isPaymentLocked`, D75); a certificate list locks at its own filing's step 5 (D34); item 61 at its own filing's step 5 (D55); the starting figures once the year's first in-app return is filed (D56).
*Why:* once a later return is filed, the earlier quarter's payment is part of what BIR received on it (its item 56/58). The lock stops a mismatch at its source; the D83 amendment alert stays as the safety net for anything that still gets through (an earlier quarter left open while a later one is filed, or a direct data change). This answers the question D83's note left open — she does not want the lock relaxed.

**D95 — Filing order: step 5 will be refused until every earlier quarter of the same year is filed** *(2026-09-29, her decision)*

Quarters filed outside the app (named by the starting figures, D56) count as filed. *Why:* brief #5o's own test filed Q2 while Q1 was still open and the app allowed it — she would never do that deliberately, and the guard is cheap (it also closes the only reachable way D83's alert can fire today). 

**✅ BUILT 2026-09-30, brief #5q.** *Rule as built:* Q2 needs Q1; Q3 needs Q1 and Q2; the Annual needs Q1, Q2 and Q3. An earlier return is "filed" when its own step 5 is Done, or its row has `filedOutsideApp: true`, or it has no row and the starting figures' `latestOutsideReturn` names it (D56). An earlier return with no row *and* no starting-figures cover is refused. *Where:* `lib/workflow/filingOrder.ts` (pure) and `filingOrderData.ts` (reads the siblings); `markStepDone`'s FILE_RETURN path checks it before anything is written, including D83's snapshot transaction, so it holds when the action is called directly; `stepLockReason(…, filingOrderReason)` disables the card's Mark done with the message as a hover tooltip (D41, no standing text). *Message:* "File Q1 2026 first." / "File Q1 and Q2 2026 first.". *Next (D84):* a filing held back only by the guard still shows Next = step 5, with the reason and an "Open Q1" link to the earlier filing beside it; the slim bar names step 5 with its Go to step link. *Missing-row case:* it can't arise in normal use (all four periods are generated together); it would take a soft-deleted filing, or starting figures changed after generation without regenerating. Refusing is the safe answer there.

**D96 — Steps 13 and 14 renamed "Save SAWT acknowledgement email" and "Save SAWT validation email"** *(2026-09-29, her decision; supersedes D92's name and the step 13 name she first gave in the same conversation)*

Step 13 becomes "Save SAWT acknowledgement email" (today's template title: "Receive & save acknowledgement email"); step 14 goes back to a SAWT name — "Save SAWT validation email" — from D92's "Save eAFS validation email". The short names follow: the eAFS header keeps "SAWT acknowledgement"; BIR Confirmations' header, the board tag (D79) and the Next banner/bar change from "eAFS validation" back to "SAWT validation" (`BIR_WAIT_SHORT_NAME` in `lib/workflow/aging.ts` is the one place). Like D66/D90, it needs the template, existing rows (seed backfill) and every place the old title appears. D92 is marked superseded above.

**✅ BUILT 2026-09-30, brief #5q.** Template titles, `BIR_WAIT_SHORT_NAME`, the package-readiness message in `docSlots.ts`, and a seed backfill (`renameSawtSteps` in `prisma/backfills.ts`: `workflowStep.updateMany` on the exact old titles, idempotent). "eAFS" stays wherever it means eAFS (the group, step 15, D87's email subject).

**D97 — The status pill says "In progress" while her own work remains; "Waiting on BIR" only when nothing of hers is left** *(2026-09-30, brief #5q, her decision; agrees with D84's Next)*

Before this, any filing with a TRRC or SAWT wait showed "Waiting on BIR" even with steps 11–15 still hers (scenario D). Now `deriveFilingStatus` (`lib/workflow/status.ts`) returns Waiting on BIR only when `nextActionForFiling` returns its BIR-wait result, so the pill agrees with Next by construction; otherwise it reads In progress (no "Waiting on client" variant — her choice). Other states and their precedence are unchanged, including Blocked for past-due. The small BIR tag on the board card ("TRRC · 2d") is unchanged — it is what shows the wait now. `Filing.status` is stored, not derived on read: every step action recomputes it, and the seed backfills existing rows (`backfillFilingStatuses`, only rows currently reading Waiting on BIR, idempotent). Every reader (board card and its status filter, filing page summary strip, client page table) shows the stored value through `filingStatusLabel`, so none needed a code change.

**D98 — Steps 1 and 4 can't be skipped or started, server side** *(2026-09-30, brief #5q)*

Neither card has Skip or Start (D33, D51), but `skipStep` did not refuse them. It now refuses `RECORD_SALES` and `ADVISE_CLIENT` the way D54 does `PREPARE_RETURN`, and `markStepInProgress` refuses both. `markStepDone` and the waiting logic for step 1 are untouched — the income save drives step 1 through them.

**D99 — The Form 2307 register shows plain status labels** *(2026-09-30, brief #5q; extends D63)*

`form2307StatusLabel` (`lib/workflow/status.ts`, beside `filingStatusLabel`/`stepStatusLabel`): Received, Recorded, Claimed on return, Included in SAWT, Acknowledged, Validated. The register at `/clients/[id]/form-2307` was the only place that rendered the raw enum (confirmed by grep).

**D100 — Step 5 is locked until all of Prepare (steps 1–4) is resolved** *(2026-09-30, brief #5r, her decision)*

Found on Ernesto Villamor's Q3: Prepare was pending and step 5's Mark done was live, so marking it would have filed the return and frozen a snapshot (D83) with no computation behind it. *Rule:* step 1 Done; step 2 Done or Skipped; steps 3 and 4 Done. Wording: "Finish Prepare first."

**✅ BUILT 2026-09-30, brief #5r.** `prepareFinishedBlockReason` (`lib/workflow/groups.ts`) is checked in `markStepDone`'s FILE_RETURN path before the filing-order check (D95) and before anything is written; `stepLockReason` returns it for FILE_RETURN, so the card's greyed-out Mark done carries it as a tooltip (D41). When both locks apply, the Prepare reason is shown — she can act on it on the same filing. Next (D84) and the Next banner (D77) never offer step 5 while it is locked, because `nextActionForFiling` skips locked steps and the open Prepare step comes first in group order. The seed needed no change: every scenario files through the app's own actions, and all six seeded filed returns have Prepare resolved (checked). Existing tests that filed step 5 directly now resolve Prepare first through `resolvePrepare` (`tests/helpers/filedEarlier.ts`).

**D101 — Step 16 is Mark done only, saves its email when done, and collapses** *(2026-09-30, brief #5r, her decision after her first walk of the Client package group)*

No Start, no Skip (and no skip-reason box); `skipStep` and `markStepInProgress` refuse `SEND_CLIENT_PACKAGE` server-side, by adding it to `NO_START_NO_SKIP_STEP_CODES` (D65/D75), and `nextActionModeForStepCode` returns "markDoneOnly" so the Next banner matches the card (D77). Marking it Done saves the exact email on the filing — new `Filing.clientPackageEmailTo/Subject/Body/SavedAt`, the same shape as step 12's (D87), chosen over a shared table because it is what steps 4 and 12 already do — and the card collapses to "Emailed [date]: [subject]" with a Show email link. The email box, Copy buttons and Download package are then hidden (Download was not kept on the collapsed line: the documents still live on their own steps). A filing whose step 16 was Done before this has no saved email and reads "Done [date]" with no Show email — nothing is invented. Step 2 is now the only step left that can be skipped; a step 16 skipped in old data still shows "Skipped" with Undo skip.

**D102 — Step 16's email: a summary that adds up, an attachments list that matches the zip, right names, To/Subject/Body** *(2026-09-30, brief #5r, her decisions)*

*Three errors on Rosario Garcia's Q3:* the summary left out tax paid on earlier quarters (item 56), so ₱26,800 − ₱25,000 did not give ₱8,200; it put one quarter's gross next to a year-to-date tax due; it listed "Form 2307 certificates" for a client with none; and "Next filing: 1701Q for ANNUAL" named the wrong form and a raw code. *Now:* the summary is built from the filing's frozen sheet (`getFilingSheet`, D83), following the return's own lines: gross sales this quarter, taxable income and tax due *year to date*, then each credit as a "Less:" line (excess credit from last year, tax paid on earlier quarters, creditable withholding, other credits — zero lines left out), a "Rounding to whole pesos" line only when the form's whole-peso total differs from the printed lines, and Tax payable or Overpayment last. The Annual (1701A) uses its own lines; Form 1701 and pre-#5d snapshots use the older shape. Tests check that the printed lines reconcile to the final figure for payable, overpayment, rounding, annual and legacy cases. The "attached" list is the package's own document list (`lib/documents/filingPackage.ts`, also what the zip is built from), labelled in plain words ("Filed return", "Proof of payment", "Form 2307 — [payor]"). The next-filing line uses the right form and a plain period ("Annual ITR (1701A)", "Q3 2026"). To / Subject / Body each have a Copy; a client with no email shows one muted line, "Client email missing — add it on the client page", which never blocks (`lib/workflow/clientPackageEmail.ts`, `clientPackageEmailData.ts`).

*Her documents date for the Annual (D4: a setting, not a literal).* When the next filing is the Annual, the line ends "Please send required documents by Feb 15, 2027." New `TaxRuleSet.annualDocsDueMonthDay` (default `02-15`, the year after the taxable year), editable on the tax rule set screen beside the eSubmission address; migration `20260930090000_brief_5r_client_package_email_and_docs_deadline`. It is **not** D14's Mar 31 (`internalFilingTarget`, her own *filing* target), which is untouched. No weekend/holiday shifting: the app's one client-facing date rule (D53/brief #5e's payment lead time) exists to land a *payment* before a due date, which does not apply to a date on which she receives documents. The quarterly next-filing line is unchanged in structure ("Next filing: 1701Q for Q3 2026, due Nov 16, 2026.").

**D103 — The package zip is flat and has no manifest** *(2026-09-30, brief #5r, her decision; supersedes D22)*

Every document sits directly in the zip under its saved name (a short " (2)" suffix if two names collide — never overwritten); the step-code folders and `manifest.txt` are gone. The app's own document records remain the audit trail. The zip is named plainly — "Rosario Garcia - 1701Q Q3 2026.zip" (Annual: "… - 1701A Annual 2026.zip") — where it used to be `[client code]-[year]-[period]-package.zip`.

**D104 — A sticky client bar on the client page and its Income, Form 2307s and Payors pages** *(2026-09-30, brief #5r, her request)*

`components/client-sticky-bar.tsx`, one component on all four pages, modelled on the filing page's bar (D80): shown only once the page header scrolls out of view, beside the menu (never over it), with the client's name (a link to the client page), TIN and the Income, Form 2307s and Payors buttons. It lives on different pages from the filing bar, so the two never appear together.

**D105 — The Form 2307 register opens on the whole year; no internal references in screen text** *(2026-09-30, brief #5r)*

The register defaults to "All periods" (same set as Annual's: quarters 1–4) with the year/period filter kept; before, it opened on Q1, so a client whose certificates were all on Q3 opened on an empty table. Brief numbers, D-numbers, "SPEC.md" and "Phase" labels came off the screen — changed: Settings hub (tax rule sets and ATC cards, the later-features list — "Workflow step template" removed as the app has no custom steps by design; "Backup" kept with no phase label; heading now "Not built yet"), ATC codes page and form, Holidays page, Tax rule sets page, the tax rule set form's three section headings, the Form 2307 register's intro, the election-block error message (`markStepDone`) and two computation-sheet source notes (`lib/tax/compute.ts`; frozen snapshots keep the wording they were written with). Code comments were left alone. *Also in this brief:* the filing board scrolls sideways inside its own area, capped to the window's height so its scrollbar is on screen, with the column names kept in view and columns 224px wide instead of 256px — it cannot fit seven columns at 1280px without squeezing the cards.

---

**Documentation reconciled through brief #5p** (this pass; earlier passes: #5m, then #5o's light additions D83–D93) — see the "Last reconciled" line at the top of this file, CURRENT_STATE.md, PROJECT_MASTER.md and CLAUDE.md.
