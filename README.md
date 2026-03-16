# Expense Manager CLI

Reads Gmail bank alert emails, parses transactions with Gemini, categorizes merchants, and logs to CSV.

## Prerequisites

- Node.js 22 LTS
- Google Cloud project with Gmail API enabled
- Gemini API key

## Setup

### 1. Install dependencies
```
npm install
```

### 2. Configure environment
```
cp .env.example .env
```
Edit `.env` and set your `GEMINI_API_KEY`.

### 3. Configure Gmail OAuth credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID for **Desktop app**
3. Download the JSON file and save it as `data/credentials.json`

### 4. Authenticate
```
npm run auth
```
A browser window will open. Complete the OAuth flow. `data/token.json` will be created.

### 5. Label your bank emails

In Gmail, create a label (e.g. `bank-alerts`) and apply it to your bank notification emails.
Set `GMAIL_LABEL=bank-alerts` in `.env` (or whatever label name you use).

### 6. Run
```
npm start
```

## Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | *(required)* | Your Gemini API key |
| `GMAIL_LABEL` | `bank-alerts` | Gmail label to filter emails |
| `FETCH_WINDOW_HOURS` | `24` | How many hours back to scan |

## Output

- `data/expenses.csv` — one row per transaction
- `data/processed-emails.json` — tracks processed email IDs (prevents duplicates)

## CSV Columns

`date, amount, currency, merchant, category, rawDescription, emailId`

## Merchant Categories

Edit `data/merchant-mapping.json` to add or update merchant→category mappings.
Keys are lowercase; matching is case-insensitive.

```json
{
  "swiggy": "Food & Dining",
  "amazon": "Shopping"
}
```

## Notes

- Emails already in `processed-emails.json` are skipped on re-runs (no duplicates)
- If `FETCH_WINDOW_HOURS=24` and you run weekly, emails older than 24h will be missed — increase the window accordingly
- Pagination is not implemented; a maximum of 100 emails per run are fetched
