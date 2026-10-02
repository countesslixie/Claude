# CURRENT_STATE.md

*Living snapshot. Replace stale content rather than appending.*
*Last reconciled: 2026-10-03 — brief #6d (D155–D161), on top of brief #6c (D151–D154) and brief #6b (D143–D150) and brief #6a's documentation pass (D115–D142, checked at brief #5z's tip `e761a74`). **588 tests in 63 files pass, the build passes, and typecheck is clean once Next's route types exist** — see Known limitations for the one-line `LayoutProps` catch. Per-brief history lives in DECISIONS.md, not here.*

---

## Where the code is

**Working branch: `claude/serene-hypatia-rs67pw`.** Tip at the start of brief #6d: `548b5f1` (brief #6c), on top of brief #6b (`93f56c2`) and brief #6a's documentation-only commit (`b378c1e`) and brief #5z (`e761a74`). Briefs #5a through #5z and #6a all landed on this one branch — no new branch since it was cut for brief #5a.

Standing rules:
- `git fetch origin <branch>` first, every pass; a local checkout has been behind the remote more than once (briefs #5g, #5n).
- If a brief's account of the tree disagrees with `git log`/`git merge-base`, trust the tree and say so.
- End every summary by stating the branch worked on, whether it is new, and what it was cut from.
- `npm install` writes an `allowScripts` block into `package.json` (machine-local; she stashes before switching branches) and now also regenerates the Prisma Client (D57).

---

## What this application is

**A filing manager, not an accounting system.** Four layers, with a strict rule about who authors what:

| Layer | Authored? | Role |
|---|---|---|
| Income record | Yes | The client's declared gross sales per quarter — the sum of per-payor rows, derived, never typed directly (D33; called "Payor" on screen since D48 — the underlying `QuarterlySalesCustomer` model and `customerName` field keep their original names, deliberately). The only place money enters. |
| Computation | **Never** | Pure derivation. 8% cumulative. |
| Checklist | Marks only | A map of where you are. Blocks only on documents received from outside (D27). |
| Document archive | Yes | For a declared-income client, substantially the whole substantive record. |

All four share one key: client × taxable year × period.

**Trello's legibility, none of its flexibility.** The cycle is identical every quarter for every client. No card creation, no custom steps, no drag-to-reorder, no board configuration.

---

## How each group works today

The sixteen steps sit in six groups (D70) — a fixed lookup in `lib/workflow/groups.ts`, not `category`. Step numbers are never renumbered to make groups contiguous; a filing sitting at BIR Confirmations after every other group is done is normal. A group has no "Mark done" of its own (D62): its header shows a grey Pending label (tooltip names the open steps), a green Done pill, or — when every step in it is NA — a grey Not applicable pill.

### The sixteen steps

| # | Step (title as built) | Group | Controls on the card | Unlocks when | Completes how | Auto-waits on BIR | NA when |
|---|---|---|---|---|---|---|---|
| 1 | Record quarterly sales | Prepare | None (link to the income page) | Always | Derived: a final Save of the quarter's sales (D33) | No (waits on Client, 10 days) | Never |
| 2 | Receive Form 2307 from client | Prepare | Add certificate (one form, D131: payor name · payor address · TIN + ATC code · income + tax withheld · period from + to · scan — no Rate field, D132, and no scan date, D122); "all received" checkbox; Skip (with reason) only while there are no rows | Always | Derived: "all received" ticked and every certificate has its scan (D35) | No (waits on Client, 5 days) | Never (it can be Skipped, D60) |
| 3 | Prepare computation + 1701Q/1701A | Prepare | Mark done only (D54). The sheet shows form lines and figures only — no explanation column, no "Show explanations" (D133) — headed "Computation sheet (Filed)" once filed (D121); item 61's heading is plain, with no pre-fill note (D133) | Steps 1 Done and 2 Done/Skipped | Mark done (also files the computation sheet HTML) | No | Never |
| 4 | Advise client of tax payable | Prepare | Mark done only; no Start, no Skip (D98) | Step 3 Done (D51) | Mark done (saves the message as sent; the card then reads "Advised on [date] · …", D118). The message opens "Hi [first name],", prints the year-to-date summary shared with step 16 (D114), and the payable version just asks when she plans to pay — no advance offer (D107) | No | Never |
| 5 | File return via eBIRForms | File | Mark done only (D65) | Two locks, both refused server-side and shown as the greyed button's tooltip: all of Prepare resolved (D100 — "Finish Prepare first.", shown first when both apply) and every earlier return of the year filed (D95 — "File Q1 2026 first."). There is no election check (D136) | Mark done — freezes the computation and sets `filedAt` (D83) | — (it starts step 10's wait) | Never |
| 6 | Save submission-page screenshot | File | Upload box only, no date field (D67/D119) | Step 5 Done | Self, on upload | No | Never |
| 7 | Download and save filed form | File | Upload box only | Step 5 Done | Self, on upload | No | Never |
| 8 | Make payment | Pay | Amount / date / paid-through form (D75); no Start, no Skip | Steps 5, 6, 7 all Done | The form's save marks it Done | No | Nothing to pay: overpayment or exactly ₱0 (D76) |
| 9 | Save proof of payment | Pay | Upload box only | Step 8 Done | Self, on upload | No | Nothing to pay (with 8) |
| 10 | Save TRRC email (D90) | BIR Confirmations | Upload box only | Step 5 Done | Self, on upload | **Yes**, from step 5 Done (D68); 3 days | Never |
| 11 | Alphalist data entry + validation | eAFS | Two upload boxes (report, DAT); no Start/Mark done/Skip (D86) | Steps 5–7 Done and Pay Done or NA (D85) | Self, when **both** files are present | No | No Form 2307 on the filing (D93) |
| 12 | Email DAT file to BIR eSubmission | eAFS | Mark done only, with the email draft (D87) | Step 11 Done | Mark done (saves the draft; the card collapses to "Emailed on [date] — …", D125) | No | No Form 2307 |
| 13 | Save SAWT acknowledgement email (D96) | eAFS | Upload box only (D88) | Step 12 Done | Self, on upload | **Yes**, from step 12 Done (3 days) | No Form 2307 |
| 14 | Save SAWT validation email (D96) | BIR Confirmations | Upload box only (D71) | Step 13 Done | Self, on upload | **Yes**, from step 13 Done (10 days) | No Form 2307 |
| 15 | Complete and submit eAFS | eAFS | Mark done only; no slot (D89) | Steps 5–7 Done and Pay Done or NA (D85) | Mark done | No | No Form 2307 |
| 16 | Email package to client | Client package | Mark done only; no Start, no Skip (D101) | Steps 7, 9, 10 and 13 each saved or NA — not step 14 (D109). While locked the card says "Available once the TRRC is saved." — only what is still missing, in step order (D113) | Mark done — saves the email exactly as shown; the card then collapses to "Emailed on [date]: [subject]" with Show email (D101/D125); a new subject ends "filed on [date]" | No | Never |

