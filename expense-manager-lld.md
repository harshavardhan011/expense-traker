# Expense Manager — Low Level Design Document

## 1. Overview

A Node.js CLI tool that reads bank payment alert emails from Gmail, parses them using Google Gemini Flash API (free tier), auto-categorizes using a merchant mapping JSON, and logs expenses to a local CSV file. Designed to run manually from a laptop — daily or weekly.

---

## 2. System Flow

```
[You run: node src/index.js]
        │
        ▼
[Gmail API] ──► Fetch emails from configured labels (last N hours)
        │
        ▼
[Dedup Filter] ──► Skip already-processed emails (tracked by Gmail message ID)
        │
        ▼
[Gemini Parser] ──► Send raw email text to Gemini Flash API (free tier)
        │            Prompt: "Extract amount, merchant, date, type, reference as JSON"
        │            Returns: { amount, merchant, date, type, bank, reference }
        ▼
[Merchant Mapper] ──► Lookup merchant in merchant-mapping.json
        │               ├── Found: attach alias + category
        │               └── Not found: mark as "Uncategorized"
        ▼
[CSV Writer] ──► Append row to expenses.csv
        │
        ▼
[Terminal Summary] ──► Print what was logged + list unknowns
        │
        ▼
[Save State] ──► Update processed-emails.json
```

---

## 3. Project Structure

```
expense-manager/
├── src/
│   ├── index.js                # Main entry point — orchestrates the full flow
│   ├── auth.js                 # Google OAuth2 authentication
│   ├── config/
│   │   └── settings.js         # All configuration in one place
│   └── services/
│       ├── gmail-reader.js     # Gmail API integration
│       ├── gemini-parser.js    # Gemini Flash API for parsing emails
│       ├── merchant-mapper.js  # JSON-based merchant lookup
│       └── csv-writer.js       # Append transactions to CSV
├── data/
│   ├── merchant-mapping.json   # Merchant → alias + category map
│   ├── processed-emails.json   # Array of processed Gmail message IDs
│   └── expenses.csv            # The expense log (auto-created)
├── credentials.json            # Google OAuth creds (user provides)
├── token.json                  # Auto-generated after first auth
├── package.json
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
  gmailLabels: ['BankAlerts'],     // Gmail label names to scan
  fetchWindowHours: 24,            // How far back to fetch (24 = daily, 168 = weekly)

  // Gemini
  geminiApiKey: process.env.GEMINI_API_KEY || '',  // From env variable
  geminiModel: 'gemini-2.0-flash',                 // Free tier model

  // File paths
  csvFilePath: './data/expenses.csv',
  merchantMappingPath: './data/merchant-mapping.json',
  processedEmailsPath: './data/processed-emails.json',
  credentialsPath: './credentials.json',
  tokenPath: './token.json',
};
```

### 4.2 `src/auth.js`

Handles Google OAuth2 for Gmail API (read-only scope).

**Behavior:**
- If `token.json` exists and is valid → return auth client
- If token is expired → refresh it automatically
- If no token → open browser for OAuth consent, save token after approval
- Callback server on `http://localhost:3001/callback`

**Scopes needed:**
- `https://www.googleapis.com/auth/gmail.readonly`

**Dependencies:** `googleapis`

### 4.3 `src/services/gmail-reader.js`

**Class: `GmailReader`**

Constructor takes `auth` (OAuth2 client).

**Method: `fetchPaymentEmails()`**
- Iterates over each label in `settings.gmailLabels`
- For each label:
  - Resolve label name → label ID via `users.labels.list`
  - Query: `after:{epochSeconds}` where epoch = now - fetchWindowHours
  - Fetch full message for each result
- Extract from each email:
  - `id` (Gmail message ID — used for dedup)
  - `subject` (from headers)
  - `from` (from headers)
  - `date` (from headers)
  - `body` (decoded from payload)
