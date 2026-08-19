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

## Data & documents

- The SQLite database lives at `data/app.db` — back it up by copying the file.
- Uploaded documents will live under `storage/` (Phase 3+) — never as DB blobs.
- Neither directory is committed to git.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` / `npm run start` — production build/start
- `npm run lint` — ESLint
- `npm test` — Vitest (tax engine tests land in Phase 2)
- `npx prisma studio` — browse the local database
- `npx prisma migrate dev --name <name>` — create/apply a migration (also re-seeds)
- `npm run db:seed` — re-run the seed script directly

## Stack

Next.js 15 (App Router) + TypeScript strict, Prisma + SQLite, Tailwind CSS,
Zod, Luxon (pinned to `Asia/Manila`), Decimal.js for money (stored as integer
centavos — see `lib/money.ts`), exceljs (Phase 2+). No third-party analytics,
telemetry, or outbound network calls at runtime (SPEC.md section 14).
