const { GoogleGenAI } = require('@google/genai');
const { load: cheerioLoad } = require('cheerio');
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
 * Strip HTML tags to plain text for cleaner Gemini input.
 * Only applied when body looks like HTML.
 */
function maybeStripHtml(body) {
  if (!body.trimStart().startsWith('<')) return body;
  const $ = cheerioLoad(body);
  return $.text().replace(/\s+/g, ' ').trim();
}

/**
 * Parse a batch of emails in a single Gemini call.
 * @param {Array<{ emailId: string, body: string, receivedAt: Date, subject: string }>} emails
 * @returns {Array<{ emailId: string, subject: string, expense: object|null }>}
 */
async function parseExpensesBatch(emails) {
  const ai = getClient();

  // Strip HTML and build per-email sections
  const prepared = emails.map((e) => ({
    ...e,
    plainText: maybeStripHtml(e.body || ''),
    fallbackDate: e.receivedAt.toISOString().split('T')[0],
  }));

  const fallbackLines = prepared
    .map((e, i) => `- email_${i}: ${e.fallbackDate}`)
    .join('\n');

  const emailSections = prepared
    .map((e, i) => `=== EMAIL ${i} ===\n${e.plainText.slice(0, 1500)}`)
    .join('\n\n');

  const prompt = `You are a financial data extractor. Process each email below and return a JSON array — one object per email, in the same order.

For each email return either:
{ "amount": <number>, "currency": "<3-letter ISO code>", "type": "<DR or CR>", "merchant": "<string or null>", "date": "<YYYY-MM-DD>", "rawDescription": "<string>" }
OR if not a transaction email:
{ "notATransaction": true }

Rules:
- type is "DR" if money left the account (debit/paid/withdrawn/spent/purchase), "CR" if money entered (credit/received/deposited/refund/cashback)
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
    return prepared.map((e) => ({ emailId: e.emailId, subject: e.subject, expense: null, geminiError: err.message }));
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Response is not an array');
  } catch {
    console.error('Failed to parse Gemini batch response as JSON:', raw?.slice(0, 200));
    return prepared.map((e) => ({ emailId: e.emailId, subject: e.subject, expense: null }));
  }

  return prepared.map((e, i) => {
    const item = parsed[i];
    if (!item || item.notATransaction || !item.amount || !item.currency) {
      return { emailId: e.emailId, subject: e.subject, expense: null };
    }
    return {
      emailId: e.emailId,
      subject: e.subject,
      expense: {
        amount: item.amount,
        currency: item.currency,
        type: item.type === 'CR' ? 'CR' : 'DR',
        merchant: item.merchant || 'Unknown',
        date: item.date || e.fallbackDate,
        rawDescription: item.rawDescription || '',
      },
    };
  });
}

module.exports = { parseExpensesBatch };
