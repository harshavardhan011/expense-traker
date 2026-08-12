# Expense Manager — Low Level Design Document

## 1. Overview

A Node.js application that reads bank payment alert emails from Gmail, parses them using Google Gemini Flash API, auto-categorizes using a merchant mapping table, and stores all expense and account data to a local PostgreSQL database.

The app has two entry points that share the same core pipeline:

- **`src/server.js`** — Express HTTP API server (primary). Exposes REST endpoints so any UI can connect. Runs persistently with `npm run server`.
- **`src/index.js`** — One-shot script wrapper (kept for cron/manual use). Calls `runSync()` and exits. Runs with `npm start`.

All persistent state lives in local PostgreSQL. Only OAuth credential files remain outside the database.

---

## 2. System Flow

### 2.1 HTTP Server path

```
[Client] ──► POST /sync
                │
                ▼
         [src/server.js]
         Concurrency lock (409 if already running)
                │
                ▼
         [src/pipeline.js → runSync()]
                │
                ▼
         (same pipeline as below)
                │
                ▼
         Returns { parsed, skipped, errors, recategorized }
```

### 2.2 Core sync pipeline (pipeline.js)

```
[runSync()]
        │
        ▼
[initDataDirectory()] ──► ensure data/ dir exists for OAuth files
        │
        ▼
[bootstrapSchema()] ──► apply db/schema.sql via pg (idempotent)
        │
        ▼
[authorize()] ──► get Gmail auth client from token.json
        │
        ▼
[Gmail API] ──► fetch email IDs from configured labels (last N hours)
        │
        ▼
[Dedup Filter] ──► skip already-processed email IDs
        │            (SELECT from processed_emails table)
        ▼
[fetchEmailBody()] (parallel) ──► fetch raw email bodies
        │
        ▼
[Gemini Parser] ──► batch send to Gemini Flash API
        │            returns { amount, merchant, date, type, currency, ... }
        ▼
[Merchant Mapper] ──► SELECT from merchant_mappings (in-process cache)
        │               ├── found: return category
        │               └── not found: INSERT 'Uncategorized'
        ▼
[DB Writer] ──► UPSERT into expenses table
        │
        ▼
[Account Manager] ──► recordExpenseImpact()
        │               find matching account by (type, last4)
        │               call update_account_balance RPC (atomic)
        ▼
[Save State] ──► INSERT email_id into processed_emails (per-email, not end-of-run)
        │
        ▼
[Recategorize] ──► UPDATE expenses SET category=... WHERE category='Uncategorized'
        │
        ▼
Returns stats object: { parsed, skipped, errors, recategorized }
```

---

## 3. Project Structure