Upload boxes carry no date field, and a saved file's line shows no date: the day of upload (Manila) is recorded automatically (D119). This table is the single copy; PROJECT_MASTER.md refers to it.

### Prepare (steps 1–4)
Income is the client's declared figure per quarter, entered as per-payor rows on `/clients/[id]/income` (D26/D33); draft vs. final, Edit/Cancel, a final quarter reverts to open if re-saved as a draft (D40). A certificate contributes credit only, never income (D26); it needs its scan to be saved, payor TIN/address/ATC required, ATC chosen from a maintained picker whose code carries the rate — there is no Rate field (D43–D46, D132) — and the form has no scan date, the upload day being recorded (D122), laid out in the rows of D131; a saved-payors list feeds steps 1 and 2 with no foreign key (D44/D48). Step 2's Add/Remove are hidden while "all received" is ticked (D47). Step 3 shows the credits box (item 55 read-only, item 61 editable, D55) above the computation sheet (D49 whole-peso, form-line; figures only, D133). Step 4's message comes in three versions and is saved as sent (D51). A skipped step stays visible in place with an Undo skip (D60). Prepare closes itself once all four resolve.

### File (steps 5–7)
Step 5 filing freezes the return's computation and starts the TRRC wait. Steps 6 and 7 self-complete on upload; a new upload replaces the old (soft-deleted, D46). No Start/Skip anywhere in File (D65). The header names only what is actually outstanding (D69).

### Pay (steps 8–9)
Opens only once all of File is Done. Step 8's amount defaults to the return's payable (read from the frozen sheet) and can be edited until the next return of the year is filed (`isPaymentLocked`, D75/D94); the saved amount is what later returns read as item 56/58. Step 9 never enters a waiting state (its header says "waiting on proof of payment"). An overpayment or ₱0-payable return sets both NA the moment step 5 is Done; the header then shows a grey "Not applicable" pill (never a green Done) beside "Nothing to pay" or "Nothing to pay — overpayment ₱X" (D76/D81/D135).

### eAFS (steps 11, 12, 13, 15)
Applies only when a Form 2307 is saved on the filing (D93): otherwise 11–15 are all NA. The header then reads a grey "Pending" ("Depends on Form 2307s (step 2)") while step 2 is open, and a grey "Not applicable" with "No Form 2307" once step 2 is Done or Skipped — never green, no counter, nothing to expand (D91/D134; `lib/workflow/eafsHeader.ts`). The NA state follows the live certificate list until step 5, then is fixed (`recomputeRequiresSawt`). Locked ("Available once Pay is done.") until File and Pay are Done, enforced server-side (D85). Step 12's draft (to = `TaxRuleSet.eSubmissionEmail`; subject `SAWT {form} {MMDDYYYY} {NAME} {12-digit TIN}`; body Name/TIN/RDO/Period) is saved on the filing when Mark done is clicked and the card collapses to "Emailed on [date] — …" (D87/D125). A missing RDO shows one muted line and never blocks. Step 15 has no document at all (D89).

### BIR Confirmations (steps 10, 14)
Both wait on BIR automatically from the moment their gating step is Done and complete on upload; removing the only file returns them to waiting with the clock reset to the gating step's `completedAt` (D68/D71). One "Waiting on BIR · N days" pill (amber, red past twice the expected days, never green); no Log follow-up on any BIR wait (D72).

### Client package (step 16)
Built and walked (briefs #5r–#5t, D101–D103 and D106–D114). Step 16 is Mark done only and unlocks once the filed form, proof of payment, TRRC and SAWT acknowledgement email (steps 7, 9, 10, 13) are each saved or not applicable — the SAWT validation email (14) is never sent to the client, so she no longer waits on it (D109). While locked the card names only what is still missing (D113). Unlocked, it shows a copyable email — To, Subject, Body, each with Copy — and a **Download package** button (D101).

- **The package holds five kinds of document (D108):** the filed return (step 7), proof of payment (9), the TRRC (10), the SAWT acknowledgement email (13), and every Form 2307 scan. The submission screenshot, computation sheet, alphalist report/DAT and validation email stay out; a step that doesn't apply is simply absent. One source (`planPackageDocuments`, `lib/documents/filingPackage.ts`) feeds both the zip and the email's list.
- **The zip is flat, with standard names and no manifest (D103/D111):** "Rosario Garcia - 1701Q Q3 2026.zip" holding files like "Rosario Garcia - 1701Q Q3 2026 - Filed return.pdf", "… - TRRC.pdf", "… - Form 2307 - [Payor].pdf". Only the zip copy is renamed; stored documents keep their names.
- **The email:** opens "Hi [first name],", says the return has been filed, lists the attached documents **by name, never file names** (D110), then the **summary** — the same year-to-date lines step 4 prints (`buildSummaryLines`, D114), read from the frozen sheet so they reconcile to the last line: gross sales this quarter, taxable income and tax due year to date, each "Less:" credit (zero lines left out), a rounding line only when needed, and **Amount payable** or **Overpayment**. Then "Next filing: [form] for [period], due [date]. **Please send required documents by [date].**" — that date is the engagement-letter rule, the 20th of the month after the period ends (D106; Jan 20 for the Annual) — then "Please keep this for your records." and "Thank you!" (D112). A client with no email shows one muted line and never blocks.
- **Mark done saves the exact email** on the filing (`Filing.clientPackageEmail…`) and the card collapses to "Emailed on [date]: [subject]" (D125). A step 16 done before this existed reads "Done on [date]" with nothing invented.
- The filing page's old top-of-card "Download period package" link is gone (D114's note); its route stays for step 16's button.

