# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

```
expense-tracker/
├── backend/    ← Node.js ≥22 Express API + Gmail→Gemini→Supabase pipeline
│                 All backend npm commands run from here (cd backend first)
└── frontend/   ← Vite + React 19 + TypeScript dashboard (Tailwind v4)
                  Dev server proxies /api → http://localhost:3000
```

Two independent npm workspaces — there is no root `package.json`. Install and run each separately.

## Commands

### Backend (run from `backend/`)

```bash
npm install          # install dependencies
npm run auth         # one-time Gmail OAuth flow — creates data/token.json
npm run server       # start the HTTP API server (default port 3000)
npm start            # one-shot sync: fetch + parse emails → Supabase (script mode, kept for cron use)
npm run cli -- account list            # list all accounts with balances
npm run cli -- account add             # add a new account (interactive)
npm run cli -- account add-funds 1482  # add funds to savings/salary account
npm run cli -- account pay 8735        # record a credit card bill payment
npm run cli -- account history 8735    # show transaction history
npm run cli -- account backfill 8735   # recalculate balance from existing expenses
npm run format       # run prettier over src/**/*.js
```

CLI account commands take `<last4|id>`; a last4 matching multiple accounts errors out and asks for the ID.

### Frontend (run from `frontend/`)

```bash
npm install          # install dependencies
npm run dev          # Vite dev server (default http://localhost:5173)
npm run build        # tsc -b && vite build
npm run lint         # eslint
npm run preview      # preview the production build
```

The backend must be running on port 3000 for the UI to load data — Vite proxies `/api/*` to it and strips the `/api` prefix (`frontend/vite.config.ts`).

No test runner is configured in either workspace. The backend has no linter (prettier only); the frontend uses ESLint.

## HTTP API (`backend/src/server.js`)

`npm run server` starts an Express server on `$PORT` (default 3000). Schema bootstrap runs on startup — a failure exits the process before `listen`. All routes return JSON; errors return `{ error: message }` with status 500.

| Method | Path | Body / Query | Response |
|--------|------|--------------|----------|
| GET | `/health` | — | `{ ok: true }` |
| GET | `/accounts` | `?activeOnly=` (default true; only the literal `false` disables) | `Array<account>` |
| POST | `/accounts` | `{ name, accountType, accountLast4, currency?, balance?, creditLimit? }` | `201 { id, balance }` |
| GET | `/accounts/:id` | — | `account` |
| GET | `/accounts/:id/transactions` | `?limit=` (default 20) | `Array<txn>` |
| POST | `/accounts/:id/add-funds` | `{ amount, description }` | `{ balance }` |
| POST | `/accounts/:id/pay` | `{ amount, description }` | `{ balance }` |
| POST | `/accounts/:id/backfill` | — | `{ balance, expensesLinked }` |
| GET | `/expenses` | `?limit=50&offset=0&category=&accountLast4=` | `Array<expense>` (newest first) |
| GET | `/expenses/:id` | — | `expense` |
| POST | `/sync` | — | `{ parsed, skipped, errors, recategorized }`; `409` if already running |

`add-funds` and `pay` return `400` unless `amount` is a positive number. `POST /sync` requires `data/token.json` (run `npm run auth` first).

## Architecture

The backend has two entry points that share the same pipeline:
- **`backend/src/server.js`** — Express HTTP server (primary, serves the frontend)
- **`backend/src/index.js`** — One-shot script wrapper (kept for cron/manual use)

Both call `runSync()` from `backend/src/pipeline.js`.

```
[server.js or index.js]
        ↓
  src/pipeline.js  (runSync)
        ↓
prune dedup state → compute cutoff → Gmail API (one combined query)
        ↓
filter duplicates → fetch bodies (parallel) → Gemini batch
        ↓
merchant map → Supabase (expenses) → account balance RPC → mark processed
```

