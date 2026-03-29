# Expense Manager CLI

Reads Gmail bank alert emails, parses transactions with Gemini, categorizes merchants, and stores to Supabase (PostgreSQL).

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
2. Go to **SQL Editor** and run the following to create the four tables:

```sql
CREATE TABLE expenses (
  id              BIGSERIAL PRIMARY KEY,
  email_id        TEXT UNIQUE NOT NULL,
  label           TEXT,
  date            DATE NOT NULL,
  amount          NUMERIC(12,2) NOT NULL,
  currency        CHAR(3) NOT NULL DEFAULT 'INR',
  type            CHAR(2) NOT NULL CHECK (type IN ('DR','CR')),
  merchant        TEXT,
  category        TEXT DEFAULT 'Uncategorized',
  raw_description TEXT,
  available_credit_limit NUMERIC(12,2),
  account_type    TEXT,
  account_last4   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE processed_emails (
  email_id     TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE merchant_mappings (
  merchant   TEXT PRIMARY KEY,
  category   TEXT NOT NULL DEFAULT 'Uncategorized',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE activity_logs (
  id         BIGSERIAL PRIMARY KEY,
  logged_at  TIMESTAMPTZ DEFAULT NOW(),
  level      TEXT NOT NULL,
  email_id   TEXT NOT NULL,
  subject    TEXT,
  detail     TEXT
);
```

3. Go to **Project Settings → API** and copy:
   - **Project URL** → paste as `SUPABASE_URL` in `.env`
   - **anon/public key** → paste as `SUPABASE_ANON_KEY` in `.env`

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
Set `GMAIL_LABEL=bank-alerts` in `.env` (or whatever label name you use).

### 7. (Optional) Migrate existing CSV data

If you have existing data in `data/expenses.csv`, run the one-time migration:
```
node scripts/migrate-to-supabase.js
```

### 8. Run
```
npm start
```

## Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | *(required)* | Your Gemini API key |
| `SUPABASE_URL` | *(required)* | Supabase project URL |
| `SUPABASE_ANON_KEY` | *(required)* | Supabase anon/public API key |
| `GMAIL_LABEL` | `bank-alerts` | Gmail label to filter emails |
| `FETCH_WINDOW_HOURS` | `24` | How many hours back to scan |
| `GEMINI_BATCH_SIZE` | `20` | Emails per Gemini API call |

## Output (Supabase tables)

| Table | Purpose |
|-------|---------|
| `expenses` | One row per parsed transaction |
| `processed_emails` | Gmail IDs already handled (dedup guard) |
| `merchant_mappings` | Merchant → category lookup |
| `activity_logs` | Skipped and errored emails |

View and query your data in the **Supabase Table Editor** or SQL Editor.

## Expense Columns

`label, date, amount, currency, type, merchant, category, raw_description, available_credit_limit, account_type, account_last4, email_id`

## Merchant Categories

Update merchant→category mappings directly in the Supabase `merchant_mappings` table (Table Editor), or via SQL:

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

## Notes

- Emails already in `processed_emails` are skipped on re-runs (no duplicates)
- If `FETCH_WINDOW_HOURS=24` and you run weekly, emails older than 24h will be missed — increase the window accordingly
- Pagination is not implemented; a maximum of 100 emails per run are fetched
- `data/credentials.json` and `data/token.json` stay local — they are never stored in the database