```
expense-manager/
├── src/
│   ├── index.js                    # Thin wrapper — calls runSync(), exits (npm start)
│   ├── server.js                   # Express HTTP API server (npm run server)
│   ├── pipeline.js                 # Core sync logic — exports runSync()
│   ├── auth.js                     # Google OAuth2 authentication
│   ├── config/
│   │   └── settings.js             # All configuration in one place
│   └── services/
│       ├── db.js                   # pg Pool + query/queryOne/withTransaction helpers
│       ├── db-bootstrap.js         # Applies db/schema.sql via raw pg connection
│       ├── db-writer.js            # Insert/upsert expenses into PostgreSQL
│       ├── db-merchant-mapper.js   # DB-backed merchant lookup + in-process cache
│       ├── account-manager.js      # Account CRUD + balance operations (Postgres function)
│       ├── expense-reader.js       # Read-only queries for expenses table
│       ├── expense-writer.js       # Per-expense field updates (e.g. notes)
│       ├── category-service.js     # Category listing/stats, merchant categorization, rename/delete
│       ├── gmail-reader.js         # Gmail API integration
│       ├── gemini-parser.js        # Gemini Flash API for parsing emails
│       ├── csv-writer.js           # [DEPRECATED — replaced by db-writer.js]
│       └── merchant-mapper.js      # [DEPRECATED — replaced by db-merchant-mapper.js]
├── db/
│   └── schema.sql                  # Single source of truth for all tables + functions
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

Exports a single config object read from environment variables:

```javascript
module.exports = {
  gmailLabels: ['bank-alerts'],        // from GMAIL_LABELS env var (comma-separated)
  fetchWindowHours: 24,                // from FETCH_WINDOW_HOURS
  overlapBufferMinutes: 10,            // overlap to avoid missing emails at window edge
  processedEmailsRetentionHours: 48,   // how long to keep processed_emails rows
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: 'gemini-2.5-flash',
  geminiBatchSize: 20,
  databaseUrl: process.env.DATABASE_URL,
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
- Redirect URI: `http://127.0.0.1:<ephemeral_port>/callback` (port chosen at runtime via `getFreePort()`)
- Must use `127.0.0.1` (not `localhost`) to avoid IPv6 mismatch on Windows

**Scopes:** `https://www.googleapis.com/auth/gmail.readonly`

### 4.3 `src/services/gmail-reader.js`

**`fetchEmailIds(auth, since, labelNames)`** → `{ items: [{id}], labelIdToName: Map }`
**`fetchEmailBody(auth, emailId)`** → `{ body, receivedAt, subject, labelIds }`
**`resolveLabelName(msgLabelIds, labelIdToName, gmailLabels)`** → `string`

- Resolves each label name → label ID at runtime via `users.labels.list`
- `after:` query uses Unix seconds (divide `Date.now()` by 1000)
- Body: walks MIME tree, prefers `text/plain`, falls back to `text/html`
- Gmail returns URL-safe base64 — decode with `-`→`+`, `_`→`/` before `Buffer.from`

### 4.4 `src/services/gemini-parser.js`

**`parseExpensesBatch(emails)`** → `Array<{ emailId, label, subject, expense|null, geminiError? }>`

Sends emails in batches to Gemini Flash (`gemini-2.5-flash`), `responseMimeType: 'application/json'`, `temperature: 0`. Each email truncated to 1500 chars. Returns `null` expense for non-transaction emails.

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

`pg` Pool + query helpers shared by all services:

```javascript
const { Pool } = require('pg');
const pool = new Pool({ connectionString: settings.databaseUrl });

async function query(text, params) { /* returns res.rows */ }
async function queryOne(text, params) { /* returns res.rows[0] ?? null */ }
async function withTransaction(fn) { /* BEGIN/COMMIT/ROLLBACK wrapper */ }

module.exports = { pool, query, queryOne, withTransaction };
```

Throws at import time if `DATABASE_URL` is missing.

### 4.6 `src/services/db-bootstrap.js`

**`bootstrapSchema()`** — reads `db/schema.sql` and executes it via a raw `pg` client using `DATABASE_URL`. All DDL uses `CREATE TABLE IF NOT EXISTS` / `CREATE OR REPLACE FUNCTION` — idempotent, safe to run on every startup. Called by both `server.js` (on listen) and `pipeline.js` (on each sync run).

### 4.7 `src/services/db-writer.js`

**`insertExpense(row)`**
- UPSERT into `expenses` with `onConflict: 'email_id'` — idempotent
- After insert, calls `recordExpenseImpact(row, expenseId)` to update account balance

**`recategorizeUncategorized()`**
- Fetches expenses where `category = 'Uncategorized'`
- Fetches merchant_mappings where `category != 'Uncategorized'`
- UPDATEs matching expenses; returns updated count

### 4.8 `src/services/db-merchant-mapper.js`

**`getCategory(merchantName)`**
- Normalizes merchant name (lowercase, trim, UPI VPA stripping)
- Checks in-process cache → on miss: SELECT from `merchant_mappings`
- If not found in DB: INSERT 'Uncategorized'

**`addMapping(merchantName, category)`**
- UPSERT into `merchant_mappings`; updates in-process cache

### 4.9 `src/services/account-manager.js`

Account CRUD and balance management. All functions return data or throw — no `process.exit` or console output (except non-fatal `console.warn`).

| Function | Signature | Description |
|----------|-----------|-------------|
| `createAccount` | `({ name, accountType, accountLast4, currency, balance, creditLimit })` | Insert account; record opening_balance txn if balance ≠ 0 |
| `listAccounts` | `({ activeOnly=true })` | SELECT all (or active) accounts |
| `findAccount` | `(accountType, accountLast4)` | Exact match; falls back to last4-only for savings/UPI linking |
| `getAccountById` | `(id)` | SELECT by PK |
| `resolveAccount` | `(identifier)` | By ID (>9999) or last4; returns array (ambiguity-safe) |
| `recordExpenseImpact` | `(expenseRow, expenseId)` | Links expense to account; calls `update_account_balance` function |
| `addFunds` | `(accountId, amount, description)` | `manual_credit` delta |
| `recordPayment` | `(accountId, amount, description)` | `payment` negative delta |
| `getAccountTransactions` | `(accountId, limit=20)` | SELECT from account_transactions, newest first |
| `backfillAccountBalance` | `(accountId)` | Re-run all linked expenses through `update_account_balance`; returns `{ balance, expensesLinked }` |

**Balance semantics:**
- Credit card: DR → +delta (owe more), CR/payment → −delta (owe less)
- Savings/salary: DR → −delta (funds leave), CR/manual_credit → +delta (funds arrive)

**`update_account_balance` Postgres function** — atomically updates `accounts.balance += p_delta` and inserts an `account_transactions` row; returns new balance.

### 4.10 `src/services/expense-reader.js`

Read-only queries for the `expenses` table, used by the HTTP server.

**`listExpenses({ limit=50, offset=0, category, accountLast4 })`** → `Array<expense>`
- Orders by `created_at DESC`; supports `category` and `accountLast4` filters
- Pagination via `.range(offset, offset+limit-1)`

**`getExpenseById(id)`** → `expense`

### 4.10a `src/services/expense-writer.js`

Per-expense field updates (the only true single-row write path; everything else is bulk via category/merchant operations).

**`updateExpenseNotes(id, notes)`** → `expense` — `UPDATE expenses SET notes = ? WHERE id = ?`, returns the updated row.

### 4.10b `src/services/category-service.js`

Category-level read/write operations. Note: categories are not a dedicated table — they exist only as text on `expenses.category` and `merchant_mappings.category`.

| Function | Signature | Description |
|----------|-----------|-------------|
| `listUncategorizedMerchants` | `()` | Aggregates expenses with `category='Uncategorized'` by merchant → `{merchant, count, total}[]` |
| `listCategories` | `()` | Distinct non-Uncategorized categories from both `expenses` and `merchant_mappings` |
| `listCategoriesWithCounts` | `()` | Same as above but with usage count per category (mapping-only categories show count 0) |
| `setMerchantCategory` | `(merchant, category)` | Adds/updates a `merchant_mappings` row, then recategorizes existing Uncategorized expenses |
| `renameCategory` | `(from, to)` | Bulk-updates `category` on both `expenses` and `merchant_mappings`; returns `{ updated }` (expense rows touched) |
| `deleteCategory` | `(name)` | Sets matching `expenses.category` to `'Uncategorized'`; deletes matching `merchant_mappings` rows so those merchants resurface for recategorization; returns `{ reassigned }` |

Preset vs. custom categories is a **frontend-only** concept (`frontend/src/lib/categories.ts`) — these backend functions operate on any category name.

### 4.11 `src/pipeline.js`

Core sync orchestrator. Exports `runSync()`.

```
async function runSync() {
  1. initDataDirectory()          — ensure data/ dir exists
  2. bootstrapSchema()            — apply schema.sql (throws on failure)
  3. authorize()                  — get Gmail auth client (throws on failure)
  4. pruneProcessedIds()          — delete stale processed_emails rows
  5. getLastRunCutoff()           — determine since cutoff from DB or FETCH_WINDOW_HOURS
  6. fetchEmailIds()              — get email IDs (throws on failure)
  7. loadProcessedIds()           — build dedup Set from processed_emails
  8. fetchEmailBody() (parallel)  — fetch raw bodies; mark fetch-failed as processed
  9. parseExpensesBatch() (chunks)— Gemini batch parse
  10. For each result:
      a. geminiError → writeLog(ERROR); continue (not marked processed — retry next run)
      b. no expense  → writeLog(SKIP); saveProcessedId(); continue
      c. has expense → getCategory() → insertExpense() → saveProcessedId()
  11. recategorizeUncategorized()
  12. return { parsed, skipped, errors, recategorized }
}
```

State is saved **per-email** immediately after DB write — a crash mid-run won't cause duplicates on restart.

### 4.12 `src/server.js`

Express app. All routes use an `asyncHandler` wrapper so thrown errors reach the error middleware.

```javascript
const ah = fn => (req, res, next) => fn(req, res, next).catch(next);
```

**Concurrency guard for `/sync`:**
```javascript
let syncRunning = false;
// POST /sync: if (syncRunning) → 409; else set flag, run, clear flag in finally
```

**Error middleware:** maps any thrown `Error` to `{ error: err.message }` with status 500.

**Startup:** calls `bootstrapSchema()` before `app.listen()`.

### 4.13 `src/index.js`

Thin script wrapper:

```javascript
const { runSync } = require('./pipeline');
runSync()
  .then(stats => { console.log('Summary:', stats); process.exit(0); })
  .catch(err => { console.error('Unexpected error:', err); process.exit(1); });
```

---

## 5. HTTP API Reference

Base URL: `http://localhost:3000` (configurable via `PORT` env var)

| Method | Path | Body / Query | Response |
|--------|------|--------------|----------|
| GET | `/health` | — | `{ ok: true }` |
| GET | `/accounts` | `?activeOnly=true\|false` | `Array<account>` |
| POST | `/accounts` | `{ name, accountType, accountLast4, currency?, balance?, creditLimit? }` | `{ id, balance }` |
| GET | `/accounts/:id` | — | `account` |
| GET | `/accounts/:id/transactions` | `?limit=20` | `Array<txn>` |
| POST | `/accounts/:id/add-funds` | `{ amount, description? }` | `{ balance }` |
| POST | `/accounts/:id/pay` | `{ amount, description? }` | `{ balance }` |
| POST | `/accounts/:id/backfill` | — | `{ balance, expensesLinked }` |
| GET | `/expenses` | `?limit=50&offset=0&category=&accountLast4=` | `Array<expense>` |
| GET | `/expenses/:id` | — | `expense` |
| PATCH | `/expenses/:id` | `{ notes }` | `expense` (updated row) |
| GET | `/categories` | — | `Array<string>` |
| GET | `/categories/stats` | — | `Array<{ category, count }>` |
| GET | `/merchants/uncategorized` | — | `Array<{ merchant, count, total }>` |
| POST | `/merchant-mappings` | `{ merchant, category }` | `{ recategorized }` |
| POST | `/categories/rename` | `{ from, to }` | `{ updated }` |
| POST | `/categories/delete` | `{ name }` | `{ reassigned }` |
| POST | `/sync` | — | `{ parsed, skipped, errors, recategorized }` or `409` |

---

## 6. Database Tables (PostgreSQL)

Schema source of truth: `db/schema.sql`. Applied automatically on startup.

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
| `account_type` | TEXT | credit_card / debit_card / upi / netbanking / bank_transfer |
| `account_last4` | TEXT | Last 4 digits, nullable |
| `notes` | TEXT | User-editable annotation, nullable. Set via `PATCH /expenses/:id`; never written by the sync pipeline, so it survives upserts on re-sync |
| `created_at` | TIMESTAMPTZ | Auto-set |

### `processed_emails`
| Column | Type | Notes |
|--------|------|-------|
| `email_id` | TEXT PK | Gmail message ID |
| `processed_at` | TIMESTAMPTZ | Indexed — used for cutoff queries and pruning |

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
| `level` | TEXT | 'SKIP' or 'ERROR' |
| `email_id` | TEXT | Gmail message ID |
| `subject` | TEXT | Email subject |
| `detail` | TEXT | Reason / error message |
| `created_at` | TIMESTAMPTZ | Auto-set |

### `accounts`
| Column | Type | Notes |
|--------|------|-------|
| `id` | BIGSERIAL PK | Auto-increment |
| `name` | TEXT | Display name |
| `account_type` | TEXT | credit_card / savings / salary / debit_card |
| `account_last4` | TEXT | Last 4 digits |
| `currency` | CHAR(3) | Default 'INR' |
| `balance` | NUMERIC(12,2) | Current balance |
| `credit_limit` | NUMERIC(12,2) | nullable — credit cards only |
| `is_active` | BOOLEAN | Default true |
| `created_at` | TIMESTAMPTZ | Auto-set |
| `updated_at` | TIMESTAMPTZ | Auto-set |

UNIQUE constraint on `(account_type, account_last4)`.

### `account_transactions`
| Column | Type | Notes |
|--------|------|-------|
| `id` | BIGSERIAL PK | Auto-increment |
| `account_id` | BIGINT FK | → accounts.id |
| `type` | TEXT | expense_dr / expense_cr / manual_credit / manual_debit / payment / opening_balance |
| `amount` | NUMERIC(12,2) | Absolute amount |
| `balance_after` | NUMERIC(12,2) | Account balance after this txn |
| `description` | TEXT | Human-readable detail |
| `expense_id` | BIGINT FK | → expenses.id (nullable) — idempotency key |
| `created_at` | TIMESTAMPTZ | Indexed |

### `update_account_balance` function
```sql
update_account_balance(
  p_account_id  BIGINT,
  p_delta       NUMERIC,
  p_txn_type    TEXT,
  p_description TEXT    DEFAULT NULL,
  p_expense_id  BIGINT  DEFAULT NULL
) RETURNS NUMERIC
```
Atomically: `UPDATE accounts SET balance += p_delta`, inserts `account_transactions` row, returns new balance. Raises exception if account not found. The `expense_id` FK prevents double-counting on re-runs.

---

## 7. Prerequisites & Setup

### 7.1 Gemini API
1. Go to aistudio.google.com/apikey → Create API Key
2. Set `GEMINI_API_KEY` in `.env`

Free tier: 15 RPM, 1M tokens/day — sufficient for personal use.

### 7.2 Google Cloud (Gmail API)
1. console.cloud.google.com → Enable Gmail API
2. Credentials → Create OAuth 2.0 Client ID (Desktop App)
3. Download JSON → save as `data/credentials.json`
4. Run `npm run auth` once to generate `data/token.json`

### 7.3 PostgreSQL
1. Install PostgreSQL locally and ensure the server is running
2. Create a database: `createdb expense_tracker`
3. Set `DATABASE_URL` in `.env` (required — used for all queries and schema bootstrap via `pg`)

### 7.4 Node.js Dependencies
```json
{
  "dependencies": {
    "express": "^4.x",
    "googleapis": "^171.x",
    "@google/genai": "^1.x",
    "pg": "^8.x",
    "dotenv": "^16.x",
    "cheerio": "^1.x"
  }
}
```

---

## 8. Error Handling

| Scenario | Behavior |
|----------|----------|
| `DATABASE_URL` missing | `db.js` throws at import — process exits before startup |
| Schema bootstrap fails | `runSync()` throws; server returns 500; script exits 1 |
| `authorize()` fails | `runSync()` throws — token missing or unrefreshable; re-run `npm run auth` |
| Gemini API error | Logged to `activity_logs` as ERROR; email **not** marked processed (retried next run) |
| Gmail fetch error | Email marked processed immediately (no infinite retry); logged as ERROR |
| Gmail label not found | Returns `null` ID → skips that label, continues with others |
| Postgres insert fails | Throws; caught in pipeline → logged, email skipped |
| `activity_logs` insert fails | Non-fatal — logged to stderr, run continues |
| `/sync` called while running | Returns `409 { error: 'sync already in progress' }` |
| Invalid `amount` on add-funds/pay | Returns `400 { error: 'amount must be a positive number' }` |
| Account not found | `account-manager.js` throws; server returns `500 { error }` |

---

## 9. Future Enhancements

- **Full CLI → HTTP migration** — `src/cli.js` is a temporary parallel path; all account management will move to HTTP endpoints once a UI is connected.
- **Frontend UI** — connect a React/Next.js dashboard to the REST API (`GET /expenses`, `GET /accounts`, `POST /sync`).
- **Scheduled sync** — add an internal `setInterval` in `server.js` to auto-run `runSync()` every N hours, or expose a cron endpoint.
- **Auth middleware** — add an API key or JWT check to the Express routes before exposing the server externally.
- **Pagination metadata** — return `{ data, total, offset, limit }` from `GET /expenses` for cursor-based UI pagination.
- **Refund tracking** — net out CR rows against DR rows for the same merchant.
- **Telegram bot** — trigger sync + review unknowns via chat using the same `runSync()` export.