### The client form and the Clients list (D143–D150, brief #6b)
The New/Edit client form (one component, `components/client-form.tsx`) reads: Registration — TIN · Branch code · RDO code; Registered name; Trade name; Registered address; Birthday · Client code; Email · Mobile phone number — then Tax profile (Line of business · PSIC code) and a Status section (Engaged since, Active, Notes — kept because Engaged since drives D78). Birthday is required on New and Edit (`Client.birthDate`, nullable in the database; existing clients must have one entered before Edit saves) and shows on the client page as "January 5, 1990". On New client the Client code fills in from the name — last word + "-" + first word ("Maria Santos Reyes" → reyes-maria) — until she types in the box; Edit never auto-fills. Cancel (bordered) saves nothing: New → Clients list, Edit → the client's page. Taxpayer type, recognition basis, civil status, default WHT rate and the books fields are off the form but their columns stay; a new client is saved purely self-employed / collection / manual books, and Edit leaves those values as stored. A new client has no default WHT rate, and its step 2 now starts open like every other client's (D152) — it used to be generated Skipped. The Clients list shows Code · Registered name · TIN · RDO · Status, all centred.

### The client page (D154, brief #6c)
After the header row (name, Active pill, Back to list · Income · Form 2307s · Payors · Edit — unchanged), two same-height cards side by side, stacked on a narrow window (`components/client-details-cards.tsx`): **Registration** (TIN · Branch code · RDO code; Trade name; Registered address; Birthday · Client code) and **Contact & business** (Email · Mobile phone number; Line of business · PSIC code; Engaged since · Notes). Then Taxable years and Filings, unchanged. No Books & compliance card and no taxpayer type, civil status, default WHT rate or revenue recognition (columns kept). Full-month dates, a muted "—" for empty values, TIN and client code monospace. Engaged since, Active and Notes stay at the bottom of the form (D151).

### The client's Income, Form 2307s and Payors pages (D158–D161, brief #6d)
No grey instructional text on any of the three. **Income** (client page button) is a view-only table — Previous quarters (one row, from the starting figures, when they name an outside return) · one row per in-app quarter with a status (Not yet entered, Draft, Saved, Filed) · Total — every column centred, nothing clickable; its total and the Form 2307 page's certificates-vs-sales check come from one function, so they agree (Gloria Tolentino's ₱300,000 was only her Q3; with her ₱300,000 of earlier quarters it is ₱600,000 on both). Step 1's "Go to income entry" opens the unchanged entry screen (`?filingId=`), whose "Other quarters" table now shows one "Previous quarters" row. **Form 2307 register:** Year filter only (opens on the current year), Download all (zip of current scans), no Keying worksheet button, columns PERIOD · PAYOR · ATC · INCOME PAYMENT · TAX WITHHELD · RATE · STATUS · SCAN centred and in chronological order. **Payors:** Add payor button opens the form above the table; Save or Cancel closes it. A Complete filing also shows no Copy buttons (D156), and a skipped step 2 reads "No Form 2307 received from this client." (D157). The client page's two cards are 50/50 and the page no longer scrolls sideways (D155).

### A Complete filing is locked (D153, brief #6c)
A filing whose status is Complete shows no control that changes anything (no Undo skip, Skip, Mark done, upload/Replace/Remove, Add certificate, "all received" tick, payment or item 61 edit, "Go to income entry"), and the server refuses every such action with "This filing is complete and locked." No Unlock. Opening documents, Show/Hide, Collapse/Expand and the links still work. The amber amendment alert's Dismiss stays. In the sample data the Complete filings are **Villamor Q1 and Q2** (Rosario Garcia's Q3 is Waiting on BIR with step 16 unsent until the TRRC is saved).