**Data flow:**
1. `auth.js` — OAuth2 Desktop App flow, `gmail.readonly` scope. Uses `getFreePort()` so the redirect URI port is truly ephemeral (the `oauthRedirectPort` setting is **not** used). Redirect URI must use `127.0.0.1` (not `localhost`) to avoid IPv6 mismatch on Windows. Token cached in `data/token.json`; auto-refreshed if expired. An `invalid_grant` refresh failure deletes the token and restarts the interactive flow. Consent times out after 2 minutes.
2. `services/gmail-reader.js` — Resolves label names → IDs through a single `users.labels.list` call cached in-process for the life of the process; an unknown label logs a warning and is skipped (never falls through to "all messages"). Fetches IDs with **one combined `messages.list` query**: a single label uses the `labelIds` filter, multiple labels use `after:<s> (label:"a" OR label:"b")`. Gmail `after:` needs Unix **seconds** (divide `Date.now()` by 1000). Label attribution is deferred to `resolveLabelName()` at body-fetch time using the `labelIds` returned per message — first configured label wins. Body extracted by walking the MIME tree: prefers `text/plain`, falls back to `text/html` run through cheerio (`style`/`script` stripped, whitespace collapsed). Gmail returns URL-safe base64; decode with `-`→`+`, `_`→`/` before `Buffer.from`.
3. `services/gemini-parser.js` — Uses `@google/genai` SDK (`GoogleGenAI`), model `gemini-2.5-flash`, `responseMimeType: 'application/json'`, `temperature: 0`. Emails are batched (`GEMINI_BATCH_SIZE`, default 20) into one prompt and each body is truncated to 1500 chars. Returns `null` expense for non-transaction emails; refunds/reversals/cashbacks are explicitly *not* treated as non-transactions. Uses Gmail `receivedAt` as the date fallback. API or JSON-parse failures return a `geminiError` for every email in the batch rather than throwing.
4. `services/db-merchant-mapper.js` — Active merchant→category lookup via the Supabase `merchant_mappings` table, cached in-process. Keys are lowercased and trimmed; a `upi-id@bank Name` merchant is normalized down to `Name`. Auto-inserts `'Uncategorized'` for unknown merchants.
5. `services/db-writer.js` — `insertExpense()` upserts on `email_id` (safe to re-run), then calls `recordExpenseImpact()` to update the linked account balance — a balance failure is warned, not fatal. `recategorizeUncategorized()` re-checks every `Uncategorized` expense against current mappings and returns the number updated.
6. `services/account-manager.js` — Account CRUD, balance updates, and expense-to-account linking. Uses the `update_account_balance` Postgres RPC for atomic balance mutations. Finds accounts by `(account_type, account_last4)` with a last4-only fallback for UPI/netbanking expenses linking to savings accounts — the fallback only resolves when exactly one active account matches.
7. `services/expense-reader.js` — Read-only queries for the `expenses` table (`listExpenses`, `getExpenseById`). Used by the HTTP server.
8. `services/db-bootstrap.js` — Applies `db/schema.sql` in one transaction over a raw `pg` connection. Skipped with a warning when `DATABASE_URL` is unset.
9. `services/db.js` — Supabase client singleton; **throws at import** if `SUPABASE_URL`/`SUPABASE_ANON_KEY` are missing.
10. `src/pipeline.js` — Core sync logic. State saved **per-email** immediately after the DB write (not at end of run), so a crash mid-run doesn't cause duplicates on restart. Returns `{ parsed, skipped, errors, recategorized }`; throws on fatal errors instead of `process.exit`.
11. `src/index.js` — Thin wrapper: calls `runSync()` and exits. Preserves `npm start` behaviour.
12. `src/cli.js` — Interactive CLI for account management (list, add, add-funds, pay, history, backfill). Uses Node.js `readline`. Superseded by the HTTP endpoints and the frontend, but still supported.

`services/csv-writer.js` and `services/merchant-mapper.js` are dead code — the file-based predecessors of `db-writer.js` and `db-merchant-mapper.js`. Nothing requires them; don't extend them.

