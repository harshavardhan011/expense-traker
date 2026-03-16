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
Gmail API → email IDs → filter duplicates → fetch bodies → Gemini → merchant map → CSV
```

**Data flow:**
1. `auth.js` — OAuth2 Desktop App flow. Uses ephemeral port (`getFreePort`) so redirect URI is built at runtime. Redirect URI must use `127.0.0.1` (not `localhost`) to avoid IPv6 mismatch on Windows. Token cached in `data/token.json`; auto-refreshed if expired.
2. `services/gmail-reader.js` — Resolves label name → ID at runtime (null if missing, not undefined — avoids returning ALL messages). Gmail `after:` query needs Unix **seconds** (divide `Date.now()` by 1000). Body extracted by walking the MIME tree: prefers `text/plain`, falls back to `text/html`. Gmail returns URL-safe base64; decode with `-`→`+`, `_`→`/` before `Buffer.from`.
3. `services/gemini-parser.js` — Uses `@google/genai` SDK (`GoogleGenAI`), model `gemini-2.5-flash`, `responseMimeType: 'application/json'`, `temperature: 0`. Strips HTML via cheerio before sending. Returns `null` for non-transaction emails. Uses Gmail `receivedAt` as date fallback.
4. `services/merchant-mapper.js` — Looks up `data/merchant-mapping.json`. Both key and query are `.toLowerCase().trim()` before matching.
5. `services/csv-writer.js` — Appends one row per transaction. `initCsv()` writes header if file missing.
6. `src/index.js` — State saved **per-email** immediately after CSV write (not at end of run), so a crash mid-run doesn't cause duplicates on restart.

## Configuration

All runtime config in `src/config/settings.js`. All file paths use `path.join(__dirname, ...)` — safe regardless of cwd.

Key `.env` variables:
- `GEMINI_API_KEY` — required
- `GMAIL_LABEL` — Gmail label name (e.g. `ICICI transactions`)
- `FETCH_WINDOW_HOURS` — how far back to scan (default `24`; increase if running infrequently)

## Data files (all in `data/`)

| File | Purpose |
|------|---------|
| `credentials.json` | OAuth client credentials (download from Google Cloud Console) |
| `token.json` | OAuth access + refresh token (auto-created by `npm run auth`) |
| `processed-emails.json` | Array of already-processed email IDs (dedup across runs) |
| `merchant-mapping.json` | `{ "merchant name lowercase": "Category" }` |
| `expenses.csv` | Output — one row per transaction |

**To re-process emails:** clear `processed-emails.json` to `[]` and increase `FETCH_WINDOW_HOURS`.

## Key design constraints

- `data/` dir and empty JSON files are created on first run by `initDataDirectory()` in `index.js` — no manual setup needed beyond credentials.
- Pagination not implemented; max 100 emails per run (`maxResults: 100`).
- `@google/genai` SDK (not the deprecated `@google/generative-ai`).
