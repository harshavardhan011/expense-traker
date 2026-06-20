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

## Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | *(required)* | Your Gemini API key |
| `SUPABASE_URL` | *(required)* | Supabase project URL |
| `SUPABASE_ANON_KEY` | *(required)* | Supabase anon/public API key |
| `DATABASE_URL` | *(optional)* | Postgres connection string — used only for schema bootstrap |
| `GMAIL_LABELS` | `bank-alerts` | Comma-separated Gmail label names to scan |
| `FETCH_WINDOW_HOURS` | `24` | How many hours back to scan |
| `GEMINI_BATCH_SIZE` | `20` | Emails per Gemini API call |
| `PORT` | `3000` | HTTP server port |

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

Monthly spending by category:
```sql
SELECT
  TO_CHAR(date, 'YYYY-MM') AS month,
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

- Emails already in `processed_emails` are skipped on re-runs (no duplicates)
- If `FETCH_WINDOW_HOURS=24` and you run weekly, emails older than 24h will be missed — increase the window accordingly
- Pagination is not implemented; a maximum of 100 emails per label per run
- `data/credentials.json` and `data/token.json` stay local — never stored in the database
- **To re-process emails:** truncate the `processed_emails` table in Supabase and increase `FETCH_WINDOW_HOURS`
- `POST /sync` requires a pre-authorized `data/token.json` — run `npm run auth` before starting the server