- Body extraction: handle both `text/plain` and `text/html` parts. For HTML, strip tags to get plain text (use `cheerio`).
- Returns: `Array<{ id, subject, from, date, body }>`

### 4.4 `src/services/gemini-parser.js`

**This is the core module that replaces all bank-specific regex parsers.**

**Function: `parseEmails(emails)`**

Takes an array of email objects, returns parsed transactions.

**Strategy: One Gemini call per email** (not batched — simpler error handling, and 10 emails is trivial on free tier).

**Gemini API call:**
```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={API_KEY}
{
  "contents": [{
    "parts": [{ "text": "<the prompt below>" }]
  }],
  "generationConfig": {
    "responseMimeType": "application/json",
    "temperature": 0
  }
}
```

**Prompt template for each email:**

```
You are a transaction parser. Extract payment details from this Indian bank email alert.

Return ONLY a JSON object with these exact fields:
{
  "amount": <number, the debited amount in INR>,
  "merchant": "<string, the merchant/person name who received payment>",
  "date": "<string, transaction date in YYYY-MM-DD format>",
  "type": "<string, one of: UPI, Credit Card, UPI/Credit Card, Debit Card, NEFT, IMPS, RTGS, Other>",
  "bank": "<string, bank name like HDFC Bank, ICICI Bank, Standard Chartered>",
  "reference": "<string, transaction reference or UTR number, empty string if not found>"
}

Rules:
- "type" detection: If both "Credit Card" and "UPI" appear → "UPI/Credit Card". If only "Credit Card" → "Credit Card". If only "UPI" → "UPI". Check for NEFT/IMPS/RTGS/Debit Card/ATM keywords.
- "merchant" should be the human-readable name, not the VPA/UPI ID.
- If the email is a credit/refund (not a debit), return: { "skip": true }
- If you cannot parse the email, return: { "error": "reason" }

Email text:
---
{EMAIL_BODY}
---
```

