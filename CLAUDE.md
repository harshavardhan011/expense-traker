# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

```
expense-tracker/
├── backend/    ← Node.js ≥22 Express API + Gmail→Gemini→Supabase pipeline
│                 All npm commands run from here (cd backend first)
└── frontend/   ← Planned UI workspace (currently empty)
                  Will consume the backend REST API at http://localhost:3000
```

> **Note:** The repo is mid-restructure. If `git status` shows old root-level paths (e.g. `src/`, `CLAUDE.md`, `README.md`) as deleted `D`, that's expected — they moved to `backend/` and the commit hasn't landed yet.

## Commands

All commands must be run from the `backend/` directory.

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

No test runner or linter is configured.

## HTTP API (`backend/src/server.js`)

`npm run server` starts an Express server on `$PORT` (default 3000). Schema bootstrap runs on startup. All routes return JSON; errors return `{ error: message }`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness check |
| GET | `/accounts?activeOnly=` | List accounts |
| POST | `/accounts` | Create account |
| GET | `/accounts/:id` | Get account by ID |
| GET | `/accounts/:id/transactions?limit=` | Transaction history |
| POST | `/accounts/:id/add-funds` | Credit funds `{ amount, description }` |
| POST | `/accounts/:id/pay` | Record bill payment `{ amount, description }` |
| POST | `/accounts/:id/backfill` | Recalculate balance from existing expenses |
| GET | `/expenses?limit=&offset=&category=&accountLast4=` | List expenses (newest first) |
| GET | `/expenses/:id` | Get expense by ID |
| POST | `/sync` | Trigger Gmail sync pipeline; returns `{ parsed, skipped, errors, recategorized }`. Returns 409 if already running. Requires `data/token.json` (run `npm run auth` first). |

## Architecture

The app has two entry points that share the same pipeline:
- **`backend/src/server.js`** — Express HTTP server (primary, for UI integration)
- **`backend/src/index.js`** — One-shot script wrapper (kept for cron/manual use)

Both call `runSync()` from `backend/src/pipeline.js`.

```
[server.js or index.js]
        ↓
  src/pipeline.js  (runSync)
        ↓
Gmail API → email IDs → filter duplicates → fetch bodies (parallel) → Gemini batch → merchant map → Supabase
```

**Data flow:**
1. `auth.js` — OAuth2 Desktop App flow. Uses `getFreePort()` so the redirect URI port is truly ephemeral (the `oauthRedirectPort` setting is not used). Redirect URI must use `127.0.0.1` (not `localhost`) to avoid IPv6 mismatch on Windows. Token cached in `data/token.json`; auto-refreshed if expired.
2. `services/gmail-reader.js` — Resolves each label name → ID at runtime (returns `null`, not `undefined`, if not found — avoids returning ALL messages). Supports multiple labels (`GMAIL_LABELS` comma-separated); deduplication is first-label-wins. Gmail `after:` query needs Unix **seconds** (divide `Date.now()` by 1000). Body extracted by walking the MIME tree: prefers `text/plain`, falls back to `text/html`. Gmail returns URL-safe base64; decode with `-`→`+`, `_`→`/` before `Buffer.from`.
3. `services/gemini-parser.js` — Uses `@google/genai` SDK (`GoogleGenAI`), model `gemini-2.5-flash`, `responseMimeType: 'application/json'`, `temperature: 0`. Emails are batched (controlled by `GEMINI_BATCH_SIZE`, default 20). Each email is truncated to 1500 chars before being sent. Returns `null` expense for non-transaction emails. Uses Gmail `receivedAt` as date fallback.
4. `services/db-merchant-mapper.js` — Active merchant→category lookup via Supabase `merchant_mappings` table. Auto-inserts 'Uncategorized' for unknown merchants.
5. `services/account-manager.js` — Account CRUD, balance updates, and expense-to-account linking. Uses `update_account_balance` Postgres RPC for atomic balance mutations. Finds accounts by `(account_type, account_last4)` with last4-only fallback for UPI/netbanking expenses linking to savings accounts.
6. `services/expense-reader.js` — Read-only queries for the `expenses` table (`listExpenses`, `getExpenseById`). Used by the HTTP server.
7. `src/pipeline.js` — Core sync logic. State saved **per-email** immediately after DB write (not at end of run), so a crash mid-run doesn't cause duplicates on restart. Returns `{ parsed, skipped, errors, recategorized }`; throws on fatal errors instead of `process.exit`.
8. `src/index.js` — Thin wrapper: calls `runSync()` and exits. Preserves `npm start` behaviour.
9. `src/cli.js` — Interactive CLI for account management (list, add, add-funds, pay, history, backfill). Uses Node.js `readline`. (Will eventually be replaced by HTTP endpoints.)

