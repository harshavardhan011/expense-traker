# Expense Manager — Low Level Design Document

## 1. Overview

A Node.js CLI tool that reads bank payment alert emails from Gmail, parses them using Google Gemini Flash API, auto-categorizes using a merchant mapping table in Supabase, and stores all expense data to a PostgreSQL database (Supabase). Designed to run manually from a laptop — daily or weekly.

All persistent state (expenses, processed email IDs, merchant mappings, activity logs) lives in Supabase. Only OAuth credential files remain local.

---

## 2. System Flow

```
[You run: node src/index.js]
        │
        ▼
[Gmail API] ──► Fetch emails from configured labels (last N hours)
        │
        ▼
[Dedup Filter] ──► Skip already-processed emails
        │           (SELECT from processed_emails table)
        ▼
[Gemini Parser] ──► Send raw email text to Gemini Flash API (free tier)
        │            Prompt: "Extract amount, merchant, date, type as JSON"
        │            Returns: { amount, merchant, date, type, currency, ... }
        ▼
[Merchant Mapper] ──► SELECT from merchant_mappings table (in-process cache)
        │               ├── Found: return category
        │               └── Not found: INSERT 'Uncategorized', return it
        ▼
[DB Writer] ──► UPSERT row into expenses table (Supabase)
        │
        ▼
[Save State] ──► INSERT email_id into processed_emails table
        │
        ▼
[Terminal Summary] ──► Print what was logged
        │
        ▼
[Recategorize] ──► UPDATE expenses SET category=... WHERE category='Uncategorized'
                    using current merchant_mappings
```

---

## 3. Project Structure

```
expense-manager/
├── src/
│   ├── index.js                    # Main entry point — orchestrates the full flow
│   ├── auth.js                     # Google OAuth2 authentication
│   ├── config/
│   │   └── settings.js             # All configuration in one place
│   └── services/
│       ├── gmail-reader.js         # Gmail API integration
│       ├── gemini-parser.js        # Gemini Flash API for parsing emails
│       ├── db.js                   # Supabase client singleton
│       ├── db-writer.js            # Insert/upsert expenses into Supabase
│       ├── db-merchant-mapper.js   # DB-backed merchant lookup + in-process cache
│       ├── csv-writer.js           # [DEPRECATED — replaced by db-writer.js]
│       └── merchant-mapper.js      # [DEPRECATED — replaced by db-merchant-mapper.js]
├── scripts/
│   └── migrate-to-supabase.js      # One-time migration: CSV/JSON files → Supabase
├── data/
│   ├── credentials.json            # Google OAuth creds (user provides, never in DB)
│   └── token.json                  # Auto-generated after first auth (never in DB)
├── package.json
├── .env
├── .env.example
├── .gitignore
└── README.md
```

---

## 4. Module Specifications

### 4.1 `src/config/settings.js`

Exports a single config object:

```javascript
module.exports = {
  // Gmail
  gmailLabels: ['bank-alerts'],        // comma-separated from GMAIL_LABELS env var
  fetchWindowHours: 24,                // from FETCH_WINDOW_HOURS env var

  // Gemini
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: 'gemini-2.5-flash',
  geminiBatchSize: 20,                 // emails per Gemini call

  // Supabase
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,

  // Local-only paths (OAuth credentials — never go to DB)
  dataDir: './data',
  credentialsPath: './data/credentials.json',
  tokenPath: './data/token.json',
};
```

### 4.2 `src/auth.js`

Handles Google OAuth2 for Gmail API (read-only scope).

**Behavior:**
- If `token.json` exists and is valid → return auth client
- If token is expired → refresh it automatically
- If no token → open browser for OAuth consent, save token after approval
- Redirect URI: `http://127.0.0.1:<ephemeral_port>/callback` (port chosen at runtime)

**Scopes needed:**
- `https://www.googleapis.com/auth/gmail.readonly`

### 4.3 `src/services/gmail-reader.js`

**Functions: `fetchEmailIds(auth, since, labels)` and `fetchEmailBody(auth, emailId)`**