**Response handling:**
- Parse JSON from Gemini response: `response.candidates[0].content.parts[0].text`
- If `skip: true` → ignore this email (it's a credit, not a debit)
- If `error` present → log warning, skip this email
- Validate: amount must be > 0, merchant must be non-empty
- If JSON parsing fails → log warning, skip email

**Rate limiting:** Gemini free tier allows 15 RPM (requests per minute). For 10 emails, no throttling needed. If future usage grows, add a 4-second delay between calls.

**Timeout:** 15 seconds per request.

**Returns:** `Array<{ amount, merchant, date, type, bank, reference, emailId }>`

### 4.5 `src/services/merchant-mapper.js`

**Class: `MerchantMapper`**

Loads `merchant-mapping.json` on construction.

**Mapping JSON structure:**
```json
{
  "karan sharma": { "alias": "Nashta Center", "category": "Food/Breakfast" },
  "yuvraj saudagar patange": { "alias": "Nashta Center", "category": "Food/Breakfast" },
  "swiggy": { "alias": "Swiggy", "category": "Food/Delivery" },
  "amazon": { "alias": "Amazon", "category": "Shopping/Online" }
}
```

**Method: `categorize(transaction)`**

Matching logic (case-insensitive):
1. Exact match: `normalized_merchant === key`
2. Partial match: `normalized_merchant.includes(key) || key.includes(normalized_merchant)`
3. No match → return with `category: "Uncategorized"`, `merchantAlias: ""`

Returns:
```javascript
{
  ...transaction,
  merchantAlias: "Nashta Center",   // or "" if unmapped
  category: "Food/Breakfast",       // or "Uncategorized"
  mapped: true                      // or false
}
```

**Method: `addMapping(rawMerchant, alias, category)`**
- Adds to in-memory map
- Saves to JSON file
- Used for future: when UI is built, this method is called from the API

### 4.6 `src/services/csv-writer.js`

**Function: `appendTransactions(transactions)`**

**CSV columns (in order):**
```
Date, Amount, Merchant (Raw), Merchant (Alias), Category, Payment Type, Bank, Reference
```

**Behavior:**
- If `expenses.csv` doesn't exist → create with header row
- If exists → append rows (no header)
- Use proper CSV escaping (fields with commas wrapped in quotes)
- Amount as plain number (no ₹ symbol — easier for formulas)
- Date in `YYYY-MM-DD` format

**No external dependency needed** — just `fs` with manual CSV formatting. Or use a tiny lib like `csv-stringify` if preferred.

### 4.7 `src/index.js`

**Main orchestrator.**

```
async function run() {
  1. Call authenticate() → get auth client
  2. Create GmailReader(auth) → call fetchPaymentEmails()
  3. Load processedEmailIds from processed-emails.json
  4. Filter out already-processed emails
  5. If no new emails → print "No new transactions" → exit
  6. Call parseEmails(newEmails) via gemini-parser
  7. Create MerchantMapper → categorize each transaction
  8. Call appendTransactions() via csv-writer
  9. Save updated processedEmailIds
  10. Print terminal summary:
      - List of logged transactions (amount, alias, category)
      - List of unknown merchants with a hint:
        "Unknown: YUVRAJ SAUDAGAR PATANGE (₹272) — add to data/merchant-mapping.json"
}
```

---

## 5. Data Files

### 5.1 `data/merchant-mapping.json`

Pre-seeded with common Indian merchants:

```json
{
  "swiggy": { "alias": "Swiggy", "category": "Food/Delivery" },
  "zomato": { "alias": "Zomato", "category": "Food/Delivery" },
  "amazon": { "alias": "Amazon", "category": "Shopping/Online" },
  "flipkart": { "alias": "Flipkart", "category": "Shopping/Online" },
  "uber": { "alias": "Uber", "category": "Transport/Cab" },
  "ola": { "alias": "Ola", "category": "Transport/Cab" },
  "rapido": { "alias": "Rapido", "category": "Transport/Auto" },
  "dmart": { "alias": "DMart", "category": "Groceries" },
  "bigbasket": { "alias": "BigBasket", "category": "Groceries" },
  "blinkit": { "alias": "Blinkit", "category": "Groceries" },
  "zepto": { "alias": "Zepto", "category": "Groceries" },
  "netflix": { "alias": "Netflix", "category": "Subscriptions" },
  "spotify": { "alias": "Spotify", "category": "Subscriptions" }
}
```

User manually adds entries like:
```json
"karan sharma": { "alias": "Nashta Center", "category": "Food/Breakfast" },
"yuvraj saudagar patange": { "alias": "Nashta Center", "category": "Food/Breakfast" }
```

### 5.2 `data/processed-emails.json`

Simple array of Gmail message IDs:
```json
["msg_abc123", "msg_def456", "msg_ghi789"]
```

### 5.3 `data/expenses.csv`

Example output:
```csv
Date,Amount,Merchant (Raw),Merchant (Alias),Category,Payment Type,Bank,Reference
2026-03-01,272,YUVRAJ SAUDAGAR PATANGE,Nashta Center,Food/Breakfast,UPI/Credit Card,HDFC Bank,293773719007
2026-03-01,499,SWIGGY,Swiggy,Food/Delivery,UPI,ICICI Bank,293773812345
2026-03-01,1500,SOME NEW MERCHANT,,Uncategorized,Credit Card,HDFC Bank,293774000001
```

---

## 6. Prerequisites & Setup

### 6.1 Gemini API Setup
```
1. Go to https://aistudio.google.com/apikey
2. Click "Create API Key"
3. Copy the key
4. Set it as environment variable:
   export GEMINI_API_KEY=your_key_here
   (Add to .bashrc / .zshrc for persistence)
```
Free tier limits (more than enough):
- 15 requests per minute
- 1 million tokens per day
- No billing account needed

### 6.2 Google Cloud Setup (Gmail API only)
1. Go to console.cloud.google.com
2. Create project → Enable "Gmail API"
3. Credentials → Create OAuth 2.0 Client ID (Desktop App type)
4. Download JSON → rename to `credentials.json` → place in project root

### 6.3 Node.js Dependencies
```json
{
  "dependencies": {
    "googleapis": "^131.0.0",
    "cheerio": "^1.0.0-rc.12"
  }
}
```

Note: No express, no cors, no heavy libs — MVP is minimal. `cheerio` is only needed if bank emails are HTML (most are). Gemini API is called via native `fetch` (Node 18+), no SDK needed.

---

## 7. Error Handling

| Scenario | Behavior |
|----------|----------|
| Gemini API key missing/invalid | Print: "GEMINI_API_KEY not set. Get one from https://aistudio.google.com/apikey" → exit |
| Gemini returns unparseable response | Log warning with email subject → skip that email → continue |
| Gemini returns `{ skip: true }` | Silently skip (it's a credit/refund email) |
| Gemini rate limit hit (15 RPM) | Wait 4 seconds → retry once → if still fails, skip with warning |
| Gmail label not found | Print warning → skip that label → continue with others |
| Gmail API auth expired | Auto-refresh token. If refresh fails → re-run `node src/auth.js` |
| CSV file locked (open in Excel) | Print error → suggest closing the file → exit |
| No new emails found | Print "No new transactions found" → exit cleanly |
| Duplicate email (already processed) | Silently skip via processed-emails.json check |

---

## 8. Terminal Output Example

```
💰 Expense Manager — Daily Sync
================================

🔐 Authenticating... ✓
📧 Fetching emails from label "BankAlerts"...
   Found 6 emails, 4 are new

🤖 Parsing with Gemini Flash...
   ✓ Parsed 4/4 transactions

🗂️  Categorizing...
   ✓ Auto-categorized: 3
   ❓ Unknown merchants: 1

📋 Logged Transactions:
──────────────────────────────────────────────────
  ₹272.00    │ Nashta Center        │ Food/Breakfast     │ UPI/Credit Card
  ₹499.00    │ Swiggy               │ Food/Delivery      │ UPI
  ₹150.00    │ Jio Recharge         │ Bills/Mobile       │ UPI

⚠️  Unknown Merchants (add to data/merchant-mapping.json):
──────────────────────────────────────────────────
  ₹1,500.00  │ SOME NEW MERCHANT    │ Uncategorized
  Hint: Add → "some new merchant": { "alias": "???", "category": "???" }

✅ Done! 4 transactions saved to data/expenses.csv
```

---

## 9. Future Enhancements (NOT in v1)

These are scoped out of MVP but documented for later:

- **v2: Web UI** — Express server + React frontend for categorizing unknowns visually
- **v3: Google Sheets sync** — dual-write to local CSV + Google Sheets
- **v4: Telegram bot** — trigger sync + categorize unknowns via chat
- **v5: Monthly reports** — category-wise totals, trends, budget alerts
- **v6: Auto-schedule** — cron job / system scheduler instead of manual trigger
- **v7: Refund tracking** — handle credit emails, net out refunds

---

## 10. Sample Bank Email Formats (Reference)

### HDFC — UPI via Credit Card
```
Dear Customer, Rs.272.00 has been debited from your HDFC Bank RuPay Credit Card XX8735
to Q051879601@ybl YUVRAJ SAUDAGAR PATANGE on 01-03-26.
Your UPI transaction reference number is 293773719007.
```

### HDFC — Regular UPI (expected format)
```
Dear Customer, Rs.150.00 has been debited from a/c **1234
to VPA merchant@upi MERCHANT NAME on 01-03-26.
UPI Ref No. 293773812345.
```

### ICICI — Credit Card (expected format)
```
Your ICICI Bank Credit Card XX5678 has been used for a transaction of
INR 1,500.00 at MERCHANT NAME on 01-03-2026. Ref No: 123456789.
```

(Add more samples as you discover them — the Ollama prompt handles any format)