### Cross-cutting rules
- **Step 2 starts open (D152):** generation never leaves it Skipped; Waiting on client until she adds certificates or clicks Skip. Existing filings were not backfilled; a fresh reseed differs only for the no-rate samples whose seed doesn't skip step 2 by hand (Villamor's Q3, the Annuals of Villamor and Garcia).
- **Reopening (D50/D61).** While a filing is unfiled, a figures-changing final save of step 1, a draft save of a previously-final step 1, adding/removing a certificate, a saved item 61, a saved starting-figures change, or a saved payment reopens steps 3 and 4 (`reopenPreparedFiling`); the same step-1 saves un-skip a Skipped step 2, and undoing step 2's skip reopens too. A filed filing is never reopened.
- **Frozen returns and amendment alerts (D83/D94).** Step 5 Done writes the full computation to `Filing.computationSnapshot` (and `filedAt`) in the same transaction, never rewritten; every reader of a filing's own figures goes through `getFilingSheet`. After any change that could feed a filed return, `checkAndRecordAmendments` raises an `AmendmentAlert` shown as one amber block with per-item old → new and a Dismiss (informational, D11). Later returns still read real data. The locks that keep this rare are kept on purpose (D94): payment until the next return is filed, certificates and item 61 at their own filing, starting figures once the first in-app return is filed.
- **Next (D84).** `nextActionForFiling` (`lib/workflow/groups.ts`): the first open step in group order that is her work — skipping locked steps and steps waiting on BIR; when only BIR waits remain, "Next: waiting on BIR — TRRC, 3 days" with no button. Shared by the filing page banner, the slim bar and the dashboard. The banner never offers a control the step's own card lacks (D77).
- **Headers and columns (D73/D116/D124).** Each group's header text is its own dedicated function, naming only steps actually waiting, with fixed plain names. Every header is two fixed columns — the status pill, then Expand/Collapse — shared with the tax payable line so the pills line up down the page (`components/status-columns.ts`). The counter counts Done + Skipped, excludes NA, is hidden when every step is NA, and never prints a skipped count (D60/D81/D124); the filing status reads "Complete", not "Complete (N steps skipped)". A grey "Not applicable" pill marks an all-NA Pay or eAFS (D134/D135, `lib/workflow/naGroupHeader.ts`).
- **Days are spelled out (D117).** "0 days", "1 day", "N days" everywhere — pills, group text, the Next banner, the slim bar, board tags, the dashboard — from one helper, `lib/formatDays.ts`.
- **The filing page header (D115/D123).** No status pill beside the title (it stays on the tax payable line); the subtitle reads "1701Q - due November 16, 2026"; the card heading is "Steps"; the statutory-date and documents-due paragraphs sit under a small "Filing details" link at the bottom. Screens say "1701Q", never "F1701Q" (D118).
- **The Kanban (D70/D79/D138/D139/D141).** The board at `/filings`, headed "Kanban": six group columns, no Complete column and no filter bar; an empty column says "Nothing here." A card sits in its earliest incomplete group, is the same fixed height, and appears only once its period has ended (Q1 from April 1, Q2 July 1, Q3 October 1, the Annual January 1 of the next year). Outside BIR Confirmations a card shows each BIR wait as plain grey text at the bottom right ("TRRC · 2 days", "SAWT validation · 8 days"); inside it the wait line turns red past twice the expected days. The board fills the window: columns scroll up and down inside themselves and the sideways scroll bar sits on the window's bottom edge. Filed-outside-the-app quarters have no `Filing` row and never appear; finished filings stay on the client's page.
- **The dashboard (D74/D84/D126–D130/D137).** Four collapsible sections in one centred layout: Needs my action now · Waiting on client · Waiting on BIR (every step 10/13/14 waiting, independently) · 3M Threshold Alert. Each is open when it has entries and closed when empty; every table is Client · Period · Step · Due · Aging, sorted by due date then client. A client wait's Due is the documents-due-from-client date, and a filing appears under Waiting on client only once its period has ended (D130). The threshold section lists a client at 80% or more of the ₱3,000,000 threshold (starting income included, D56) and says BREACHED at 100% or more. Upcoming deadlines, Missing documents and the election rows are gone, and there is no Log follow-up (D128).
- **The status pill (D97).** "In progress" while any of her own work remains — even when a TRRC or SAWT wait is also running; "Waiting on BIR" only when Next would read "waiting on BIR". Stored on `Filing.status`; every step action recomputes it.
- **The client bar (D104).** `components/client-sticky-bar.tsx` on the client page and its Income, Form 2307s and Payors pages: once the page header scrolls away, a bar beside the menu shows the client's name (a link), TIN and buttons for those three pages. The filing page keeps its own slim bar; they never appear together.
- **The working calendar (D106).** The filing page's "documents due from client" is the client's deadline from her engagement letter — the 20th of the month after the period ends (Q1 Apr 20, Q2 Jul 20, Q3 Oct 20, Annual Jan 20) — set by `TaxRuleSet.clientDocsDueDay`, no weekend shift, stored in `Filing.certificatesExpectedBy`. It starts step 2's waiting clock and feeds the dashboard's step 2 dates and step 16's email. `internalFilingTarget` (her own filing target) is separate and unchanged.
- **No internal references on screen (D105)** — no brief or decision numbers, "SPEC.md" or "Phase" labels; the Settings hub lists only Backup under "Not built yet".
- **The menu (D58/D140).** Dashboard · Work (Kanban, Clients) · Settings (Tax Rules, ATC, Holidays); page headings match ("Kanban", "Tax Rules", "ATC"); URLs and form field labels ("ATC code") are unchanged.
- **8% only (D136/D142).** Every client and tax year is 8% elected, flat rate: no election is recorded or checked, no step is locked for it, and the tax year form and Taxable years table have no election or Regime (the Regime column stays in the database, written `RATE_8_PERCENT`; `electionStatus` defaults to `ELECTED`). The year-end credit election (refund / TCC / carry over) is a different thing and stays.
- **Upload dates (D119/D122).** No date field on any upload box or on the certificate form; `uploadDocument` and `addCertificate` record today (Manila). The date still appears in a stored file name (YYYYMMDD), and the seed back-dates through the server-side parameter.
- **The slim bar (D80).** Fixed beside the menu once the page header scrolls out; client and period, Next, Go to step (which expands the group and scrolls, `components/go-to-step.tsx`).
- **The mid-year guard (D78).** Generate filings refuses for a client whose `engagedSince` is inside the year after January 1, with a quarter already over, and no starting figures saved; message names the client, date and quarters and links to the screen. Any saved row, including "none", satisfies it.
- **Starting figures and credits (D55/D56/D75).** Starting figures hold the outside return's figures; an outside period gets no `Filing`. Item 61 is one figure per return, inheriting forward; item 55 is display-only, entered in the starting figures; item 56/58 is the sum of earlier in-app returns' `amountPaidCents` plus the starting figures' base.
- **Upload limit (D64).** 25 MB (`next.config.ts`); every upload control checks size first and shows a plain message.

**Validated against reality.** A real client's filed Q1 2026 return reproduces to the form's own whole-peso figures in `tests/tax/realFilingQ1_2026.test.ts` (D42/D49), which runs with every suite and carries no identifying data. Client-side screens (dialogs, the menu, colour) are verified by live walkthrough, not by the suite.

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

