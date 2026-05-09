# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npm run auth         # one-time Gmail OAuth flow — creates data/token.json
npm start            # fetch + parse emails → Supabase + update account balances
npm run cli -- account list            # list all accounts with balances
npm run cli -- account add             # add a new account (interactive)
npm run cli -- account add-funds 1482  # add funds to savings/salary account
npm run cli -- account pay 8735        # record a credit card bill payment
npm run cli -- account history 8735    # show transaction history
npm run cli -- account backfill 8735   # recalculate balance from existing expenses
```

No test runner or linter is configured.

## Architecture

Single-pass CLI pipeline in `src/index.js`:

```
Gmail API → email IDs → filter duplicates → fetch bodies (parallel) → Gemini batch → merchant map → CSV
```

**Data flow:**
1. `auth.js` — OAuth2 Desktop App flow. Uses `getFreePort()` so the redirect URI port is truly ephemeral (the `oauthRedirectPort` setting is not used). Redirect URI must use `127.0.0.1` (not `localhost`) to avoid IPv6 mismatch on Windows. Token cached in `data/token.json`; auto-refreshed if expired.
2. `services/gmail-reader.js` — Resolves each label name → ID at runtime (returns `null`, not `undefined`, if not found — avoids returning ALL messages). Supports multiple labels (`GMAIL_LABELS` comma-separated); deduplication is first-label-wins. Gmail `after:` query needs Unix **seconds** (divide `Date.now()` by 1000). Body extracted by walking the MIME tree: prefers `text/plain`, falls back to `text/html`. Gmail returns URL-safe base64; decode with `-`→`+`, `_`→`/` before `Buffer.from`.
3. `services/gemini-parser.js` — Uses `@google/genai` SDK (`GoogleGenAI`), model `gemini-2.5-flash`, `responseMimeType: 'application/json'`, `temperature: 0`. Emails are batched (controlled by `GEMINI_BATCH_SIZE`, default 20). Each email is truncated to 1500 chars before being sent. Returns `null` expense for non-transaction emails. Uses Gmail `receivedAt` as date fallback.
4. `services/merchant-mapper.js` — Looks up `data/merchant-mapping.json`. Both key and query are `.toLowerCase().trim()` before matching. Mapping is lazy-loaded and cached in-process.
5. `services/csv-writer.js` — Appends one row per transaction. `initCsv()` writes header if file missing.
6. `services/account-manager.js` — Account CRUD, balance updates, and expense-to-account linking. Uses `update_account_balance` Postgres RPC for atomic balance mutations. Finds accounts by `(account_type, account_last4)` with last4-only fallback for UPI/netbanking expenses linking to savings accounts.
7. `src/index.js` — State saved **per-email** immediately after DB write (not at end of run), so a crash mid-run doesn't cause duplicates on restart.
8. `src/cli.js` — Interactive CLI for account management (list, add, add-funds, pay, history, backfill). Uses Node.js `readline`.

## Configuration

All runtime config in `src/config/settings.js`. All file paths use `path.join(__dirname, ...)` — safe regardless of cwd.

Key `.env` variables:

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | *(required)* | Gemini API key |
| `GMAIL_LABELS` | `bank-alerts` | Comma-separated Gmail label names to scan |
| `GMAIL_LABEL` | — | Legacy alias for `GMAIL_LABELS` (single label) |
| `FETCH_WINDOW_HOURS` | `24` | How far back to scan; increase if running infrequently |
| `GEMINI_BATCH_SIZE` | `20` | Emails per Gemini API call |

## Data files (all in `data/`)

| File | Purpose |
|------|---------|
| `credentials.json` | OAuth client credentials (download from Google Cloud Console) |
| `token.json` | OAuth access + refresh token (auto-created by `npm run auth`) |
| `processed-emails.json` | Array of already-processed email IDs (dedup across runs) |
| `merchant-mapping.json` | `{ "merchant name lowercase": "Category" }` |
| `expenses.csv` | Output — one row per transaction |
| `activity.log` | Append-only log of skipped and errored emails |

**To re-process emails:** clear `processed-emails.json` to `[]` and increase `FETCH_WINDOW_HOURS`.

## Supabase tables

| Table | Purpose |
|-------|---------|
| `expenses` | Transaction records (one row per parsed email) |
| `processed_emails` | Deduplication state for email processing |
| `merchant_mappings` | Merchant → category lookup |
| `activity_logs` | Audit trail for skipped/errored emails |
| `accounts` | Bank accounts and credit cards with current balances |
| `account_transactions` | Audit trail for every account balance change |

**Accounts balance semantics:**
- **Credit cards**: `balance` = unbilled amount (positive = you owe). DR increases, CR/payment decreases.
- **Savings/salary**: `balance` = available funds (positive = you have). DR decreases, CR/manual credit increases.
- Linking: expenses match accounts by `(account_type, account_last4)` with last4-only fallback.
- Idempotent: `account_transactions.expense_id` prevents double-counting on re-runs.
- Atomic: `update_account_balance` RPC function handles UPDATE + INSERT in one transaction.

## Key design constraints

- `data/` dir and empty JSON files are created on first run by `initDataDirectory()` in `index.js` — no manual setup needed beyond credentials.
- Pagination not implemented; max 100 emails per label per run.
- `@google/genai` SDK (not the deprecated `@google/generative-ai`).
- Fetch-failed emails are marked processed immediately (same as parsed emails) to prevent infinite retry loops.

## Sensitive Files — Never Read

These files contain live credentials and secrets. Never read, grep, or glob them:

| File | Contains |
|------|----------|
| `.env`, `.env.*` | `GEMINI_API_KEY` and Gmail OAuth config |
| `data/credentials.json` | Google OAuth2 client secret |
| `data/token.json` | Live OAuth access + refresh tokens |
| `*.pem`, `*.key`, `*.p12`, `*.pfx` | Private keys / certificates |

Access is also blocked at the tool level by a global `PreToolUse` hook on Read, Grep, and Glob.
If you need to understand the `.env` structure, refer to `.env.example` instead.