### Incremental sync cutoff

The scan window is **not** simply `FETCH_WINDOW_HOURS` back from now. `runSync()`:

1. `pruneProcessedIds()` — deletes `processed_emails` rows older than `PROCESSED_EMAILS_RETENTION_HOURS`.
2. `getLastRunCutoff()` — reads the newest `processed_at` and subtracts `OVERLAP_BUFFER_MINUTES`.
3. `since` = that cutoff, **or** `now − FETCH_WINDOW_HOURS` when `processed_emails` is empty (first run, or after a truncate).
4. `loadProcessedIds(since)` — builds the dedup set from rows at or after `since`, minus another overlap buffer.

So `FETCH_WINDOW_HOURS` is a **cold-start fallback**, not the steady-state window: a long gap between runs is handled automatically because the cutoff resumes from the last processed email. The run logs which source the cutoff came from. If retention is shorter than the fetch window, dedup state can expire before the window closes and emails may be reprocessed — the pipeline logs a `[WARN]` when `PROCESSED_EMAILS_RETENTION_HOURS < FETCH_WINDOW_HOURS`.

### Frontend

`frontend/src` — React 19 + React Router 7 + TanStack Query 5 + Tailwind v4 (configured via the `@tailwindcss/vite` plugin and an `@theme` block in `index.css`; there is no `tailwind.config.js`).

| Path | Purpose |
|------|---------|
| `main.tsx` | Providers: QueryClient (`staleTime` 30s, `retry` 1) → BrowserRouter → ToastProvider |
| `App.tsx` | Routes: `/` Dashboard, `/expenses`, `/accounts`, `/accounts/:id` |
| `lib/api.ts` | `fetch` wrapper over base `/api`; throws `ApiError` carrying `status` |
| `lib/format.ts` | INR currency/date formatting, account + txn type labels, `isAssetAccount()` |
| `types.ts` | API response types — mirrors the DB column names (`snake_case`) |
| `hooks/` | `useAccounts`, `useExpenses`, `useSync` — queries, mutations, and cache invalidation |
| `context/ToastContext.tsx` | Toast notifications (auto-dismiss after 4s) |
| `components/` | `Layout` (sidebar + Sync button), `AccountCard`, `Modal`, `Badge`, `Spinner`, `EmptyState`, `ErrorState`, `forms/` |
| `pages/` | `Dashboard` (KPIs + month-to-date category breakdown), `Expenses` (filter + paging), `Accounts`, `AccountDetail` |

The sidebar Sync button calls `POST /sync` and special-cases the `409` response as an info toast ("Sync already in progress"). The Dashboard derives its month-to-date figures client-side from `GET /expenses?limit=200` — there is no aggregate endpoint.

## Configuration

All backend runtime config lives in `backend/src/config/settings.js`. All file paths use `path.join(__dirname, ...)` — safe regardless of cwd.

Key `.env` variables (see `backend/.env.example` for structure):

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | *(required)* | Gemini API key |
| `SUPABASE_URL` | *(required)* | Supabase project URL |
| `SUPABASE_ANON_KEY` | *(required)* | Supabase anon/public API key |
| `DATABASE_URL` | *(optional)* | Postgres connection string — used only for schema bootstrap |
| `GMAIL_LABELS` | `bank-alerts` | Comma-separated Gmail label names to scan |
| `GMAIL_LABEL` | — | Legacy alias for `GMAIL_LABELS` (single label) |
| `FETCH_WINDOW_HOURS` | `24` | Cold-start fallback window, used only when `processed_emails` is empty |
| `OVERLAP_BUFFER_MINUTES` | `10` | Subtracted from the last-run cutoff to absorb clock skew / in-flight emails |
| `PROCESSED_EMAILS_RETENTION_HOURS` | `FETCH_WINDOW_HOURS + 24` | How long dedup rows are kept; must be ≥ `FETCH_WINDOW_HOURS` |
| `GEMINI_BATCH_SIZE` | `20` | Emails per Gemini API call |
| `PORT` | `3000` | HTTP server port |

