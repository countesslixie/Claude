# BIR 8% Freelancer Practice Manager

A local-first filing-cycle tracker for a bookkeeper managing multiple Philippine
freelancers/professionals on the 8% income tax option. See `SPEC.md` for the
full specification and build phases; this repo currently implements **Phase 1
(Foundation)** only.

## What's here (Phase 1)

- Prisma schema for the full data model (SPEC.md section 5), SQLite-backed
- Seed data: 3 fictitious clients across the 2025 filing cycle, tax rule sets,
  holidays, a sparse/unverified ATC code table, a minimal chart of accounts,
  and the 16-step workflow template
- Client CRUD (list, create, view, edit)
- Settings: tax rule sets (versioned rates/thresholds/deadlines) and holidays
- Single-password local auth with a signed session cookie

Everything else in `SPEC.md` — transactions, Form 2307, the tax engine,
filing workflow, documents, books, SAWT, dashboard — is later phases.

## Setup

```bash
npm install
cp .env.example .env   # then edit APP_PASSWORD and SESSION_SECRET
npx prisma migrate dev # creates data/app.db and seeds it
npm run dev
```

Open http://localhost:3000 and sign in with the password from `.env`
(`APP_PASSWORD`).

To generate your own session secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Starting the app (Windows)

Double-click **`Start Bookkeeping App.bat`** in the app folder. It opens a window titled
"Bookkeeping App - keep open" that runs `npm run dev` (in `cmd`), waits a few seconds, then opens
http://localhost:3000 in the browser. Keep that window open while you work; close it to stop the app.

## Data & documents

- The SQLite database lives at `data/app.db`. Uploaded documents live under `storage/` — never as
  database blobs. Neither folder is committed to git.
- **Backing up:** on the **Settings** page click **Back up now**. One zip downloads to your Downloads
  folder, named like `BIR Filing Manager backup 2026-10-03 1430.zip`. It holds a safe copy of the
  database, every uploaded document, the `.env` file and a `README.txt`. Settings shows when the last
  backup was made, and the Dashboard reminds you after 7 days. **The zip holds clients' TINs, income
  and documents — keep it on your own drive or a USB stick, never in a shared folder or an email.**
- **Restoring** (there is no restore button; it replaces everything with the state at the backup):
  1. Close the "Bookkeeping App - keep open" window.
  2. Unzip the backup (right-click, Extract All) into an empty folder.
  3. In the app folder, rename `data\app.db` to `app.db.before-restore` and the `storage` folder to
     `storage-before-restore`, then copy the backup's `data\app.db`, its `storage` folder and its `.env`
     file in. (`.env` is hidden by default: File Explorer, View, Show, Hidden items. Delete any
     `app.db-wal` or `app.db-shm` next to `app.db`.)
  4. Start the app and open a filing to check a document opens.

## Going live: the clean start

The app ships with eight fictitious sample clients. To remove them (and any test uploads) before
entering real clients: take a backup (Settings, Back up now), close the app window, open `cmd` in the app
folder and run `npm run clean-start`. It refuses unless a backup was taken in the last 24 hours, shows
what it will delete, and only continues if you type `DELETE`. It deletes every client and everything
belonging to a client, and every file in `storage/`; it keeps the tax rule sets, holidays, ATC codes and
the last-backup time. The seed never brings the sample clients back afterwards.

## Never do these on the live app

- **Never run `npx prisma migrate reset`** (or delete `data/app.db`). It deletes the whole database —
  every real client — and re-adds the sample clients. It is only for a scratch copy.
- **Never point the tests at the live database.** `npm test` builds its own throwaway database and
  document folder and refuses to start if either would be `data/app.db` or `storage/`. Do not try to
  get around that.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` / `npm run start` — production build/start
- `npm run lint` — ESLint
- `npm test` — Vitest, on its own throwaway database and storage (never `data/app.db`)
- `npm run clean-start` — remove the sample and test data once, before going live (see above)
- `npx prisma studio` — browse the local database
- `npx prisma migrate dev --name <name>` — create/apply a migration (also re-seeds)
- `npm run db:seed` — re-run the seed script directly

## Stack

Next.js 15 (App Router) + TypeScript strict, Prisma + SQLite, Tailwind CSS,
Zod, Luxon (pinned to `Asia/Manila`), Decimal.js for money (stored as integer
centavos — see `lib/money.ts`), exceljs (Phase 2+). No third-party analytics,
telemetry, or outbound network calls at runtime (SPEC.md section 14).
