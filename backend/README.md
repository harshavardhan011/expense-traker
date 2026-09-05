# Expense Manager

Reads Gmail bank alert emails, parses transactions with Gemini, categorizes merchants, and stores everything to Supabase (PostgreSQL). Exposes a REST API so any UI can connect.

## Prerequisites

- Node.js 22 LTS
- Google Cloud project with Gmail API enabled
- Gemini API key
- Supabase account (free at supabase.com)

## Setup

### 1. Install dependencies
```
npm install
```

### 2. Configure environment
```
cp .env.example .env
```
Edit `.env` and fill in all required values.

### 3. Set up Supabase

1. Sign up at [supabase.com](https://supabase.com) → create a new project (free, no credit card)
2. Go to **Project Settings → API** and copy:
   - **Project URL** → paste as `SUPABASE_URL` in `.env`
   - **anon/public key** → paste as `SUPABASE_ANON_KEY` in `.env`

> All tables and the `update_account_balance` RPC are created automatically on first run via `db/schema.sql`. No manual SQL needed.

### 4. Configure Gmail OAuth credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID for **Desktop app**
3. Download the JSON file and save it as `data/credentials.json`

### 5. Authenticate
```
npm run auth
```
A browser window will open. Complete the OAuth flow. `data/token.json` will be created.

### 6. Label your bank emails

In Gmail, create a label (e.g. `bank-alerts`) and apply it to your bank notification emails.
Set `GMAIL_LABELS=bank-alerts` in `.env` (or whatever label name you use).

### 7. Start

**As an HTTP API server (recommended — connect a UI):**
```
npm run server
```
Server starts on `http://localhost:3000`.

**As a one-shot script (cron / manual run):**
```
npm start
```

To use the web dashboard, leave `npm run server` running and start the UI from `../frontend` (`npm run dev`) — its dev server proxies `/api` to this one on port 3000. See [`../frontend/README.md`](../frontend/README.md).

## Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | *(required)* | Your Gemini API key |
| `SUPABASE_URL` | *(required)* | Supabase project URL |
| `SUPABASE_ANON_KEY` | *(required)* | Supabase anon/public API key |
| `DATABASE_URL` | *(optional)* | Postgres connection string — used only for schema bootstrap |
| `GMAIL_LABELS` | `bank-alerts` | Comma-separated Gmail label names to scan |
| `FETCH_WINDOW_HOURS` | `24` | Cold-start fallback window — used only when `processed_emails` is empty (see below) |
| `OVERLAP_BUFFER_MINUTES` | `10` | Subtracted from the last-run cutoff to absorb clock skew and in-flight emails |
| `PROCESSED_EMAILS_RETENTION_HOURS` | `FETCH_WINDOW_HOURS + 24` | How long dedup rows are kept; must be ≥ `FETCH_WINDOW_HOURS` |
| `GEMINI_BATCH_SIZE` | `20` | Emails per Gemini API call |
| `PORT` | `3000` | HTTP server port |

### How the scan window is chosen

Each run resumes from where the last one stopped rather than always scanning a fixed window:

1. Rows in `processed_emails` older than `PROCESSED_EMAILS_RETENTION_HOURS` are pruned.
2. The cutoff is the newest remaining `processed_at`, minus `OVERLAP_BUFFER_MINUTES`.
3. If `processed_emails` is empty (first run, or after a truncate), the cutoff falls back to `now − FETCH_WINDOW_HOURS`.

So a gap between runs is handled automatically — you do **not** need to widen `FETCH_WINDOW_HOURS` just because you run infrequently. Each run logs which source the cutoff came from.

Keep retention above the fetch window. If `PROCESSED_EMAILS_RETENTION_HOURS < FETCH_WINDOW_HOURS`, dedup state can expire before the window closes and emails may be processed twice; the pipeline prints a `[WARN]` when it detects this.

## HTTP API

All routes return JSON. Errors return `{ "error": "message" }`.

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
| POST | `/sync` | Trigger Gmail sync; returns `{ parsed, skipped, errors, recategorized }`. Returns 409 if already running. |

## Account Management (CLI)

Everything here is also available over HTTP and in the web dashboard; the CLI is kept for terminal use.
Commands take either the account's last 4 digits or its numeric ID — if a last4 matches more than one account, the CLI lists the matches and asks for the ID.

```bash
npm run cli -- account list            # list all accounts with balances
npm run cli -- account add             # add a new account (interactive)
npm run cli -- account add-funds 1482  # add funds to savings/salary account
npm run cli -- account pay 8735        # record a credit card bill payment
npm run cli -- account history 8735    # show transaction history
npm run cli -- account backfill 8735   # recalculate balance from existing expenses
```

## Supabase Tables

| Table | Purpose |
|-------|---------|
| `expenses` | One row per parsed transaction |
| `processed_emails` | Gmail IDs already handled (dedup guard) |
| `merchant_mappings` | Merchant → category lookup |
| `activity_logs` | Skipped and errored emails |
| `accounts` | Bank accounts and credit cards with current balances |
| `account_transactions` | Audit trail for every account balance change |

### Account balance semantics

- **Credit cards**: `balance` = unbilled amount (positive = you owe). DR increases, CR/payment decreases.
- **Savings/salary**: `balance` = available funds (positive = you have). DR decreases, CR/manual credit increases.

## Merchant Categories

Update merchant→category mappings directly in the Supabase `merchant_mappings` table, or via SQL:

```sql
INSERT INTO merchant_mappings (merchant, category)
VALUES ('swiggy', 'Food & Dining'), ('amazon', 'Shopping')
ON CONFLICT (merchant) DO UPDATE SET category = EXCLUDED.category;
```

Keys are lowercase; matching is case-insensitive.

## Useful Queries

Monthly spending by category (`expenses.date` is stored as `TEXT` in `YYYY-MM-DD` form):
```sql
SELECT
  LEFT(date, 7) AS month,
  category,
  SUM(amount) AS total
FROM expenses
WHERE type = 'DR'
GROUP BY month, category
ORDER BY month DESC, total DESC;
```

Account balance snapshot:
```sql
SELECT name, account_type, account_last4, balance, currency
FROM accounts WHERE is_active = true
ORDER BY account_type, name;
```

## Notes

- Emails already in `processed_emails` are skipped on re-runs (no duplicates), and each email is marked processed immediately after its DB write — a crash mid-run won't duplicate rows on restart
- Pagination is not implemented; all labels are fetched in one query capped at **100 emails per run**
- Gemini failures leave the email unprocessed so it retries on the next run; Gmail fetch failures mark it processed immediately to avoid an infinite retry loop
- `data/credentials.json` and `data/token.json` stay local — never stored in the database
- **To re-process emails:** truncate the `processed_emails` table in Supabase. That also drops the cutoff back to the `FETCH_WINDOW_HOURS` fallback, so raise it to cover the period you want re-scanned
- `POST /sync` requires a pre-authorized `data/token.json` — run `npm run auth` before starting the server
- The API has no authentication — keep it bound to localhost