- Resolves each label name → label ID at runtime via `users.labels.list`
- Supports multiple labels (comma-separated in `GMAIL_LABELS`); dedup is first-label-wins
- `after:` query uses Unix seconds
- Body extraction: walks MIME tree, prefers `text/plain`, falls back to `text/html`
- Gmail returns URL-safe base64 (`-`→`+`, `_`→`/` before `Buffer.from`)

### 4.4 `src/services/gemini-parser.js`

**Function: `parseExpensesBatch(emails)`**

Sends emails in batches to Gemini Flash (`gemini-2.5-flash`), `responseMimeType: 'application/json'`, `temperature: 0`. Each email is truncated to 1500 chars. Returns `null` expense for non-transaction emails.

**Returned expense object:**
```javascript
{
  amount: number,
  currency: string,           // 'INR', 'USD', etc.
  type: 'DR' | 'CR',
  merchant: string,
  date: string,               // 'YYYY-MM-DD'
  rawDescription: string,
  availableCreditLimit: number | null,
  accountType: string | null, // 'credit_card' | 'debit_card' | 'upi' | 'netbanking' | 'bank_transfer'
  accountLast4: string | null
}
```

### 4.5 `src/services/db.js`

Supabase client singleton:

```javascript
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(settings.supabaseUrl, settings.supabaseAnonKey);
module.exports = supabase;
```

All other services import this module rather than creating their own clients.

### 4.6 `src/services/db-writer.js`

**`insertExpense(row)`**
- UPSERT into `expenses` with `onConflict: 'email_id'` — idempotent
- Maps camelCase JS fields to snake_case DB columns

**`recategorizeUncategorized()`**
- Fetches all expenses where `category = 'Uncategorized'`
- Fetches all merchant_mappings where `category != 'Uncategorized'`
- UPDATEs matching expenses in a loop
- Returns count of rows updated

### 4.7 `src/services/db-merchant-mapper.js`

**`getCategory(merchantName)`**
- Normalizes merchant name (lowercase, trim, UPI VPA stripping)
- Checks in-process cache first
- On cache miss: SELECT from `merchant_mappings`
- If not found in DB: INSERT 'Uncategorized', return 'Uncategorized'
- Cache is loaded once per run and updated on writes

**`addMapping(merchantName, category)`**
- UPSERT into `merchant_mappings` with `onConflict: 'merchant'`
- Updates in-process cache

### 4.8 `src/index.js`

Main orchestrator:

```
async function main() {
  1. initDataDirectory()         — ensure data/ dir exists for OAuth files
  2. authorize()                 — get Gmail auth client
  3. fetchEmailIds()             — get email IDs from last N hours
  4. loadProcessedIds()          — SELECT email_id FROM processed_emails → Set
  5. filter new emails
  6. fetchEmailBody() (parallel) — fetch raw email bodies
  7. parseExpensesBatch()        — Gemini batch parse
  8. For each result:
     a. writeLog() if error/skip → INSERT into activity_logs
     b. getCategory()            → SELECT from merchant_mappings
     c. insertExpense()          → UPSERT into expenses
     d. saveProcessedId()        → INSERT into processed_emails
  9. recategorizeUncategorized() — bulk UPDATE expenses
  10. print summary
}
```

---

## 5. Database Tables (Supabase / PostgreSQL)

### `expenses`
| Column | Type | Notes |
|--------|------|-------|
| `id` | BIGSERIAL PK | Auto-increment |
| `email_id` | TEXT UNIQUE | Gmail message ID — dedup key |
| `label` | TEXT | Gmail label name |
| `date` | DATE | Transaction date |
| `amount` | NUMERIC(12,2) | Transaction amount |
| `currency` | CHAR(3) | ISO code, default 'INR' |
| `type` | CHAR(2) | 'DR' (debit) or 'CR' (credit) |
| `merchant` | TEXT | Merchant name |
| `category` | TEXT | From merchant_mappings |
| `raw_description` | TEXT | One-line summary from Gemini |
| `available_credit_limit` | NUMERIC(12,2) | nullable |
| `account_type` | TEXT | credit_card/debit_card/upi/etc |
| `account_last4` | TEXT | Last 4 digits, nullable |
| `created_at` | TIMESTAMPTZ | Auto-set |

### `processed_emails`
| Column | Type | Notes |
|--------|------|-------|
| `email_id` | TEXT PK | Gmail message ID |
| `processed_at` | TIMESTAMPTZ | Auto-set |