The frontend needs no env vars — the API base is the fixed path `/api`, resolved by the Vite dev proxy.

## Data Files (`backend/data/`)

| File | Purpose |
|------|---------|
| `credentials.json` | OAuth client credentials (download from Google Cloud Console) |
| `token.json` | OAuth access + refresh token (auto-created by `npm run auth`) |
| `merchant-mapping.json` | Legacy file-based merchant map (superseded by `merchant_mappings` table) |
| `expenses.csv` | Legacy CSV output (superseded by `expenses` table) |
| `processed-emails.json` | Legacy dedup state (superseded by `processed_emails` table) |
| `activity.log` | Legacy file log (superseded by `activity_logs` table) |

`backend/scripts/migrate-to-supabase.js` is the one-time importer that moved those legacy files into Supabase.

**To re-process emails:** truncate the `processed_emails` Supabase table. That also resets the cutoff to the `FETCH_WINDOW_HOURS` fallback, so raise it to cover the period you want to re-scan.

## Supabase Tables

Schema defined in `backend/db/schema.sql` (single source of truth). All tables and the `update_account_balance` RPC are created automatically on startup via `CREATE TABLE IF NOT EXISTS` / `CREATE OR REPLACE FUNCTION` — idempotent, safe to run every time. Bootstrap is skipped (with a warning) when `DATABASE_URL` is unset.

| Table | Purpose |
|-------|---------|
| `expenses` | Transaction records (one row per parsed email, unique on `email_id`) |
| `processed_emails` | Deduplication state for email processing |
| `merchant_mappings` | Merchant → category lookup |
| `activity_logs` | Audit trail for skipped/errored emails |
| `accounts` | Bank accounts and credit cards with current balances |
| `account_transactions` | Audit trail for every account balance change |

**Account balance semantics:**
- **Credit cards**: `balance` = unbilled amount (positive = you owe). DR increases, CR/payment decreases.
- **Savings/salary**: `balance` = available funds (positive = you have). DR decreases, CR/manual credit increases.
- Account types are constrained to `credit_card`, `savings`, `salary`, `debit_card`; `accounts` is unique on `(account_type, account_last4)`.
- Linking: expenses match accounts by `(account_type, account_last4)` with last4-only fallback.
- Idempotent: `account_transactions.expense_id` prevents double-counting on re-runs.
- Atomic: the `update_account_balance` RPC handles UPDATE + INSERT in one transaction and returns the new balance.

## Key Design Constraints

- `backend/data/` is created on first run by `initDataDirectory()` in `pipeline.js` — no manual setup needed beyond credentials.
- Pagination is not implemented for the Gmail fetch: `maxResults: 100` on a single combined `messages.list` call, so **100 emails per run in total** (not per label).
- `GET /expenses` returns a bare array — no total count — so the UI's pager can only infer "there may be more" from a full page.
- Gemini errors leave the email unprocessed so it retries next run; fetch failures mark it processed immediately to prevent infinite retry loops.
- Use the `@google/genai` SDK (not the deprecated `@google/generative-ai`).
- The Express API has no auth — bind it locally only.

## Sensitive Files — Never Read

These files contain live credentials and secrets. Never read, grep, or glob them:

| File | Contains |
|------|----------|
| `backend/.env`, `backend/.env.*` | `GEMINI_API_KEY`, Supabase keys, and `DATABASE_URL` |
| `backend/data/credentials.json` | Google OAuth2 client secret |
| `backend/data/token.json` | Live OAuth access + refresh tokens |
| `*.pem`, `*.key`, `*.p12`, `*.pfx` | Private keys / certificates |

Access is also blocked at the tool level by a global `PreToolUse` hook on Read, Grep, and Glob.
If you need to understand the `.env` structure, refer to `backend/.env.example` instead.