## Configuration

All runtime config in `backend/src/config/settings.js`. All file paths use `path.join(__dirname, ...)` — safe regardless of cwd.

Key `.env` variables (see `backend/.env.example` for structure):

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | *(required)* | Gemini API key |
| `SUPABASE_URL` | *(required)* | Supabase project URL |
| `SUPABASE_ANON_KEY` | *(required)* | Supabase anon/public API key |
| `DATABASE_URL` | *(optional)* | Postgres connection string — used only for schema bootstrap |
| `GMAIL_LABELS` | `bank-alerts` | Comma-separated Gmail label names to scan |
| `GMAIL_LABEL` | — | Legacy alias for `GMAIL_LABELS` (single label) |
| `FETCH_WINDOW_HOURS` | `24` | How far back to scan; increase if running infrequently |
| `GEMINI_BATCH_SIZE` | `20` | Emails per Gemini API call |
| `PORT` | `3000` | HTTP server port |

## Data Files (`backend/data/`)

| File | Purpose |
|------|---------|
| `credentials.json` | OAuth client credentials (download from Google Cloud Console) |
| `token.json` | OAuth access + refresh token (auto-created by `npm run auth`) |
| `merchant-mapping.json` | Legacy file-based merchant map (superseded by `merchant_mappings` table) |
| `expenses.csv` | Legacy CSV output (superseded by `expenses` table) |
| `activity.log` | Legacy file log (superseded by `activity_logs` table) |

**To re-process emails:** truncate the `processed_emails` Supabase table and increase `FETCH_WINDOW_HOURS`.

## Supabase Tables

Schema defined in `backend/db/schema.sql` (single source of truth). All tables and the `update_account_balance` RPC are created automatically on startup via `CREATE TABLE IF NOT EXISTS` / `CREATE OR REPLACE FUNCTION` — idempotent, safe to run every time.

| Table | Purpose |
|-------|---------|
| `expenses` | Transaction records (one row per parsed email) |
| `processed_emails` | Deduplication state for email processing |
| `merchant_mappings` | Merchant → category lookup |
| `activity_logs` | Audit trail for skipped/errored emails |
| `accounts` | Bank accounts and credit cards with current balances |
| `account_transactions` | Audit trail for every account balance change |

**Account balance semantics:**
- **Credit cards**: `balance` = unbilled amount (positive = you owe). DR increases, CR/payment decreases.
- **Savings/salary**: `balance` = available funds (positive = you have). DR decreases, CR/manual credit increases.
- Linking: expenses match accounts by `(account_type, account_last4)` with last4-only fallback.
- Idempotent: `account_transactions.expense_id` prevents double-counting on re-runs.
- Atomic: `update_account_balance` RPC function handles UPDATE + INSERT in one transaction.

## Key Design Constraints

- `backend/data/` dir is created on first run by `initDataDirectory()` in `pipeline.js` — no manual setup needed beyond credentials.
- Pagination not implemented; max 100 emails per label per run.
- Use `@google/genai` SDK (not the deprecated `@google/generative-ai`).
- Fetch-failed emails are marked processed immediately (same as parsed emails) to prevent infinite retry loops.

## Sensitive Files — Never Read

These files contain live credentials and secrets. Never read, grep, or glob them:

| File | Contains |
|------|----------|
| `backend/.env`, `backend/.env.*` | `GEMINI_API_KEY` and Gmail OAuth config |
| `backend/data/credentials.json` | Google OAuth2 client secret |
| `backend/data/token.json` | Live OAuth access + refresh tokens |
| `*.pem`, `*.key`, `*.p12`, `*.pfx` | Private keys / certificates |

Access is also blocked at the tool level by a global `PreToolUse` hook on Read, Grep, and Glob.
If you need to understand the `.env` structure, refer to `backend/.env.example` instead.
