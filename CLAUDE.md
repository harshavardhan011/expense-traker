# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npm run auth         # one-time Gmail OAuth flow — creates data/token.json
npm start            # fetch + parse emails → append to data/expenses.csv
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
6. `src/index.js` — State saved **per-email** immediately after CSV write (not at end of run), so a crash mid-run doesn't cause duplicates on restart.

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