**Ninth — 2026-09-27, walked brief #5a's new payor list (produced brief #5b).** Found: saving a new payor from step 1 captured the name only, so TIN/address/ATC still had to be typed on the first certificate; a payor saved with no TIN or address would then hit step 2's required fields with nothing to autofill; and "Customers / payors" as a label didn't match how she actually thinks of them — payors. Produced D48 and the on-screen rename.

**Tenth — 2026-09-27, walked steps 3 and 4 of the Prepare group for the first time (produced brief #5d).** Found: the app's computation disagreed with her own filed Q1 return at the centavo level (₱6,634.71 vs. the form's ₱6,635.00). Produced D49 — the computation sheet now follows the BIR form's own line items and whole-peso rounding.

**Eleventh — 2026-09-27, walked brief #5d's result (produced brief #5e).** Found: step 4 could be marked done with no computation behind it if step 3 was still open; the "waiting on …" label read wrong beside several already-Done steps; a disabled group "Mark done" still looked like a pressable button. Produced D50 (first version, later refined), D51 (step 4's gate), D52, D53.

**Twelfth — 2026-09-27, walked brief #5e's result, plus a design conversation about the mid-year go-live (produced brief #5f).** Found: unticking "all certificates received" alone shouldn't reopen steps 3/4 (#5d/#5e's rule was too eager); item 61 needed to vary return by return, not once a year; step 3 shouldn't be skippable at all. Separately, in conversation: every current client's Q1/Q2 2026 was filed from Excel, so at go-live every client would join the app mid-year with no way to enter that history. Produced D50's refinement, D54, D55's rework, and D56 (starting figures) plus D57.

**Thirteenth — 2026-09-28, walked brief #5f's result (produced part of the ask behind brief #5g).** Found: item 63 (1701Q) showed a plain positive figure for an overpayment, identical in appearance to tax payable, despite the sheet's own heading already correctly saying "Overpayment." Produced D59, alongside the separately-requested visual pass (D58) — she wanted her other app's look carried over now, before the Pay group's screens are built.

**Fourteenth — 2026-09-28, walked brief #5g's new look.** Found: the `--faint` grey text is fine as is (read and confirmed, not a defect); the left menu's "SETTINGS" heading shows a text-colour change on hover but no background highlight, unlike an ordinary nav link. Neither produced a follow-up brief by itself — recorded here, and under "Outstanding smaller items" below, for whenever the Settings area is touched next.

**Fifteenth — 2026-09-28, walked the Prepare group after brief #5h (produced brief #5i).** Found: a skipped step 2 vanished from the group entirely, indistinguishable from an `NA` step; editing the income afterward didn't bring it back; the Prepare group's "Mark done" was still clickable with step 3 genuinely pending; "3 of 4 · Done" hid the fact that one of the four was skipped, not actually done; and the raw `IN_PROGRESS`/`PENDING` enum values rendered as pills instead of words. Produced D60–D63.

**Sixteenth — 2026-09-28, walked brief #5i's result.** Confirmed: a skipped step 2 stays in place with an Undo skip button and its reason; editing the income put step 2 back to "Waiting on client" and steps 3/4 back to Pending; no group anywhere has a "Mark done" button; the counter reads "4 of 4 · 1 skipped · Done" once finished with one skip; step 4 was confirmed to never have had a Skip control in the first place. **The Prepare group is closed** — steps 1 through 4 have now been walked and fixed across briefs #4c-#4e, #5a, #5d-#5f, #5g's look, and #5i's finish.

**Seventeenth — 2026-09-28, walked the File group for the first time (produced brief #5k).** Found: uploading a real-sized file on step 6 crashed the page with Next's own 1 MB Server Action error overlay; steps 5, 6, 7 and 10 offered Start and Skip that did nothing useful (a fixed document sequence, not a set of decision points); steps 6, 7 and 10 each hid their upload box behind an Attach link, could be worked on before the return was even filed, and still needed a separate Mark done after the file landed — three clicks around a fact (the file existing) that already settled the step; step 5's title still said "File return via eBIRForms/eFPS," and she doesn't use eFPS. Produced D64 (the upload-limit fix), D65 (no Start/Skip on 5-7/10), D66 (step 5's rename), D67 (6/7/10 unlock-and-self-complete). **Correction: this pass's own summary called the File group "closed" — it wasn't yet.** Her very next walkthrough (eighteenth, below) found two more things, both about step 10 specifically, that this pass hadn't touched.

**Eighteenth — 2026-09-29, walked brief #5k's result (produced brief #5l).** Found: step 10's own Mark waiting meant the BIR aging clock never started until she remembered to click it — the exact open question brief #5k raised and left unbuilt, and she said yes to fixing it; and the File group's own header read "waiting on submission-page screenshot, filed form pdf, trrc email/pdf" before step 5 was even done, wrong twice over (those steps are locked, not waiting, and the text was lowercased doc-slot labels, not words she'd use). Produced D68 (step 10 waits on BIR automatically, no manual control left) and D69 (the File group's own fixed-name summary line). **The File group is now actually closed** — steps 5 through 10 walked, fixed, and confirmed across both this pass and #5k.

**Nineteenth — 2026-09-29, the File-group discussion and her first Pay walkthrough (produced brief #5m).** Found: the TRRC (step 10) and the SAWT validation (step 14) are things she only waits to receive, and nothing depends on either — inside File and SAWT they made finished work look unfinished. That produced the BIR Confirmations group; step 15 moved into the SAWT steps' group, which she named "eAFS"; step 16 got its own group, "Client package." On Pay: she pays the client's tax herself and receives the proof by email, often days later, so steps 8 and 9 stay separate; the full amount is always paid; Pay should open only after File; the amount should default to the payable; and an overpayment quarter should need no payment steps at all. There is no Log follow-up on BIR waits ("you can't follow up with BIR regarding this one"). Fixes asked for: one pill instead of three on a waiting step; Pay's header read "waiting on payment confirmation" before the return was even filed; the Next banner offered Mark done on step 1 and Start on step 8. Produced D70–D77.

**Twentieth — 2026-09-29, walked brief #5m's result (produced brief #5n).** Found: "Generate" for a client engaged July 1 with no starting figures silently created Q1 and Q2 as overdue work (the app was behaving by D56's rules — only starting figures name an outside quarter — but nothing told her); a filed-and-paid filing with eAFS work open sat in the eAFS column with nothing showing its TRRC was still waiting; scrolling down the filing page lost track of which client she was in; Pay read "0 of 0 · Done · Nothing to pay" with the text in amber; and the database mixed sample clients, hand-made walkthrough clients and half-worked overdue Q1/Q2 filings ("Blocked" cards in odd columns), so she couldn't tell a real problem from leftovers. Also, a walkthrough number (Rosario Garcia's Q3 overpayment, ₱8,600 instead of ₱8,200) needed settling. Produced D78-D82.

**Verified live for brief #5n, on a freshly reseeded database** (dev server, Chromium, 1280px wide): client C's Generate refused with the plain message and a working link; saving starting figures ("none") let it run and create all four; scenario D's card sits in eAFS with "TRRC · 2d", the slim bar appears on scroll with client, period and next step, "Go to step" expanded the collapsed BIR Confirmations group and landed below the bar (step top at 80px, bar ends at 37px), and the bar is gone again at the top; scenario E reads "Nothing to pay — overpayment ₱8,200.00" in grey, no counter; scenario G's card sits in BIR Confirmations with its wait line red; no horizontal scroll at 1280, 1024, 800 or 600px.

**Twenty-first — 2026-09-29, her check of brief #5n and her first walkthrough of the eAFS group (produced brief #5o).** Confirmed: the mid-year guard stopped Benedicto Lacson with the message and link; the slim bar and "Go to step" worked; Rosario Garcia Q3 read "Nothing to pay — overpayment ₱8,200.00" in grey; the board placed the sample cards with their TRRC tags as designed. eAFS findings: step 11 still had Start, Mark done and Skip and hid its uploads behind Attach; step 12 should be Mark done only and show the eSubmission email (she supplied the format from a real sent email; no real data was copied anywhere); step 13 should wait on BIR by itself; step 15 needs no attachment; the whole eAFS group should be not applicable when no Form 2307 is saved; eAFS should open only after Pay; step 10 was renamed "Save TRRC email" and step 14 "Save eAFS validation email"; the Next bar should point to her work, not BIR's. Separately, brief #5n had found that filed returns were never actually frozen. Produced D83–D93.

**Twenty-second — 2026-09-29, her check of brief #5o.** Everything worked. Corazon Mendoza Q3: the Next bar pointed to step 11; both step 11 uploads completed it; step 12 showed To/Subject/Body and collapsed to "Emailed … Show email" once done; step 13 went to "Waiting on BIR · 0d" by itself; step 15 was Mark done only. Rosario Garcia Q3: eAFS read "Not applicable — no Form 2307", and Next read "waiting on BIR — TRRC, 3d" with no button. Felipe Ocampo Q3: eAFS read "Available once Pay is done", and Next pointed to step 6. Gloria Tolentino: Next read "waiting on BIR — TRRC, 8d · eAFS validation, 3d", with TRRC's pill red. The eSubmission address sits on the tax rule set screen. (Screens as they read at the time — "eAFS validation" was D92's wording; D96 renamed it back to "SAWT validation" in brief #5q.) The Prepare, File, Pay, eAFS and BIR Confirmations groups are now all walked and closed; only Client package (step 16) remains. Afterwards she renamed steps 13 and 14 to "Save SAWT acknowledgement email" and "Save SAWT validation email" (D96), decided to keep the payment lock (D94) and agreed a filing-order guard (D95). Produced D94–D96 and the documentation pass (brief #5p).

**Twenty-third — 2026-09-30, her check of brief #5q and her first walk of the Client package group.** Brief #5q worked. In the walk she found: step 5's Mark done live on Ernesto Villamor's Q3 with Prepare still pending; Start and Skip on step 16; a client email whose summary did not add up on Rosario Garcia's Q3, that listed 2307 certificates for a client with none, and that read "1701Q for ANNUAL"; a zip with step-code folders and a manifest she did not want; no way to tell which client she was in once she scrolled; a Form 2307 register that opened on Q1 and looked empty; internal references (brief numbers, D-numbers, SPEC.md) on screen; and the board's Client package column cut off at her laptop width. Produced D100–D105 (brief #5r).

**Twenty-fourth — 2026-09-30, her checks of briefs #5r–#5t.** Confirmed: the board scrolls sideways; step 5 is greyed out with "Finish Prepare first." on a filing whose Prepare is open; the sticky client bar appears on the client page and its Income, Form 2307s and Payors pages; the Form 2307 register on All periods shows plain labels ("Recorded"); Settings lists only Backup under not built; Rosario Garcia's email adds up to the ₱8,200 overpayment line by line and asks for documents by Jan 20, 2027; the zip is flat with standard names; step 16 collapses to "Emailed …" once done; step 4 shows the year-to-date lines. Her review also produced: the engagement-letter document deadline, the 20th of the month after each period (D106, which replaced the Feb 15 date brief #5r had built); no advance offer in step 4's payable message (D107); the package narrowed to five kinds of document (D108); step 16 unlocking on step 13 instead of 14 (D109); then, in brief #5t, names-only attachment list, standard zip file names, the "Hi …/Thank you!" wording, the lock message naming only what's missing, and one shared summary for steps 4 and 16 (D110–D114). **All six groups — Prepare, File, Pay, eAFS, BIR Confirmations and Client package — are now walked and closed.**

**Twenty-fifth — 2026-10-01, the look pass on the filing page (brief #5v).** Her list: no status pill beside the title and a plainer subtitle; status pills and Expand/Collapse in two fixed columns that line up with the tax payable line; day counts spelled out; "1701Q" not "F1701Q", and "Advised on …" on step 4; no date box on upload boxes; "Choose File" as a real button. Produced D115–D120.

**Twenty-sixth — 2026-10-01, filing page extras and the dashboard (brief #5w).** Her list: "Computation sheet (Filed)"; no scan date on the certificate form; full month names in the subtitle; "Complete" with no skipped count; "Emailed on …"; a four-section dashboard in one centred layout with no Log follow-up, sorted by due date. Her question about a client wait's Due date was investigated rather than patched: it was step-clock arithmetic (Oct 10 for a filing generated Oct 1), not a deadline, and a filing was listed before its period had ended — fixed at the root (D130). Produced D121–D130.

**Twenty-seventh — 2026-10-01, steps 2 and 3 and the eAFS state (brief #5x).** Her list: the certificate form re-laid out in rows; no Rate field (the ATC code carries it); item 61's plain heading and no "Show explanations"; eAFS reading Pending until step 2 is settled, then a grey Not applicable. Produced D131–D134.

**Twenty-eighth — 2026-10-02, the board, the dashboard and 8% by default (brief #5y).** Her list: Pay's Not applicable pill in grey; no election anywhere, because this app only does 8% — which also removed a lock that had stopped every step of a Q1 filing, not just step 5; the dashboard trimmed to four sections with "3M Threshold Alert"; the board with no filter bar and no Complete column, fixed-height cards, grey tags, and cards appearing only once the period has ended. Produced D135–D139.

**Twenty-ninth — 2026-10-02, menu, Kanban scroll and Regime (brief #5z).** Her list: the menu reading Dashboard · Kanban · Clients · Tax Rules · ATC · Holidays with matching headings; the Kanban's scroll bar at the bottom of the window; no Regime column or field. Produced D140–D142. **She then checked briefs #5v–#5z live and confirmed all of them ("All good with the checks").** The Tax Rules, ATC and Holidays pages themselves have not yet been walked.

---

## Sample data

The seed (D82) builds eight fictitious clients, all TY2026, each with its scenario in the client's Notes. Built through the app's own actions, so seeded filed returns carry **real snapshots** (D83). Ages (`waitingSince`) are relative to seed time and drift.

| Client (code) | Scenario | Where it sits | What she should see |
|---|---|---|---|
| **A** Ernesto Villamor (`villamor-e`) | Full-year, no withholding. Q1 and Q2 filed, paid, complete; Q3 not started | Prepare (Q3). Q1 and Q2 are Complete and appear only on the client page | Clean Prepare walk on Q3; item 56 = ₱36,000 (Q1+Q2 payments, ₱12,000 + ₱24,000). eAFS is not applicable |
| **B** Analiza Pangilinan (`pangilinan-a`) | Joined July 1, starting figures Q2; Q3 and Annual only | Prepare | Q1/Q2 absent; Q3 untouched ("waiting on quarterly sales and Form 2307") |
| **C** Benedicto Lacson (`lacson-b`) | Joined July 1, **no** starting figures, no filings (tax year row exists) | Nowhere on the board — client page → Generate | The D78 guard message with a link; saving starting figures lets Generate run (this creates real Q1/Q2 work). He is in the seed and the client list |
| **D** Corazon Mendoza (`mendoza-c`) | Q3 payable, filed and paid, proof saved, has a certificate; eAFS untouched | eAFS, "TRRC · 2 days" | The main eAFS walk: steps 11, 12, 13, 15 live; Next = step 11 |
| **E** Rosario Garcia (`garcia-r`) | Q3 overpayment ₱8,200.00, filed, no certificates (step 2 skipped); Q1/Q2 outside the app | BIR Confirmations (status "Waiting on BIR") | Pay: grey "Not applicable" with "Nothing to pay — overpayment ₱8,200.00"; eAFS: grey "Not applicable" with "No Form 2307"; step 16 open |
| **F** Felipe Ocampo (`ocampo-f`) | Q3 filed (step 5 done), steps 6/7 not saved; **has a certificate** | File, "TRRC · 1 day" | File mid-way; eAFS locked "Available once Pay is done."; Next = step 6 |
| **G** Gloria Tolentino (`tolentino-g`) | Q3: everything of hers done incl. eAFS (11, 12 with its saved draft, 13, 15); TRRC about 8 days, step 14 about 3 days | BIR Confirmations | Wait line red; Next reads "waiting on BIR" with no button |
| **H** Estrella Navarro (`navarro-e`) | The mixed-income sample (D49); starting figures Q3, so Annual only | Nowhere on the board until January 1, 2027 | Annual, Not started; no Form 1701 sheet exists |

Annual filings for A, B, D, E, F, G, H exist, Not started, due April 2027; the board hides them until January 1, 2027 and the dashboard's Waiting on client does too (D130/D139), so they show only on the client page. **A Q3 card appears on the board only from October 1, 2026** (D139): on a database seeded earlier, the board is empty until then. Q3 is dated by the seed run, so the app doesn't check that the quarter has ended. Step 16 stays open on D, E, F and G because its package needs the TRRC. Waiting-on-client agings and BIR wait days are relative to the seed run and drift.

**Reseeding.** `npx prisma migrate reset --force` (drops the database, re-applies migrations, runs the seed; Prisma refuses to run it under an AI agent without her consent, so Claude runs the equivalent: delete `data/app.db`, `npx prisma migrate deploy`, `npx tsx prisma/seed.ts`). The plain `npx tsx prisma/seed.ts` upserts reference data and builds the samples only when none exist; it never deletes.

---

## Not built

- **Carry-over of a client's own Annual overpayment into next year's starting figures** (D55) — first matters at the 2026→2027 boundary.
- **The document archive browse view** — client → year, with a whole-year zip. The only genuinely new build in the backlog, and it serves what she named as the most important thing the app does.
- **A calendar view.**
- **Backup** — listed on the Settings page as not built; see Next.
- **A clean-start routine** that wipes sample and test data but keeps reference data — see Next.
- **Phase 5, deferred by decision:** email/IMAP integration, multi-user, .DAT generation, importers. (The SAWT keying worksheet and its XLSX export are built — `lib/sawt/`.)

---

## Needs the bookkeeper's review

1. **ATC codes** — only WI010 and WI011 seeded, both `verifiedAgainstIssuance: false`. Confirm at `/settings/atc-codes` (D43) before live use. **Each code now also carries the rate a certificate uses (D132) — there is no Rate field on the certificate form any more — so an unverified rate flows straight into the certificate register and the SAWT worksheet.**
2. **SAWT keying worksheet field order** — built, not yet checked against the actual Alphalist Data Entry Module.
3. **The eSubmission address `esubmission@bir.gov.ph`** (`TaxRuleSet.eSubmissionEmail`, editable on the tax rule set screen) — confirm against BIR before live use (D87/D19).
4. **Which clients are certificate clients and which declare only** — now also decides whether a filing has an eAFS group at all (D93).

---

## Open questions

- **Revenue recognition basis** — assumed collection; recent legislation has shifted services toward recognition on billing. A per-client toggle was proposed, not built. It still determines which quarter a peso lands in.
- **SAWT/eSubmission deadline** — configurable, defaults to the return deadline, never independently confirmed. (The eAFS deadline is settled: adjusted due date + 15 days. Whether eAFS applies to quarterly returns is settled: only when there are certificates, D93.)

---

## Known limitations

- **The SAWT keying worksheet is no longer linked from anywhere in the app (D160)**; the page (`/clients/[id]/sawt-worksheet`) and its xlsx export still work by URL.
- **The step 1 entry screen's grey "Declared gross sales for TY…" subtitle still shows only the quarters entered in the app** (it leaves out earlier quarters from the starting figures); left alone because D159 changes nothing else on that screen.
- **`generateSawtBatch` is not covered by the Complete lock (D153):** it writes the batch marker on certificates, including ones claimed on a Complete filing, and the worksheet needs that. Her call whether to lock it.
- **`Client.defaultWithholdingRateBps` has no reader left** (D152); the column stays and the seed still fills it.

- The late-filing penalty calculator exists but **self-disables** — surcharge and interest rates are `null`, no verified BIR figures.
- Seed `waitingSince` values are relative to the time of the run, so ageing shifts on every reseed.
- No PDF generation anywhere. The client package zip carries no manifest at all (D103 superseded D22's text manifest).
- **For a declared-income client nothing can be cross-checked** except the annual certificates-vs-declared-sales check (D37); a mid-year client's check covers only the in-app part of the year (D56).
- `@radix-ui/*` packages are installed with no import anywhere; `components/ui/*` are plain elements with Tailwind classes.
- **`data/app.db` has no backup** (nor `storage/` or `.env`) — housekeeping while the data is seeded, a real single point of failure the day it is not.
- **`MIXED_INCOME`'s annual return (Form 1701) has no form-line sheet** (D49); it stays on the old unrounded path.
- **`logFollowUp` and `WorkflowStep.followUpCount` stay in the code, but no screen uses them** — BIR waits refuse them (D72) and the dashboard dropped Log follow-up (D128).
- **An Annual's step 1 "Waiting on client" day count runs from when the filing was generated**, not from the end of the period. Cosmetic; the dashboard hides the filing until its period ends (D130).
- `FilingStatus.NA` has a label but `deriveFilingStatus` never produces it. Past-due filings read "Blocked" ahead of any waiting state.
- Per-step prep targets: all prep steps share `internalFilingTarget`, so every prep row shows the same date.
- `--faint` text (#8a879a) measures 3.49:1 against white — below the usual 4.5:1 for small text; kept knowingly (D58).
- The left menu's "SETTINGS" heading changes text colour on hover but gets no background fill (cosmetic).
- **README.md is stale** — it still describes a "minimal chart of accounts" and a Phase 1 build, both predating D25, and is left as is. (The Settings page's placeholder list was cleaned up in D105: it now lists only Backup.)
- **A fresh checkout's `npx tsc --noEmit` shows one error** (`app/layout.tsx`: `Cannot find name 'LayoutProps'`). Environment artefact, not a code error: `LayoutProps<"/">` is a type Next generates into `.next/types`, and that folder is gitignored. Since brief #5g it has been invisible on her laptop because `.next` exists there. Fix: run `npx next typegen` (or `npx next build` / `next dev` once), then `npx tsc --noEmit` is clean. The earlier "typecheck clean" lines were true on a machine with `.next`, not on a fresh clone.
- **One test can fail in a full run and pass on rerun.** `tests/actions/clientDocsDue.test.ts`'s backfill case sweeps every unfiled filing in the shared test database while other test files create rows; seen once in the brief #5u pass, and again in the brief #6a pass (one full run with 2 failures, not captured; two reruns passed 534 of 534). Not investigated further.

---

## Next, in order

1. **Walk the Tax Rules, ATC and Holidays pages** — the only screens not yet walked with her.
2. **Before November: back up** `data/app.db`, `storage/` and `.env`, and decide how. Warn her that old test uploads in `storage/` may include real client documents.
3. **A clean-start brief:** wipe the sample and test data and keep the reference data (rule sets, holidays, ATC codes) — the destructive-migration licence expires when live data is entered.
4. **Go-live setup for real clients:** add client → tax year → starting figures → generate filings (D78 enforces the order; there is no election step, D136). The Q3 1701Q is due **November 16, 2026** (the statutory Nov 15 is a Sunday). The Excel files stay the master until she switches.
5. **Confirm the ATC codes and the eSubmission address.**
6. **After go-live, in this order:** the document archive browse view; then the calendar; then the Annual overpayment carry-over (2026→2027).

---

## Branch history

`claude/admiring-curie-r15qu9` was the real lineage through brief #4g, cut from `claude/steady-noether-3xq7` (the D32 grouping work). `claude/serene-hypatia-rs67pw` was cut from `admiring-curie` for brief #5a. Two rework branches once diverged from the same base and were mis-described as stacked — D31 records that lesson.
