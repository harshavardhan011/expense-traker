const { GoogleGenAI } = require('@google/genai');
const settings = require('../config/settings');

let aiClient = null;

function getClient() {
  if (!aiClient) {
    if (!settings.geminiApiKey) {
      throw new Error('GEMINI_API_KEY is not set in .env');
    }
    aiClient = new GoogleGenAI({ apiKey: settings.geminiApiKey });
  }
  return aiClient;
}

/**
 * Parse a batch of emails in a single Gemini call.
 * @param {Array<{ emailId: string, body: string, receivedAt: Date, subject: string }>} emails
 * @returns {Array<{ emailId: string, subject: string, expense: object|null }>}
 */
async function parseExpensesBatch(emails) {
  const ai = getClient();

  // Strip HTML and build per-email sections
  const prepared = emails.map(e => ({
    ...e,
    plainText: e.body || '',
    fallbackDate: e.receivedAt.toISOString().split('T')[0],
  }));

  const fallbackLines = prepared.map((e, i) => `- email_${i}: ${e.fallbackDate}`).join('\n');

  const emailSections = prepared
    .map((e, i) => `=== EMAIL ${i} ===\n${e.plainText.slice(0, 1500)}`)
    .join('\n\n');

  const prompt = `You are a financial data extractor. Process each email below and return a JSON array — one object per email, in the same order.
For each email return either:
{ "amount": <number>, "currency": "<3-letter ISO code>", "type": "<DR or CR>",
  "merchant": "<string or null>", "date": "<YYYY-MM-DD>",
  "rawDescription": "<one-line summary: card/account, amount, merchant, date — no limit figures>",
  "availableCreditLimit": <number or null>,
  "accountType": "<credit_card|debit_card|upi|netbanking|bank_transfer|null>",
  "accountLast4": "<last 4 digits of card/account number as a string, or null>" }
OR if not a transaction email:
{ "notATransaction": true, "rawDescription": "<full original text as-is>" }

Rules:
- type is "DR" if money left the account (debit/paid/withdrawn/spent/purchase), "CR" if money entered (credit/received/deposited/refund/reversal/cashback/chargeback)
- Reversals, refunds, cashbacks, and chargebacks ARE transactions — always return a transaction object for them (type "CR"), never mark them as notATransaction
- merchant may be null for bank-originated reversals (no merchant involved)
- rawDescription for transactions must be a concise one-line summary (card/account, amount, merchant, date). Never include credit limit, debit limit, or balance figures in rawDescription.
- availableCreditLimit: extract the available credit limit number (as a plain number, no currency symbol) if the email mentions it; otherwise null.
- accountType: classify as one of "credit_card", "debit_card", "upi", "netbanking", "bank_transfer". Use null if cannot be determined.
- accountLast4: the last 4 digits of the card/account number as a string (e.g. "4321"). Use null if not visible.
- Use these fallback dates when date is ambiguous or missing:
${fallbackLines}
Return ONLY a valid JSON array, no markdown, no explanation.

${emailSections}`;

  let raw;
  try {
    console.log(`Calling Gemini batch (${prepared.length} email(s))...`);
    const result = await ai.models.generateContent({
      model: settings.geminiModel,
      contents: [{ text: prompt }],
      config: { responseMimeType: 'application/json', temperature: 0 },
    });
    raw = result.candidates[0].content.parts[0].text;
  } catch (err) {
    console.error('Gemini batch API error:', err.message);
    // Return nulls for all emails in this batch so caller can handle errors
    return prepared.map(e => ({
      emailId: e.emailId,
      label: e.label,
      subject: e.subject,
      expense: null,
      geminiError: err.message,
    }));
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Response is not an array');
  } catch {
    console.error('Failed to parse Gemini batch response as JSON:', raw?.slice(0, 200));
    return prepared.map(e => ({ emailId: e.emailId, label: e.label, subject: e.subject, expense: null }));
  }

  return prepared.map((e, i) => {
    const item = parsed[i];
    if (!item || item.notATransaction || !item.amount || !item.currency) {
      return { emailId: e.emailId, label: e.label, subject: e.subject, expense: null };
    }
    return {
      emailId: e.emailId,
      label: e.label,
      subject: e.subject,
      expense: {
        amount: item.amount,
        currency: item.currency,
        type: item.type === 'CR' ? 'CR' : 'DR',
        merchant: item.merchant || 'Unknown',
        date: item.date || e.fallbackDate,
        rawDescription: item.rawDescription || '',
        availableCreditLimit: item.availableCreditLimit ?? null,
        accountType: item.accountType || null,
        accountLast4: item.accountLast4 ? String(item.accountLast4) : null,
      },
    };
  });
}

module.exports = { parseExpensesBatch };
