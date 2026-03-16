const { google } = require('googleapis');
const settings = require('../config/settings');

/**
 * Resolve a Gmail label name to its ID.
 * Returns null (not undefined) if not found, so callers can handle it explicitly.
 */
async function resolveLabelId(gmail, labelName) {
  const res = await gmail.users.labels.list({ userId: 'me' });
  const labels = res.data.labels || [];
  const match = labels.find(
    (l) => l.name.toLowerCase() === labelName.toLowerCase()
  );
  if (!match) {
    console.warn(`Warning: Gmail label "${labelName}" not found. Skipping label filter.`);
    return null;
  }
  return match.id;
}

/**
 * Fetch unread bank-alert email IDs since the given cutoff time.
 * @param {object} auth - OAuth2 client
 * @param {Date} since - fetch emails after this date
 * @returns {string[]} list of message IDs
 */
async function fetchEmailIds(auth, since) {
  const gmail = google.gmail({ version: 'v1', auth });

  // Gmail `after:` expects Unix seconds, not milliseconds
  const afterSeconds = Math.floor(since.getTime() / 1000);

  let query = `after:${afterSeconds}`;

  const labelId = await resolveLabelId(gmail, settings.gmailLabel);
  const labelIds = labelId ? [labelId] : [];
  // If label not found, we don't add it — avoids returning ALL messages

  const res = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    ...(labelIds.length > 0 ? { labelIds } : {}),
    maxResults: 100, // pagination out of scope for v1
  });

  const messages = res.data.messages || [];
  return messages.map((m) => m.id);
}

/**
 * Fetch full message and extract plain-text body.
 * Handles multipart/alternative MIME trees: prefers text/plain, falls back to text/html.
 * @param {object} auth - OAuth2 client
 * @param {string} messageId
 * @returns {{ body: string, receivedAt: Date, subject: string }}
 */
async function fetchEmailBody(auth, messageId) {
  const gmail = google.gmail({ version: 'v1', auth });
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const message = res.data;
  const headers = message.payload.headers || [];
  const subject = (headers.find((h) => h.name.toLowerCase() === 'subject') || {}).value || '';

  // Gmail internalDate is Unix milliseconds as a string
  const receivedAt = new Date(parseInt(message.internalDate, 10));

  const body = extractBody(message.payload);

  return { body, receivedAt, subject };
}

/**
 * Walk the MIME tree to extract body text.
 * Priority: text/plain > text/html (decoded from HTML to plain text).
 * Returns empty string if neither part is found.
 * @param {object} part - Gmail message part
 * @returns {string}
 */
function extractBody(part) {
  // Direct text/plain
  if (part.mimeType === 'text/plain' && part.body && part.body.data) {
    return decodeBase64(part.body.data);
  }

  // For text/html, decode but return as-is (gemini-parser will handle it)
  if (part.mimeType === 'text/html' && part.body && part.body.data) {
    return decodeBase64(part.body.data);
  }

  // Walk nested parts (multipart/alternative, multipart/mixed, etc.)
  if (part.parts && part.parts.length > 0) {
    let htmlFallback = '';
    for (const subpart of part.parts) {
      const result = extractBody(subpart);
      if (result) {
        // Prefer plain text: if this part is plain, return immediately
        if (subpart.mimeType === 'text/plain' || isNestedPlain(subpart)) {
          return result;
        }
        // Keep HTML as fallback
        if (!htmlFallback) {
          htmlFallback = result;
        }
      }
    }
    return htmlFallback;
  }

  return '';
}

/**
 * Returns true if any descendant of this part is text/plain.
 */
function isNestedPlain(part) {
  if (part.mimeType === 'text/plain') return true;
  if (part.parts) return part.parts.some(isNestedPlain);
  return false;
}

/**
 * Decode URL-safe base64 (as returned by Gmail API) to UTF-8 string.
 */
function decodeBase64(data) {
  // Gmail uses URL-safe base64: replace - with + and _ with /
  const standard = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(standard, 'base64').toString('utf8');
}

module.exports = { fetchEmailIds, fetchEmailBody };