### `merchant_mappings`
| Column | Type | Notes |
|--------|------|-------|
| `merchant` | TEXT PK | Lowercase normalized merchant name |
| `category` | TEXT | e.g. 'Shopping', 'Transport', 'Uncategorized' |
| `updated_at` | TIMESTAMPTZ | Auto-set |

### `activity_logs`
| Column | Type | Notes |
|--------|------|-------|
| `id` | BIGSERIAL PK | Auto-increment |
| `logged_at` | TIMESTAMPTZ | Auto-set |
| `level` | TEXT | 'SKIP' or 'ERROR' |
| `email_id` | TEXT | Gmail message ID |
| `subject` | TEXT | Email subject |
| `detail` | TEXT | Reason / error message |

---

## 6. Prerequisites & Setup

### 6.1 Gemini API
1. Go to aistudio.google.com/apikey → Create API Key
2. Set `GEMINI_API_KEY` in `.env`

Free tier: 15 RPM, 1M tokens/day — more than enough.

### 6.2 Google Cloud (Gmail API)
1. console.cloud.google.com → Enable Gmail API
2. Credentials → Create OAuth 2.0 Client ID (Desktop App)
3. Download JSON → save as `data/credentials.json`

### 6.3 Supabase
1. Sign up at supabase.com → New project (free M0 equivalent, 500 MB)
2. SQL Editor → run CREATE TABLE statements (see README)
3. Project Settings → API → copy URL and anon key into `.env`

### 6.4 Node.js Dependencies
```json
{
  "dependencies": {
    "googleapis": "^131.0.0",
    "@google/genai": "latest",
    "@supabase/supabase-js": "^2.x",
    "dotenv": "latest"
  }
}
```

---

## 7. Error Handling

| Scenario | Behavior |
|----------|----------|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` missing | `db.js` throws at import time — process exits before main runs |
| Supabase insert fails | Throws; caught by main → logged to stderr, email marked processed |
| Gemini API key missing/invalid | Error logged → process exits |
| Gemini returns unparseable response | Logged to `activity_logs` as ERROR → skip email → continue |
| Gmail label not found | Returns `null` ID → skips that label, continues with others |
| Gmail auth expired | Auto-refresh. If refresh fails → re-run `npm run auth` |
| Duplicate email (already processed) | `processed_emails` check skips it before any API call |
| `activity_logs` insert fails | Non-fatal — logged to stderr, run continues |

---

## 8. Terminal Output Example

```
Fetching emails since 2026-03-29T00:00:00.000Z (last 24h)...
Found 6 email(s) in window.
2 new (unprocessed) email(s).
Fetching email bodies in parallel...

=== [19d013f11c7e3cd2] Subject: "Alert: ICICI Bank Credit Card" ===
...

  [19d013f11c7e3cd2] Logged: 2026-03-29 | DR | INR 1206 | REL RETAIL LTD TR | Shopping
  [19ce126f16e9f28c] Skipped (not a transaction): "OTP For online Ecom Transaction"

─── Summary ───────────────────────────────────
  Transactions logged : 1
  Non-transaction emails skipped : 1
  Parse / fetch errors : 0
  DB : https://xxxxxxxxxxxx.supabase.co
  Log : activity_logs table in Supabase
───────────────────────────────────────────────
```

---

## 9. Future Enhancements

- **Dashboard** — query Supabase via its auto-generated REST API or JS SDK from any frontend (React, Next.js). No backend needed — Supabase handles auth + API.
- **Accounting** — window functions in PostgreSQL make running totals, period-over-period comparisons, and budget tracking straightforward:
  ```sql
  SELECT date, amount,
    SUM(amount) OVER (PARTITION BY DATE_TRUNC('month', date) ORDER BY date) AS running_monthly_total
  FROM expenses WHERE type = 'DR';
  ```
- **Web UI for recategorization** — edit `merchant_mappings` rows in Supabase Table Editor or build a small React form that calls the Supabase JS SDK directly.
- **Auto-schedule** — cron job or Windows Task Scheduler to run `npm start` daily.
- **Telegram bot** — trigger sync + review unknowns via chat.
- **Refund tracking** — net out CR rows against DR rows for the same merchant.
