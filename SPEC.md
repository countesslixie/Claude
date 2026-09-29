# SPEC: BIR 8% Freelancer Practice Manager (MVP)

> ## ⚠ Superseded sections — added 2026-09-20, evening (updated by the branch reconciliation pass; extended the same evening by brief #4a's grouping pass; extended 2026-09-26 by the brief #4f documentation pass, covering briefs #4c–#4e; extended 2026-09-27 by brief #5c, covering briefs #5a and #5b; extended 2026-09-28 by brief #5h, covering briefs #5d–#5g; extended again 2026-09-28 by brief #5j, covering brief #5i; extended again 2026-09-28 by brief #5k, the File group's first walkthrough; extended again 2026-09-29 by brief #5l, the File group finished)
>
> This is the **original design document** and is kept as history, not rewritten (**with one exception — see the note at the bottom of this banner: brief #5d edited body text directly, once**). Several sections below no longer reflect the current design, and are now also fully implemented that way in code — after two rework passes were reconciled onto a single branch (`DECISIONS.md` D31), decided and built agree again everywhere in this table. `PROJECT_MASTER.md` and `DECISIONS.md` are authoritative over this file wherever they disagree.
>
> | Section | Superseded by | Current design | Built here |
> |---|---|---|---|
> | **§5 `SalesTransaction`, §7.1 step 1–2's original table** — transaction entry sourced from 2307s | **D26** — gross sales are the client's declared quarterly figure (`QuarterlySales`); a 2307 reports withholding only, nothing else | Yes | **Yes** — `SalesTransaction` deleted; `/clients/[id]/income` is the entry screen |
> | **§9 Books of Accounts** — this system generates the Cash Receipts Journal | **D25** — no books of accounts are generated at all | Yes | **Yes** — `lib/books/` and its models are deleted |
> | **§10's three-check reconciliation** | **D26**, as a consequence — once income is declared-only, the certificate-vs-transaction checks have nothing left to compare | Yes | **Yes** — one annual certificates-vs-declared-sales check (`lib/reconciliation.ts`) |
> | **§7.1's per-step doc-slot table** (every slot required, including steps 4, 12, 15, 16) | **D27** — blocks only on documents received from outside; steps 4/12/16 carry no slot, step 15 is optional | Yes | **Yes** — verified against `lib/actions/workflowSteps.ts` and the seeded `WorkflowStepTemplate` |
> | **§7.1's step order** — step 1 `RECEIVE_2307`, step 2 `RECORD_CRJ` | **D28** — step 1 is Record quarterly sales, step 2 is Receive Form 2307 | Yes | **Yes** — `RECORD_CRJ` retired, `RECORD_SALES` is step 1, linking to `/clients/[id]/income` |
> | **§3.1's election rule** — described but, historically, never actually enforced | Not superseded — this is §3.1's own design intent, finally carried out | Yes | **Yes** — `lib/workflow/election.ts`, wired into `markStepDone` |
> | **§7.1's flat sixteen-step list** (the table itself, and "steps are ordered but not rigidly gated" as the only structure above it) | **D32** — the sixteen steps are wrapped in five groups (Prepare, File, Pay, SAWT, Close); a step's own blocking rule (D27) is unchanged. **D32's own "Mark done is per-group, not per-step" is itself no longer true — superseded 2026-09-28 by D62 (brief #5i, her decision): "done" is per-step only, in every group, and the group header just reports Pending or Done** | Yes | **Yes** — `lib/workflow/groups.ts`; `markGroupDone` is deleted; `components/workflow-group-card.tsx` shows status only |
> | **§11 item 2** — "kanban with columns = the 16 steps" | **D32** — columns are the five groups; a card sits in its earliest incomplete group | Yes | **Yes** — `app/(app)/filings/page.tsx` |
> | **§3.5's CWT cutoff rule** (the whole paragraph — manual override, `filedAt`-then-"today" resolution, period-end never used as cutoff) | **D34** (brief #4b) — a certificate's credit period is decided by the filing whose step 2 it was entered under, never by a resolved cutoff date; **D38** (brief #4d) then removed `dateReceived` itself, which this paragraph also assumes exists | Yes | **Yes** — `certificateCutoffDate`, the override, and the resolver are deleted; `Form2307` has no `dateReceived` column |
> | **§5's `Form2307.dateReceived` field** | **D38** (brief #4d) | Yes | **Yes** — confirmed absent from `prisma/schema.prisma`, 2026-09-26 |
> | **§5's `Filing.receiptsAcknowledgedAt`/`receiptsAcknowledgedNote` fields, and §7.1's step 3 acknowledgement paragraph they back** | **D37** (briefs #4c/#4d) — the source-of-figure field and the whole client-confirmation acknowledgement are removed outright, not merely reworded | Yes | **Yes** — confirmed absent from `prisma/schema.prisma`, 2026-09-26; step 3 now generates only the computation sheet |
> | **§7.1's step 1–2 rows**, as already reordered by D28 — described there as ordinary steps, each with a single manually-attached doc slot | **D33** (step 1) and **D35** (step 2), brief #4b — both steps are self-completing, with no manual controls at all; step 2 holds a variable number of certificate rows itself rather than pointing at one slot | Yes | **Yes** — `components/record-sales-step-card.tsx`, `components/receive-2307-step-card.tsx` |
> | **§3.5's "Store `withholdingRate` and `atcCode` per certificate; never infer the rate"** | **D43** (brief #5a) — ATC code is now chosen from a picker of maintained `AtcCode` rows, and the rate is filled from that code's own rate rather than typed independently; still editable per certificate, and `Form2307.rateOverridden` records when her value disagrees with the code's. D19's own rule ("never invent a code or a rate") is a different thing and is **not** superseded — it still governs both the `AtcCode` table and this picker; only the certificate-level instruction to store the rate independently of any code is what's changed | Yes | **Yes** — `components/atc-code-select.tsx`, `lib/actions/form2307.ts`'s `addCertificate` |
> | **§5's `Form2307` block** — no required-field distinction shown, and describes the scan (via `documentId`/`Document.form2307Id`) as attachable at any point after the row exists | **D45** (brief #5a) — payor TIN, payor address and ATC code are now required on the certificate, validated server-side (`lib/validation/form2307.ts`'s `certificateEntrySchema`) as well as on the form; **D46** (brief #5a) — the scan is part of creating the certificate: `addCertificate` refuses to save without one, and there is no separate upload step afterward, only **Replace scan** (one-for-one, the prior scan soft-deleted) | Yes | **Yes** — `components/certificate-form.tsx` |
> | **§5's "Supporting tables" list** — does not include a `Payor` table (predates it) | **D44** (brief #5a) — a `Payor` model now exists, one row per client (name, TIN, address, usual ATC code, active flag), shared by step 1's and step 2's name fields with **no** foreign key from `QuarterlySalesCustomer` or `Form2307` — a reference list of names/details only, never a link between income and certificates. Called "Payors" on screen (**D48**, brief #5b renamed it from "Customers / payors"); the table/model name itself is unchanged | Yes | **Yes** — `prisma/schema.prisma`'s `Payor`, `components/payor-name-field.tsx`, `components/payor-details-dialog.tsx` |
> | **§11 item 9** — Settings list includes "chart of accounts" | Not superseded by #5a/#5b specifically — **chart of accounts has had no such screen, and never will, since D25** (brief #4-era: no books of accounts at all). Recorded here because this pass is the first to add a settings-list banner row: Settings currently builds tax rule sets, holidays, and, as of **D43** (brief #5a), ATC codes (`/settings/atc-codes`, add/edit/deactivate). "Workflow template" and "backup" are not built either — both still listed under the app's own "Coming in later phases," same as "chart of accounts" itself, which the app's Settings screen has also not yet had removed from that placeholder list — a leftover, not touched by this documentation-only pass | Partially | **Partially** — `app/(app)/settings/page.tsx`'s `BUILT`/`LATER` lists |
> | **§11 item 6** — "2307 register." (no further detail) | **D35** (brief #4b) — the register (`/clients/[id]/form-2307`) has been **read-only** since certificate entry moved into step 2; it still shows the annual reconciliation and the SAWT keying-worksheet link | Yes | **Yes** — `app/(app)/clients/[id]/form-2307/page.tsx` |
> | **§3.2's formula, and §6/§16 item 1's "exact to the centavo"** — `taxPayable` subtracts only CWT, prior-period payments and prior-year excess credit, and every worked example is asserted centavo-exact | **D49** (brief #5d, her decision) — the 1701Q/1701A computation now follows the BIR form's own line items and rounds half-up to the whole peso at exactly the items eBIRForms rounds (item 49/51/54/62/63 on 1701Q; item 47/52/56/57/58/59/60/64/65 on 1701A); `taxPayable`'s formula also gains a fifth term, other tax credits/payments (item 61/63, D55, brief #5f). Money is still integer centavos throughout — a rounded line is simply a multiple of 100. Only the 1701Q and 1701A are built this way; `MIXED_INCOME`'s annual return (Form 1701) has no sheet and keeps the old centavo-exact `computeFiling`, renamed `LegacyFilingComputationResult`/`Input` | Yes | **Yes** — `lib/tax/compute.ts`'s `computeQuarterlyForm`/`computeAnnualForm`; §6 body text below was itself edited for this, see the note at the end of this banner |
> | **§3.1's election rule's own scope** — silent on which forms get a computed sheet at all | **D49** (brief #5d) — only the 1701Q and the 1701A (`PURELY_SELF_EMPLOYED` only) get a form-line sheet; `MIXED_INCOME`'s annual 1701 has none, unaffected by this brief | Yes | **Yes** — see the row above |
> | **§5's `ClientTaxYear.priorYearExcessCreditCents`** — described with no note on where it's entered | **D55**/**D56** (briefs #5e/#5f) — entered only once, via the starting figures (`StartingFigures`, a new model, brief #5f), for a client's *own* value; the field itself is unchanged and is still what the tax engine reads every period | Yes | **Yes** — `lib/actions/startingFigures.ts`'s `saveStartingFigures` writes it; the Taxable-years table's own edit field for it is gone |
> | **§7.1's step 3/4 rows**, and **§7.2**'s "A step may be `SKIPPED` only with a written `skippedReason`" as a blanket rule | **D54** (brief #5f, her decision: "it is the heart of the app") — step 3 (`PREPARE_RETURN`) can no longer be skipped at all, under any reason; **D51** (briefs #5d–#5f) — step 4 (`ADVISE_CLIENT`) is no longer a waiting step ("Waiting? Client" in §7.1's own row is gone) and is blocked server-side until step 3 is Done | Yes | **Yes** — `lib/actions/workflowSteps.ts`'s `skipStep` refuses `PREPARE_RETURN`; `controlsMode="markDoneOnly"` on both steps' cards |
> | **§11's design note** — "grey pending, blue in progress, amber waiting, red overdue, green done" and "dense over pretty" with no mention of navigation | **D58** (brief #5g, her decision) — in progress is now **purple**, not blue; a left-side menu replaces the top bar (Dashboard; Work: Filings, Clients; Settings: Tax rule sets, Holidays, ATC codes) | Yes | **Yes** — `app/globals.css`'s colour tokens, `components/nav.tsx` |
> | **§7.1's "Steps 11–14 are conditional… auto-set to `NA` and hidden from the active view — but remain visible in a 'show skipped' toggle"** | **D60** (brief #5i) — only `NA` steps sit behind that toggle, now relabelled "Show N not applicable"; a genuinely `SKIPPED` step was never meant to share it and now never does — it stays visible in place, in its group, with an Undo skip control | Yes | **Yes** — the filing page's toggle and its `naCount`/`visibleSteps` split |
> | **§11's design note (status colours), and anywhere a status is shown** — no mention of label wording, only colour | **D63** (brief #5i) — every filing and step status now renders a plain, sentence-case label, never the raw enum value; colours (D58) are unaffected, this is wording only | Yes | **Yes** — `lib/workflow/status.ts`'s `filingStatusLabel()`/`stepStatusLabel()` |
> | **§7.1's step 5 row's title** ("File return via eBIRForms/eFPS"), and **§7.2's blanket "a step may be `SKIPPED` only with a written reason"**, as it applies to steps 5, 6, 7 and 10 | **D66** (brief #5k, her decision) — step 5 renamed "File return via eBIRForms," since she doesn't use eFPS; **D65** (brief #5k) — steps 5, 6, 7 and 10 (the whole File group) lose Start and Skip entirely, enforced server-side, joining step 3's existing no-skip exception; **D67** (brief #5k) — steps 6 and 7 lose Mark done too, and step 10 keeps only Mark waiting: all three unlock only once step 5 is Done, show their upload box directly with no "Attach" link, and complete themselves the moment the document is attached, the same self-completing pattern D33/D35 already gave steps 1/2. **"…and step 10 keeps only Mark waiting" is itself superseded the very next row down (D68, brief #5l) — step 10 has no manual waiting control left at all.** | Yes | **Yes** — `prisma/seed.ts`'s `WORKFLOW_STEP_TEMPLATE` (+ a title backfill for existing rows); `lib/actions/workflowSteps.ts`'s `skipStep`/`markStepInProgress`/`recomputeFileGroupDocStepStatus`; `lib/actions/documents.ts`'s `saveDocumentForStep`; `components/file-group-doc-step-card.tsx` |
> | **§7.2's "Setting a waiting step to `WAITING_EXTERNAL` stamps `waitingSince`"** — read as describing a manual action throughout | **D68** (brief #5l, her decision) — step 10 (`RECEIVE_TRRC`) is now the one waiting step that sets itself: `markStepDone` moves it to `WAITING_EXTERNAL` automatically, in the same action, the instant step 5 (`FILE_RETURN`) is marked Done, and there is no longer a manual "Mark waiting" for it at all (`markStepWaitingExternal` refuses `RECEIVE_TRRC` outright). Removing its only file, once one exists, returns it to `WAITING_EXTERNAL` again (not `PENDING`, unlike steps 6/7) with `waitingSince` reset to step 5's own filed timestamp, not the moment of removal. Every other waiting step (`RECORD_SALES`/`RECEIVE_2307`'s own self-completion aside, which predates this and works differently again) is unaffected — this is step 10 specifically, not a rule change to §7.2 generally. **Also affects §7.1's step 10 row** ("Waiting? BIR") and **the D67 row directly above**, whose "step 10 keeps only Mark waiting" no longer holds | Yes | **Yes** — `lib/actions/workflowSteps.ts`'s `markStepDone` (its `FILE_RETURN` branch), `markStepWaitingExternal`, `recomputeFileGroupDocStepStatus`; `lib/workflow/groups.ts`'s `fileGroupOutstandingLabel` (D69, the File group's own collapsed-summary text, replacing the generic doc-slot-label fallback for that one group) |
>
> **Left alone deliberately, still current:** **§4**'s date-handling rules (the `getUTC*`/`manilaCalendarDay`/millisecond-arithmetic conventions), unchanged by any rework pass and still exactly how this codebase works. **§7.1's per-step table itself (columns, step codes, doc slots)** is also still current — D32 wraps it in groups without changing any row.
>
> **Gone from the application entirely, not merely undocumented here:** the `PREPARE_RETURN` step's source-of-figure field and optional client-confirmation-message slot (present as of D26/D27, removed by D37 — briefs #4c/#4d), and `Form2307.dateReceived` (D38, brief #4d). The step 16 client email's conditional eAFS-forwarding line (D27) and the five-group structure itself (D32) are still current and simply postdate this document — see `PROJECT_MASTER.md`.
>
> **§16's acceptance tests, not individually edited here:** item 13 ("a step with an empty required doc slot cannot be set DONE") no longer describes steps 1 or 2, which now carry no doc slot at all and self-complete instead (D33/D35) — it still holds for the remaining blocking steps. Item 16 ("editing a transaction in a filed period raises an `AmendmentAlert`") predates D26 and uses `SalesTransaction`-era language for what is now editing declared sales — already covered by the `SalesTransaction` row above. **Item 1 ("Examples A–E from §6, exact to the centavo")** no longer holds literally — see the §3.2/§6/§16 item 1 row above; the examples are still worked correctly, just no longer to the centavo for the 1701Q/1701A path.
>
> **Correction to this banner's own earlier claim that "SPEC.md's body text below is untouched":** that was true through brief #5c. **Brief #5d (2026-09-27) edited §6's body directly, once** — it added one paragraph right after the `computeFiling` signature, announcing the whole-peso rounding change, and rewrote Example E's figures (₱6,666.67 → ₱6,667.00) to match. This is the one deliberate exception to "kept as history, not rewritten," made because leaving Example E asserting a since-wrong figure right next to the engine that no longer produces it would have been actively misleading, not merely dated. Every other body section remains exactly as originally written.
>
> This is a banner, not a rewrite — SPEC.md's body text below is otherwise untouched and increasingly historical. Read `CURRENT_STATE.md` for what's actually in the tree before building against any section above.

> **How to use this file with Claude Code**
> Place this at the repo root as `SPEC.md`. Start with:
> `claude "Read SPEC.md. Build Phase 1 only. Ask me before deviating from the data model or the tax engine rules."`
> Build phase by phase. Do not let the agent build all phases in one pass.

---

## 1. Purpose

I am a bookkeeper serving multiple Philippine freelancers/professionals who elected the **8% income tax option**. Because only gross sales/receipts are taxed, the accounting is simple — but the **compliance choreography is not**. Each filing cycle spans 15+ steps, several of which stall for weeks waiting on BIR email responses.

**The problem this system solves is not arithmetic. It is state tracking.**

At any moment I must be able to answer, in under 10 seconds:
- Which client/period am I in the middle of?
- What is the next action, and is it blocked on me, the client, or BIR?
- Which required documents have I not yet saved?
- What has been waiting on BIR too long and needs a follow-up?

Secondary goals: replace the scattered per-client Excel files with one source of truth, auto-produce the 4 books of accounts, and compute quarterly/annual tax including Form 2307 creditable withholding.

**Primary success metric:** a single dashboard that makes "I'm lost as to which process I'm in" structurally impossible.

---

## 2. Users & Scope

**User:** one bookkeeper (me). Single-operator, local-first. Multi-user is out of scope; design the schema so it *could* be added (every mutation records an `actorId`, defaulted to a single seeded user).

### In scope (MVP)
- Client master file (registration details, tax regime, election status)
- Sales/receipt transaction recording
- Form 2307 register (creditable withholding tax certificates)
- Tax computation engine: 1701Q (Q1–Q3) and 1701A (annual)
- Filing workflow engine with per-step document slots and waiting-state aging
- Document vault with enforced naming convention
- 4 books of accounts, generated and printable
- SAWT / alphalist preparation worksheet
- Excel/CSV import from my existing files; XLSX export
- Dashboard, calendar, and per-client pipeline views

### Out of scope (MVP)
- Direct integration with eBIRForms, eFPS, eAFS, or BIR email systems. **There is no public API. Every BIR interaction stays manual — the system tracks and stores, it does not transmit.** Do not scaffold fake integrations.
- Automatic .DAT file generation for the Alphalist Data Entry Module. MVP produces a **keying worksheet** that mirrors the module's field order so manual entry is fast and error-free. (See §10 and Open Question 4.)
- Payroll, VAT, percentage tax returns, expanded withholding as a *withholding agent*
- Client-facing portal or login
- Automatic email sending or inbox scraping (Phase 5 candidate)

---

## 3. Domain Rules — Philippine 8% Income Tax

> **Implementation rule:** every number, rate, threshold, and deadline in this section must live in a **versioned configuration table with effectivity dates** (`TaxRuleSet`), never as a hardcoded literal in application code. Tax law changes. The engine reads the rule set applicable to the taxable year being computed.

### 3.1 Eligibility & election
- Available to self-employed individuals and professionals whose gross sales/receipts and other non-operating income for the year do **not exceed the VAT threshold of ₱3,000,000**.
- The 8% is **in lieu of** both the graduated income tax rates and the 3%/1% percentage tax under Sec. 116. A client on 8% does **not** file 2551Q.
- The option must be **elected each taxable year** (typically via the first-quarter return, or a registration update). If not validly elected, the taxpayer defaults to graduated rates.
- **System requirement:** the client record carries `electionStatus` per taxable year (`Elected` / `Not yet elected` / `Defaulted to graduated`) with an evidence document slot. The dashboard raises a **hard blocker** on any Q1 filing where election for that year is unconfirmed.

### 3.2 Computation

Let `TY` = taxable year, computed **cumulatively year-to-date** for every period.

```
cumulativeGrossSales        = sum of gross sales/receipts, Jan 1 → end of period
cumulativeNonOperating      = sum of other non-operating income, Jan 1 → end of period
cumulativeGross             = cumulativeGrossSales + cumulativeNonOperating
allowableDeduction          = ₱250,000  IF taxpayerType = PURELY_SELF_EMPLOYED
                            = ₱0        IF taxpayerType = MIXED_INCOME
taxableBase                 = MAX(0, cumulativeGross - allowableDeduction)
incomeTaxDue                = ROUND(taxableBase × 8%, 2)
cumulativeCWT               = sum of tax withheld per Form 2307, YTD, status ∈ {Recorded, Claimed}
priorPeriodPayments         = sum of tax actually paid on earlier returns for the same TY
priorYearExcessCredits      = carried-over excess credit elected as "carry over" (see 3.3)
taxPayable                  = incomeTaxDue
                              - cumulativeCWT
                              - priorPeriodPayments
                              - priorYearExcessCredits
```

- If `taxPayable < 0` → **overpayment**. Display as such; do not render a negative amount due. Do not net it against a later period *outside* the cumulative mechanism — the cumulative formula already carries it forward within the year automatically. Guard against double-counting: `priorPeriodPayments` means **amounts actually remitted**, never computed liabilities.
- The ₱250,000 deduction is a **once-per-year** figure and is applied in full from Q1 onward because the return is cumulative. It is **not** ₱62,500 per quarter. Add a unit test asserting this.
- **Mixed income earners get no ₱250,000 deduction** on the business portion (it is already embedded in the graduated table applied to their compensation). Also note: a mixed income earner files **BIR Form 1701**, not 1701A. The system must select the correct annual form from `taxpayerType`.

### 3.3 Year-end excess credit
On the annual return, if credits exceed tax due, the taxpayer elects one of: **refund**, **Tax Credit Certificate**, or **carry over to next year**. Store the election on the annual `Filing`; if `carryOver`, the amount becomes `priorYearExcessCredits` for the following taxable year.

### 3.4 Threshold monitoring
Continuously track `cumulativeGross` against ₱3,000,000. Emit escalating warnings at **80%**, **95%**, and **breach**. On breach the system must display a prominent, non-dismissible banner on the client record stating that the 8% option ceases to apply and the taxpayer becomes liable under the graduated rates with VAT registration consequences — and instructing me to consult the current BIR issuance. **Do not attempt to auto-compute the transition.** Flag only.

### 3.5 Form 2307 / creditable withholding
- Form 2307 = *Certificate of Creditable Tax Withheld at Source*, issued by the client's payor.
- Typical rate on professional fees to an individual payee: **5%** where the payee has furnished a sworn declaration that gross income will not exceed ₱3,000,000, otherwise **10%**. Store `withholdingRate` and `atcCode` per certificate; never infer the rate.
- Seed an **editable ATC reference table** (code, description, rate, payee type). Seed with the common professional-fee and contractor codes, each marked `verifiedAgainstIssuance: false` so I confirm them against the current BIR list before first live use. **Do not let the agent invent ATC codes it is unsure of** — leave the table sparse and editable rather than plausibly wrong.
- Certificate status lifecycle: `Received → Recorded → ClaimedOnReturn → IncludedInSAWT → Acknowledged → Validated`.
- **CWT cutoff rule.** A certificate is claimed in the period whose *cutoff* it falls within — not the period whose calendar dates it economically covers. The cutoff is resolved per filing (highest priority first): a manual override, if the bookkeeper has set one; otherwise the filing's actual `filedAt`, once filed; otherwise "today," for a live preview of an unfiled filing. Certificates routinely arrive weeks after the period they cover closes (e.g. a Q2 certificate arriving in early August, after the June 30 period end), so the period's own end date is never used as the cutoff. **The bookkeeper does not file amended returns** when a certificate arrives late — it is simply claimed on whichever filing is open (by cutoff) when it arrives.

### 3.6 Deadlines

| Return | Period | Statutory due date |
|---|---|---|
| 1701Q | Q1 (Jan–Mar) | May 15 |
| 1701Q | Q2 (Apr–Jun) | August 15 |
| 1701Q | Q3 (Jul–Sep) | November 15 |
| 1701A / 1701 | Annual | April 15 of the following year |

Each quarterly period runs the full calendar quarter (Q1 Jan 1–Mar 31, Q2 Apr 1–Jun 30, Q3 Jul 1–Sep 30); the annual period is the full taxable year, Jan 1–Dec 31 — not just Q4.

- **There is no Q4 quarterly return.** The annual return covers the fourth quarter. Hardcoding a Q4 filing is a bug.
- **Business-day shifting:** if a due date falls on a Saturday, Sunday, or a holiday, it moves to the next working day. Implement against an **editable `Holiday` table** (regular + special non-working, national and local). Seed the current and next year; surface an admin screen to maintain it. Never compute holidays algorithmically.
- SAWT submission deadline is a **configurable offset** per `TaxRuleSet`, defaulting to *same day as the return deadline*. eAFS submission deadline is **derived**, never stored as a plain date: `eafsDueDate = (filedAt is null OR filedAt ≤ adjustedDueDate ? adjustedDueDate : filedAt) + eafsDeadlineOffsetDays` (offset configurable per `TaxRuleSet`, defaulting to 15 days), then business-day shifted. **Filing early never moves the eAFS deadline earlier** — only filing late (after the due date) pushes it out further, counted from the actual filing date instead of the due date.
- **Working calendar (practice targets, distinct from the statutory deadline above).** Per filing: `certificatesExpectedBy` (when the bookkeeper expects to have all certificates for the period in hand) and `internalFilingTarget` (when the bookkeeper aims to file), both independently editable and never authoritative — the statutory/adjusted due date above always governs. **Quarterly returns (Q1/Q2/Q3): `internalFilingTarget` is the ADJUSTED (business-day-shifted) due date itself — deliberately no internal buffer.** The bookkeeper works to the normal statutory deadline for quarterlies; e.g. Q2 2026's `internalFilingTarget` is Aug 17 (the adjusted date), not Aug 15 (the raw statutory date, a Saturday). `certificatesExpectedBy` is 10 days before the *statutory* due date (unshifted) regardless. One consequence of no buffer: for a quarterly filing, every prep-step row and the `FILE_RETURN` row show the *same* due date — the "Due" column carries one consistent meaning (the adjusted deadline) for that filing, not two different numbers depending on which step you're looking at. **The annual return keeps a real buffer instead**, reflecting the larger scope of the alphalist/SAWT compilation involved: `certificatesExpectedBy` Feb 15, `internalFilingTarget` Mar 31 (of the following year) — weeks ahead of the Apr 15 statutory/adjusted deadline. The `RECEIVE_2307` workflow step's waiting clock starts from `certificatesExpectedBy`, not the period's end date — certificates are often not even due from the payor until weeks after the period closes.
  - *Known limitation:* `internalFilingTarget` is a single value per filing, shared by every prep step's displayed due date (everything except `RECEIVE_2307` and `FILE_RETURN` itself) — so every prep row for a filing shows the same date rather than a date staggered per step. For quarterlies this is now intentional (see above); it remains a real limitation for the annual return, where a per-step staggering ahead of the Mar 31 target could be useful at scale. Not a bug; revisit if that granularity becomes useful.
- All date arithmetic uses timezone **Asia/Manila**. Store timestamps as UTC ISO strings; convert at the boundary. Never use the host's local timezone.

### 3.7 Late filing exposure (informational only)
Provide an optional calculator: surcharge, interest per annum, and compromise penalty — all **rates and the compromise schedule stored in `TaxRuleSet`, none hardcoded**. Every output must be labelled *"Estimate for internal planning only — confirm against the assessment issued by BIR."*

---

## 4. Technical Stack

Chosen for a single local operator who is not a developer.

- **Next.js 15 (App Router) + TypeScript**, strict mode
- **SQLite via Prisma** — a single `data/app.db` file makes backup a copy-paste operation
- **Tailwind CSS + shadcn/ui**
- **Zod** for all input validation, shared between client and server
- **Luxon** for dates, pinned to `Asia/Manila`. **Date handling rules** (a recurring bug class found and fixed repeatedly across this codebase — a UTC-instant/Manila-calendar-day mismatch that is invisible in code review and only shows up as an off-by-one-day or off-by-part-of-a-day error in specific cases):
  - **Never extract calendar components via `getUTCFullYear()`/`getUTCMonth()`/`getUTCDate()`/`getUTCDay()`** (and never their host-local, non-UTC equivalents — those must never appear at all). These read the *UTC* calendar day, which is not the *Asia/Manila* calendar day unless the instant happens to be exactly UTC midnight. Convert via Luxon first: `DateTime.fromJSDate(d).setZone(MANILA_ZONE)`.
  - **"Which calendar day" questions compare Manila calendar-day values, never raw instants.** Use `lib/dates.ts`'s `manilaCalendarDay(date)` (returns `"yyyy-MM-dd"` in Asia/Manila; string-comparable) for "is this the same day" / "is this on-or-before that day," not `.getTime()` with `<`/`>`/`<=`/`>=`. The one exception: genuine elapsed-time/duration math (e.g. "how many whole days has this step been waiting") is correctly raw millisecond math, because duration is an instant-to-instant question, not a calendar-day one — don't "fix" that case into a calendar-day comparison either.
  - **Adding N days to a date is plain millisecond arithmetic** (`date.getTime() + N * 86_400_000`), never `Date.UTC(getUTCFullYear(), getUTCMonth(), getUTCDate() + N)`. The Philippines observes no DST, so millisecond math always lands on the correct calendar day; the UTC-component-reconstruction form is exactly the bug this rule exists to prevent (it silently reads the wrong day whenever the source instant isn't UTC midnight — e.g. a real `new Date()` timestamp taken during Manila's 00:00-07:59 window, still the previous UTC day).
  - **Displaying a stored date always goes through `formatManilaDate`/`toManilaDateInputValue`** (`lib/dates.ts`) — never `.toISOString().split("T")[0]` or similar raw string slicing, which renders the UTC calendar day.
  - **A stored "due date"/calendar-day marker is UTC midnight standing in for the Manila calendar date.** Construct one via `Date.UTC(y, m, d)` for a literal year/month/day, or via `manilaDateInputToJsDate()` (Manila-zone `.startOf("day")`) for a date typed by the user — never a bare `new Date(y, m, d)` local constructor (host-timezone-dependent) and never `new Date()` for anything meant to be a calendar day rather than a genuine instant.
- **Decimal.js for all money.** Store money as **integer centavos** in SQLite. Floating-point arithmetic on currency is forbidden anywhere in the codebase; add an ESLint rule or a code-review note.
- **Vitest** for the tax engine (non-negotiable — see §16)
- **exceljs** for XLSX import/export
- Documents on the **local filesystem** under `./storage`, never as DB blobs
- Auth: single password from `.env`, session cookie. Adequate for a local prototype; do not deploy to a public host without revisiting.

**Repo layout**
```
/app                  routes
/lib/tax/             computation engine — PURE FUNCTIONS, zero I/O
/lib/workflow/        step template + state machine
/lib/documents/       storage, naming, hashing
/lib/books/           journal + ledger generation
/prisma/schema.prisma
/prisma/seed.ts
/storage/             gitignored document vault
/data/                gitignored sqlite db
/tests/
```

`/lib/tax/` must have **no database imports**. It takes a plain input object and returns a plain result object. This is what makes it testable and auditable.

---

## 5. Data Model

Prisma schema. Money fields are `Int` (centavos) with a `Cents` type alias in TypeScript.

### Client
```
id, code (short slug, used in file paths)
registeredName, tradeName
tin (9 digits), branchCode (default "000")
rdoCode
registeredAddress, email, mobile
taxpayerType          enum: PURELY_SELF_EMPLOYED | MIXED_INCOME
lineOfBusiness, psicCode
civilStatus
booksType             enum: MANUAL | LOOSE_LEAF | CAS
booksRegistrationDate, booksPermitNumber
swornDeclarationOnFile boolean, swornDeclarationYear
eBIRFormsEmail, eFPSEnrolled boolean
defaultWithholdingRate
isActive, engagedSince, notes
```

### ClientTaxYear
One row per client per taxable year. **This is the anchor for annual state.**
```
clientId, taxableYear
regime                enum: RATE_8_PERCENT | GRADUATED_OSD | GRADUATED_ITEMIZED
electionStatus        enum: ELECTED | NOT_YET_ELECTED | DEFAULTED_GRADUATED
electionEvidenceDocId
priorYearExcessCreditCents
yearEndCreditElection enum: REFUND | TCC | CARRY_OVER | NA
thresholdBreachedAt   nullable
```

### SalesTransaction
```
id, clientId, transactionDate, taxableYear, quarter (derived, indexed)
orNumber (unique per client, nullable for non-OR receipts)
payorName, payorTin
grossAmountCents
withholdingTaxCents, withholdingRate      -- expected WHT at point of receipt
netReceivedCents                          -- derived; validate = gross - wht
incomeType            enum: OPERATING | NON_OPERATING
description
form2307Id            nullable FK
sourceDocumentId      nullable FK
importBatchId         nullable
createdAt, actorId
```
Index on `(clientId, taxableYear, quarter)` and `(clientId, transactionDate)`.

### Form2307
```
id, clientId, taxableYear
payorName, payorTin, payorAddress
periodFrom, periodTo, quarterCovered
atcCode, incomePaymentCents, taxWithheldCents, withholdingRate
dateReceived
status                enum (see §3.5)
documentId
claimedOnFilingId     nullable FK
sawtBatchId           nullable FK
notes
```

### Filing
One row per client per period per taxable year.
```
id, clientId, taxableYear, period    enum: Q1 | Q2 | Q3 | ANNUAL
formType              enum: F1701Q | F1701A | F1701
statutoryDueDate, adjustedDueDate     -- after holiday shift
status                enum: NOT_STARTED | IN_PROGRESS | WAITING_CLIENT
                          | WAITING_BIR | BLOCKED | COMPLETE | NA
requiresSawt          boolean, derived: any Form2307 in period
computationSnapshot   JSON   -- FROZEN at time of filing
filedAt, filingReferenceNumber
amountPaidCents, paymentDate, paymentChannel
receiptsAcknowledgedAt, receiptsAcknowledgedNote   -- step 3 prompt, added 2026-08-20 (§7.1)
notes
```

**`computationSnapshot` is immutable once `filedAt` is set.** If a transaction is later edited for a filed period, the system must **not** silently rewrite the snapshot. It raises an `AmendmentAlert` on the filing showing the delta between the frozen snapshot and the live recomputation, and I decide whether to amend. This is the single most important integrity rule in the system.

### WorkflowStep
```
id, filingId, stepCode, sequence, title, description
category              enum: PREP | FILING | PAYMENT | SAWT | ATTACHMENT | CLIENT_COMM
status                enum: PENDING | IN_PROGRESS | WAITING_EXTERNAL | DONE | SKIPPED | NA
isConditional         boolean, conditionExpression   -- e.g. "requiresSawt == true"
isWaitingState        boolean
expectedResponseDays  nullable int
waitingSince          nullable datetime
followUpCount         int
requiredDocSlots      JSON  -- [{slotCode, label, required, acceptedTypes}]
startedAt, completedAt, skippedReason, notes, actorId
```

### Document
```
id, clientId, filingId?, workflowStepId?, docSlotCode?, form2307Id?
category              enum
originalFilename, storedPath, mimeType, sizeBytes
sha256                -- duplicate detection
documentDate          -- date on the document, not upload date
uploadedAt, actorId, notes
```

### Supporting tables
`JournalEntry` + `JournalEntryLine`, `ChartOfAccounts`, `Holiday`, `TaxRuleSet`, `AtcCode`, `SawtBatch`, `ActivityLog`, `ImportBatch`, `User`. **`JournalEntry`/`JournalEntryLine`/`ChartOfAccounts` are present in the schema but unused as of §9's Phase 4 scope decision** — they were modeled for a General Journal/General Ledger that isn't being built. Left in place rather than removed (cheaper to leave than to re-add); see §9.

### ActivityLog
Append-only. Every create/update/delete of a Filing, WorkflowStep, Document, SalesTransaction, or Form2307 writes `{entityType, entityId, action, beforeJson, afterJson, actorId, at}`. Never hard-delete these records.

---

## 6. Tax Computation Engine

`/lib/tax/compute.ts` exposes:
```ts
computeFiling(input: FilingComputationInput): FilingComputationResult
```

**Input** (plain object, assembled by the caller): taxable year, period, taxpayer type, applicable `TaxRuleSet`, YTD operating and non-operating totals, YTD creditable withholding, prior-period payments, prior-year excess credit.

**Output**: every intermediate line item plus a `breakdown[]` array of `{label, amountCents, sourceNote}` so the UI can render a computation sheet that **shows its work line by line**. I need to be able to hand this to a client or defend it to an examiner. A bare total is not acceptable output.

### Worked examples — implement these as passing tests

> **Brief #5d, 2026-09-27 — whole-peso rounding.** The 8% computation now follows the BIR form's own line items and rounds half-up to the whole peso at the items the form rounds (item 49/51/54/62/63 on 1701Q; item 47/52/56/57/58/59/60/64/65 on 1701A), not half-up to the centavo throughout as this section originally specified. Money is still stored as integer centavos (a rounded line is simply a multiple of 100); only Example E's figures below actually change under this — the others were already round numbers.

**Example A — purely self-employed, 8%, all receipts subject to 5% CWT, TY2026**

| Period | Period receipts | Cumulative | Less ₱250K | × 8% | Cum. CWT | Prior payments | Payable |
|---|---|---|---|---|---|---|---|
| Q1 | 450,000 | 450,000 | 200,000 | 16,000 | 22,500 | 0 | **(6,500) overpayment → 0 due** |
| Q2 | 600,000 | 1,050,000 | 800,000 | 64,000 | 52,500 | 0 | **11,500** |
| Q3 | 500,000 | 1,550,000 | 1,300,000 | 104,000 | 77,500 | 11,500 | **15,000** |
| Annual | 550,000 | 2,100,000 | 1,850,000 | 148,000 | 105,000 | 26,500 | **16,500** |

Note how the Q1 overpayment is absorbed automatically by the cumulative mechanism — no manual carry-forward. Assert this explicitly.

**Example B — mixed income earner.** Gross business receipts ₱1,000,000, no ₱250,000 deduction → tax due ₱80,000. Assert `formType == F1701` for the annual period.

**Example C — below threshold.** Gross ₱200,000, CWT ₱10,000. Taxable base ₱0, tax due ₱0, overpayment ₱10,000. Assert the UI renders "Overpayment", never "-₱10,000 due".

**Example D — non-operating income.** Gross receipts ₱2,000,000 + non-operating ₱100,000 → both enter the base; assert cumulative gross ₱2,100,000.

**Example E — rounding.** Gross ₱333,333.33 → item 49 ₱333,333.00 → base (item 53) ₱83,333.00 → tax due (item 54) **₱6,667.00** (brief #5d — was ₱6,666.67 under the old centavo rounding). Assert half-up rounding to the whole peso and that no floating-point drift appears across four cumulative periods, and that a quarter's cumulative income (item 51) is always the sum of each quarter's own separately-rounded item 49, never a rounded raw multi-quarter total.

---

## 7. Workflow Engine

### 7.1 Step template

Seeded as data in `WorkflowStepTemplate`, instantiated when a `Filing` is created. **Editable through the UI** — my process will change.

| # | Step code | Title | Category | Waiting? | Doc slots (R = required) |
|---|---|---|---|---|---|
| 1 | `RECEIVE_2307` | Receive Form 2307 from client | PREP | Client | 2307 scan (R, conditional) |
| 2 | `RECORD_CRJ` | Record transactions in Cash Receipts Journal | PREP | — | source ORs/invoices (optional) |
| 3 | `PREPARE_RETURN` | Prepare computation + 1701Q/1701A | PREP | — | draft computation sheet (R) |
| 4 | `ADVISE_CLIENT` | Advise client of tax payable | CLIENT_COMM | Client | advisory email/screenshot (R) |
| 5 | `FILE_RETURN` | File return via eBIRForms/eFPS | FILING | — | — |
| 6 | `SAVE_SUBMISSION_SS` | Save submission-page screenshot | FILING | — | screenshot (R) |
| 7 | `SAVE_FORM_COPY` | Download and save filed form | FILING | — | filed form PDF (R) |
| 8 | `MAKE_PAYMENT` | Make payment | PAYMENT | — | — |
| 9 | `SAVE_PROOF_PAYMENT` | Save proof of payment | PAYMENT | — | payment confirmation (R) |
| 10 | `RECEIVE_TRRC` | Receive & save BIR confirmation (TRRC) | FILING | **BIR** | TRRC email/PDF (R) |
| 11 | `ALPHALIST_ENTRY` | Alphalist data entry + validation | SAWT | — | generated report (R), DAT file (R) |
| 12 | `EMAIL_DAT` | Email DAT file to BIR eSubmission | SAWT | — | sent-email evidence (R) |
| 13 | `SAWT_ACK` | Receive & save acknowledgement email | SAWT | **BIR** | acknowledgement (R) |
| 14 | `SAWT_VALIDATION` | Receive & save validation email | SAWT | **BIR** | validation email (R) |
| 15 | `EAFS_SUBMIT` | Complete and submit eAFS | ATTACHMENT | — | eAFS confirmation (R) |
| 16 | `SEND_CLIENT_PACKAGE` | Email package to client | CLIENT_COMM | — | sent-email evidence (R) |

**Steps 11–14 are conditional** on `requiresSawt`. When false they are auto-set to `NA` and hidden from the active view — but remain visible in a "show skipped" toggle so nothing silently disappears.

**Step 3 (`PREPARE_RETURN`), added 2026-08-20:** since transaction entry is now driven by the client's 2307s (the 2307 is the source document for the transaction row, not an independent check on it — see the transaction-entry workflow change), the computation sheet can be internally consistent while still missing receipts that never had a 2307 in the first place. Step 3 therefore prompts: *"Have you confirmed with the client that all receipts for this quarter are accounted for, including any without a 2307?"* The acknowledgement is recorded on the `Filing` with a timestamp (`receiptsAcknowledgedAt`, `receiptsAcknowledgedNote`) — a one-time confirmation, not a per-transaction check, and not itself a doc slot.

Step 16's package contents (filed form, proof of payment, TRRC, validation email) are **assembled by the system from the documents already saved against steps 7, 9, 10, and 14**. If any is missing, step 16 cannot be marked DONE — it displays exactly which document is absent. This is the check that closes the loop on "what have I not saved yet."

### 7.2 Rules
- Steps are **ordered but not rigidly gated**. Warn on out-of-order completion; do not block. Real practice is messier than any template.
- A step with unfilled **required** doc slots cannot reach `DONE`. It can reach `WAITING_EXTERNAL` or stay `IN_PROGRESS`.
- Setting a waiting step to `WAITING_EXTERNAL` stamps `waitingSince`. Aging is computed from that stamp.
- **Aging thresholds** (per step, configurable — defaults): green < `expectedResponseDays`; amber at 1×; red at 2×. Red items surface at the top of the dashboard with a **"Log follow-up"** action that increments `followUpCount` and re-stamps the clock. Defaults: TRRC 3 days, SAWT acknowledgement 3 days, SAWT validation 10 days, client response 5 days.
- A step may be `SKIPPED` only with a written `skippedReason`. No silent skips.
- Filing status is **derived** from its steps, never set by hand (including in seed/demo data — hand-typing a status literal there is exactly how this rule and the seed can silently disagree):
  - all `DONE`/`NA`/`SKIPPED` → `COMPLETE`. A skip is a deliberate, reasoned decision (it required a written `skippedReason` above) — it isn't "not done," so it must not block `COMPLETE` any more than `NA` does. A filing that reaches `COMPLETE` with one or more skipped steps renders as **"Complete (N steps skipped)"**, not a bare "Complete" — the skip stays visible rather than collapsing into an indistinguishable NA-like state; the filing detail page separately lists which steps were skipped, with the recorded reason.
  - any `WAITING_EXTERNAL` on a BIR step → `WAITING_BIR`
  - any `WAITING_EXTERNAL` on a client step → `WAITING_CLIENT`
  - past `adjustedDueDate` and not complete → `BLOCKED` (rendered red)

---

## 8. Document Management

**Storage path**
```
/storage/{client.code}/{taxableYear}/{period}/{stepCode}__{slotCode}__{YYYYMMDD}__{seq}.{ext}
```
Example: `/storage/dela-cruz-j/2026/Q2/SAVE_PROOF_PAYMENT__proof__20260812__01.pdf`

- Original filename preserved in the DB and restored on download/export.
- SHA-256 on upload; warn on duplicates within the same client.
- **Bulk import of my existing folders:** point the tool at a directory, it lists files with a proposed `{client, year, period, step, slot}` mapping inferred from path and filename, I correct the mappings in a review grid, then confirm. **Never auto-file without my confirmation.**
- **Export:** "Download period package" → zip of all documents for a filing, in step order, with a manifest listing every document, its slot, and its date — plus any slots still empty. **Known gap:** the manifest is plain text, not PDF — this project has no PDF-generation dependency, and a text file satisfies the actual requirement (every document plus empty slots, listed). Not adding a PDF dependency for this alone; revisit only if a real need for a formatted PDF manifest shows up.
- Every document row has a `documentDate` distinct from `uploadedAt`. BIR emails arrive weeks late; the document's own date is what matters for the record.

---

## 9. Books of Accounts

**Scope (decided 2026-08-21): the Cash Receipts Journal only.** Under the 8% option, only gross sales/receipts are taxed — a Cash Disbursements Journal, General Journal, and General Ledger have nothing in the tax computation that reads them, and the client maintains their own disbursements book independently. Building a CDJ with no feed and a ledger with nothing to post would be dead weight. This system generates the CRJ; the other three books are the client's responsibility and are **explicitly out of scope** — not deferred pending a future phase, a deliberate boundary.

**Cash Receipts Journal** — the only book this system generates. Sourced from `SalesTransaction`. A printable, columnar report with the taxpayer's registered name, TIN, and period in the header, page numbering, and a monthly totals line. Columns: date, OR no., payor, particulars, gross receipts, creditable withholding tax, cash received. Export as XLSX (for loose-leaf submission) and print-to-PDF-friendly HTML. Include a per-book "as of" lock so a printed period is not silently altered afterward — same amendment-alert pattern as §5.

**Not built, and not this system's concern:**
- Cash Disbursements Journal
- General Journal
- General Ledger

`JournalEntry`, `JournalEntryLine`, and `ChartOfAccounts` stay in the Prisma schema, unused — cheaper to leave in place than to re-add if this scope is ever revisited. `ChartOfAccounts.normalBalance` is deliberately **not** added; it becomes required only if the General Ledger is ever built (a ledger needs to know which side is "normal" per account to validate and display balances — the CRJ, having no ledger postings, does not).

---

## 10. SAWT / Alphalist Module

- Register all `Form2307` records for a period.
- **Reconciliation report, revised (2026-08-20):** with transaction entry driven by 2307s (§7.1 step 1 / the transaction record's `form2307Id`), "transaction CWT vs certificate CWT" is no longer a meaningful comparison — one derives from the other by construction, so a hand-entry-vs-hand-entry cross-check would just be comparing a number against itself. Replaced with three checks that catch real gaps instead:
  1. **Transactions with no linked `form2307Id`** — listed individually, with count and total. This is the real gap: a receipt that might be missing its certificate, or genuinely has none.
  2. **Certificates received for the period not yet converted into a transaction** — listed individually, with count and total.
  3. **Total CWT claimed on the filing vs. sum of certificates in the SAWT batch** — kept unchanged. Still a genuine cross-check against what actually gets filed, since the SAWT batch is an independent downstream artifact, not derived from the same entry action as the transaction.
- Produce a **keying worksheet** (screen + XLSX) with columns in the exact field order of the Alphalist Data Entry Module, so I can key it in quickly and check it off row by row. Include a running row count and total to verify against the module's own totals after entry.
- Track the batch through `Generated → Emailed → Acknowledged → Validated`, with a document slot at each stage, wired to steps 11–14.

---

## 11. Screens

1. **Dashboard (`/`)** — the answer to "where am I?"
   - Row 1: **Needs my action now** — steps assigned to me, sorted by adjusted due date
   - Row 2: **Waiting on BIR** — with aging badges, red first, each with a one-click "Log follow-up"
   - Row 3: **Waiting on client**
   - Row 4: **Upcoming deadlines**, next 45 days
   - Row 5: **Missing documents** across all in-progress filings, grouped by client
   - Row 6: threshold and election alerts
2. **Filing cycle board (`/filings`)** — kanban with columns = the 16 steps, cards = client-period. This is the visual "which process am I in" view. Filter by client, year, period, status.
3. **Client list / Client detail** — profile, tax years, filings timeline, transactions, 2307s, documents, books.
4. **Filing detail** — computation sheet (line-by-line breakdown), step checklist with inline upload per slot, document list, notes, amendment alerts.
5. **Transactions** — fast keyboard-first entry grid, inline edit, bulk import.
6. **2307 register.**
7. **Books** — select client, book, period → view/print/export.
8. **Calendar** — deadlines and expected BIR response dates.
9. **Settings** — tax rule sets, holidays, ATC codes, workflow template, chart of accounts, backup.

**Design note:** dense over pretty. This is a working tool. Status colours must be legible at a glance: grey pending, blue in progress, amber waiting, red overdue, green done. Every list view supports filtering by client and taxable year, and those filters persist across navigation.

---

## 12. Import / Export

- **Import:** XLSX/CSV of sales transactions. Column-mapping UI (my existing files differ per client — save a mapping profile per client and reuse it). Preview with per-row validation, reject-and-report on bad rows, all-or-nothing commit per batch, `ImportBatch` record with rollback.
- **Export:** any grid to XLSX; books to XLSX; filing package to zip; full database backup to a timestamped copy of the SQLite file plus a `storage/` archive, triggered from Settings.

---

## 13. Reminders

MVP is **in-app only** — no email/SMS infrastructure. Dashboard badges, aging colours, and an optional daily digest rendered on screen at login: what's due in 7 days, what's waiting past threshold, what's missing documents.

Phase 5 candidate (explicitly deferred): IMAP polling of my mailbox to auto-detect BIR acknowledgement/validation emails and attach them. Do not build in MVP.

---

## 14. Non-Functional

- **Data privacy:** this system holds TINs, addresses, and income data of real taxpayers, covered by the Data Privacy Act. Runs local. No third-party analytics, no telemetry, no external API calls at runtime. Do not add a CDN font, an error-reporting SDK, or any outbound request.
- **Backup:** one-click backup from Settings; on-screen reminder if the last backup is more than 7 days old.
- **Audit:** append-only `ActivityLog`; no hard deletes on financial records — soft-delete with reason.
- **Integrity:** money as integer centavos throughout; frozen computation snapshots; amendment alerts.
- **Performance:** target ~30 clients × 5 years — trivial for SQLite. Do not over-engineer for scale.
- **Seed data:** three fictitious clients across the full 2025 cycle — one purely self-employed with 2307s, one purely self-employed without, one mixed income — so every path is demonstrable on first run.

---

## 15. Build Phases

**Do not build ahead. Stop at the end of each phase for review.**

| Phase | Deliverable | Definition of done |
|---|---|---|
| **1** | Foundation | Schema, migrations, seed data, client CRUD, settings (rule sets, holidays), auth |
| **2** | Money in | Transaction entry + import, 2307 register, tax engine with **all §16 tests passing**, computation sheet |
| **3** | The point of the whole thing | Workflow engine, filing generation with correct deadlines, step board, document vault, dashboard |
| **4** | Compliance outputs | Cash Receipts Journal (only — see §9), SAWT module + reconciliation, exports, filing package zip |
| **5** | Deferred | Email integration, multi-user, .DAT generation — build nothing here without a new spec |

Phase 3 is the reason this system exists. If time is short, cut Phase 4 scope, not Phase 3.

---

## 16. Acceptance Tests

**Tax engine (Vitest, `/tests/tax/`) — these must pass before Phase 2 is accepted:**

1. Examples A–E from §6, exact to the centavo
2. ₱250,000 applied in full from Q1, not prorated per quarter
3. Mixed income: zero deduction, `formType == F1701`
4. Negative payable renders as overpayment, never negative tax due
5. Cumulative CWT never double-counts a certificate across periods
6. No Q4 `Filing` is ever generated
7. Prior-year carry-over credit appears in every cumulative period (Q1, Q2, Q3, ANNUAL) of the following year, not only the first — "once" means it is never double-counted against the same liability, not that it is applied in a single period
8. Rounding is stable across four cumulative periods (no float drift)

**Deadlines:**

9. A due date landing on a Sunday shifts to Monday
10. A due date landing on a seeded holiday shifts to the next working day
11. All computation is timezone-correct at 23:59 Asia/Manila on a due date

**Workflow:**

12. A filing with zero 2307s auto-marks steps 11–14 as `NA` and excludes them from progress %
13. A step with an empty required doc slot cannot be set `DONE`
14. `SEND_CLIENT_PACKAGE` blocks and names the specific missing document when any of steps 7/9/10/14 lacks its document
15. A step in `WAITING_EXTERNAL` for 2× its expected days appears in the dashboard red list
16. Editing a transaction in a filed period raises an `AmendmentAlert` and does **not** mutate `computationSnapshot`

**Documents:**

17. Upload writes to the exact §8 path and records SHA-256
18. Duplicate hash within a client triggers a warning, not a silent overwrite
19. Filing package zip contains every document plus a manifest listing empty slots

**Books & SAWT (Phase 4):**

20. `ALPHALIST_ENTRY` is blocked when cumulative CWT claimed on the filing disagrees with cumulative certificates batched through the period, naming the specific unbatched certificates responsible — not blocked, and not falsely blocked, when they agree
21. A Cash Receipts Journal's monthly subtotals sum to its grand total, and its grand total matches the sum of the underlying `SalesTransaction` rows for the period

**End-to-end:**

22. Seeded client with 2307s can be driven from step 1 to step 16 with all documents attached and finishes at `COMPLETE`

---

## 17. Assumptions Requiring Confirmation

The agent must surface these in the UI as configurable settings rather than baking them in, and must not silently pick a side.

1. **Revenue recognition basis.** Assumed *collection* basis, consistent with maintaining a Cash Receipts Journal. Recent legislation has shifted services toward recognition on billing. Provide a per-client `recognitionBasis` toggle (`COLLECTION` | `BILLING`); if `BILLING`, additionally track billed-but-uncollected amounts. Default `COLLECTION` for now.
2. **eAFS on quarterly filings.** Step 15 is included for all periods per my current practice, but is marked skippable per filing.
3. **SAWT deadline offset.** Defaulted to the return deadline; configurable.
4. **.DAT file generation.** Out of scope — the module's format is proprietary and version-sensitive, and a malformed file gets rejected by BIR. Worksheet-assisted manual entry only.
5. **ATC codes.** Seeded sparse and unverified. I must confirm each against the current BIR list before first live use.
6. All computed figures are **preparation aids**. The filed return and BIR's own assessment govern. Every computation sheet must carry that statement in the footer.

*(Formerly item 1, "Q1 1701Q due date," is resolved: May 15, per §3.6 — TaxRuleSet remains the source of truth, so it stays configurable, but it is no longer an open question.)*
