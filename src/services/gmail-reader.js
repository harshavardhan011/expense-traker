const { google } = require('googleapis');
const { load: cheerioLoad } = require('cheerio');

// In-process cache: labelName.toLowerCase() → labelId | null
// Cleared on process restart. Eliminates redundant labels.list calls within a run.
const labelIdCache = new Map();

async function populateLabelCache(gmail) {
  const res = await gmail.users.labels.list({ userId: 'me' });
  for (const l of (res.data.labels || [])) {
    labelIdCache.set(l.name.toLowerCase(), l.id);
  }
}

/**
 * Resolve label names → IDs using a single labels.list call (cached in-process).
 * Returns { resolved: [{name, id}], labelIdToName: Map<labelId, labelName> }.
 */
async function resolveLabels(gmail, labelNames) {
  const uncached = labelNames.filter(n => !labelIdCache.has(n.toLowerCase()));
  if (uncached.length > 0) {
    await populateLabelCache(gmail);
  }

  const labelIdToName = new Map();
  const resolved = [];
  for (const name of labelNames) {
    const id = labelIdCache.get(name.toLowerCase()) ?? null;
    if (!id) {
      console.warn(`Warning: Gmail label "${name}" not found. Skipping.`);
      continue;
    }
    labelIdToName.set(id, name);
    resolved.push({ name, id });
  }
  return { resolved, labelIdToName };
}

/**
 * Resolve the configured label name for a message from its raw labelIds.
 * First match in gmailLabels order wins (preserves first-label-wins behaviour).
 */
function resolveLabelName(msgLabelIds, labelIdToName, gmailLabels) {
  for (const configuredName of gmailLabels) {
    for (const id of msgLabelIds) {
      if (labelIdToName.get(id) === configuredName) return configuredName;
    }
  }
  return gmailLabels[0] || 'unknown';
}

/**
 * Fetch email IDs since the given cutoff across multiple labels using a single
 * combined messages.list query. Returns { items: [{id}], labelIdToName }.
 * Label attribution is deferred to fetchEmailBody (which returns labelIds).
 */
async function fetchEmailIds(auth, since, labelNames) {
  const gmail = google.gmail({ version: 'v1', auth });
  const afterSeconds = Math.floor(since.getTime() / 1000);

  const { resolved, labelIdToName } = await resolveLabels(gmail, labelNames);
  if (resolved.length === 0) return { items: [], labelIdToName };

  let q;
  let listParams = { userId: 'me', maxResults: 100 };

  if (resolved.length === 1) {
    // Single label: use labelIds filter (server-optimised) + time query
    q = `after:${afterSeconds}`;
    listParams.labelIds = [resolved[0].id];
  } else {
    // Multiple labels: one combined query — Gmail supports label: operator with OR
    const labelClause = resolved.map(l => `label:"${l.name}"`).join(' OR ');
    q = `after:${afterSeconds} (${labelClause})`;
  }
  listParams.q = q;

  const res = await gmail.users.messages.list(listParams);
  const messages = res.data.messages || [];

  return {
    items: messages.map(m => ({ id: m.id })),
    labelIdToName,
  };
}

/**
 * Fetch full message and extract plain-text body.
 * Also returns labelIds so the caller can resolve which configured label matched.
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
  const subject = (headers.find(h => h.name.toLowerCase() === 'subject') || {}).value || '';
  const receivedAt = new Date(parseInt(message.internalDate, 10));
  const body = extractBody(message.payload);
  const labelIds = message.labelIds || [];

  return { body, receivedAt, subject, labelIds };
}

function stripHtml(html) {
  const $ = cheerioLoad(html);
  $('style, script').remove();
  return $.text().replace(/\s+/g, ' ').trim();
}

/**
 * Walk the MIME tree to extract body text.
 * Priority: text/plain > text/html (decoded from HTML to plain text).
 */
function extractBody(part) {
  if (part.mimeType === 'text/plain' && part.body && part.body.data) {
    return decodeBase64(part.body.data);
  }

  if (part.mimeType === 'text/html' && part.body && part.body.data) {
    return stripHtml(decodeBase64(part.body.data));
  }

  if (part.parts && part.parts.length > 0) {
    let htmlFallback = '';
    for (const subpart of part.parts) {
      const result = extractBody(subpart);
      if (result) {
        if (subpart.mimeType === 'text/plain' || isNestedPlain(subpart)) {
          return result;
        }
        if (!htmlFallback) htmlFallback = result;
      }
    }
    return htmlFallback;
  }

  return '';
}

function isNestedPlain(part) {
  if (part.mimeType === 'text/plain') return true;
  if (part.parts) return part.parts.some(isNestedPlain);
  return false;
}

function decodeBase64(data) {
  const standard = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(standard, 'base64').toString('utf8');
}

module.exports = { fetchEmailIds, fetchEmailBody, resolveLabelName };
