require('dotenv').config();
const fs = require('fs');
const { authorize } = require('./auth');
const { fetchEmailIds, fetchEmailBody, resolveLabelName } = require('./services/gmail-reader');
const { parseExpensesBatch } = require('./services/gemini-parser');
const { getCategory } = require('./services/db-merchant-mapper');
const { insertExpense, recategorizeUncategorized } = require('./services/db-writer');
const pool = require('./services/db');
const { bootstrapSchema } = require('./services/db-bootstrap');
const settings = require('./config/settings');

function initDataDirectory() {
  if (!fs.existsSync(settings.dataDir)) {
    fs.mkdirSync(settings.dataDir, { recursive: true });
    console.log('Created data/ directory.');
  }
}

async function writeLog(level, emailId, subject, detail) {
  try {
    await pool.query(
      'INSERT INTO activity_logs (level, email_id, subject, detail) VALUES ($1,$2,$3,$4)',
      [level, emailId, subject || '', detail]
    );
  } catch (err) {
    console.error(`[writeLog] DB insert failed: ${err.message}`);
  }
}

async function pruneProcessedIds() {
  const cutoff = new Date(Date.now() - settings.processedEmailsRetentionHours * 60 * 60 * 1000);
  try {
    const result = await pool.query('DELETE FROM processed_emails WHERE processed_at < $1', [
      cutoff.toISOString(),
    ]);
    if (result.rowCount > 0) console.log(`Pruned ${result.rowCount} old processed_emails entries.`);
  } catch (err) {
    console.warn('[pruneProcessedIds] failed (non-fatal):', err.message);
  }
}

async function getLastRunCutoff() {
  const result = await pool.query(
    'SELECT processed_at FROM processed_emails ORDER BY processed_at DESC LIMIT 1'
  );
  const data = result.rows[0];
  if (!data) return null;
  return new Date(
    new Date(data.processed_at).getTime() - settings.overlapBufferMinutes * 60 * 1000
  );
}

async function loadProcessedIds(since) {
  const windowStart = new Date(since.getTime() - settings.overlapBufferMinutes * 60 * 1000);
  try {
    const result = await pool.query(
      'SELECT email_id FROM processed_emails WHERE processed_at >= $1',
      [windowStart.toISOString()]
    );
    return new Set(result.rows.map(r => r.email_id));
  } catch (err) {
    console.warn('Could not load processed emails from DB:', err.message);
    return new Set();
  }
}

async function saveProcessedId(id) {
  try {
    await pool.query('INSERT INTO processed_emails (email_id) VALUES ($1)', [id]);
  } catch (err) {
    if (err.code !== '23505') {
      console.error(`[saveProcessedId] failed for ${id}: ${err.message}`);
    }
  }
}

async function runSync() {
  initDataDirectory();

  try {
    await bootstrapSchema();
  } catch (err) {
    throw new Error(`Schema bootstrap failed: ${err.message}`);
  }

  let auth;
  try {
    auth = await authorize();
  } catch (err) {
    throw new Error(`Authorization failed: ${err.message}`);
  }

  if (settings.processedEmailsRetentionHours < settings.fetchWindowHours) {
    console.warn(
      `[WARN] PROCESSED_EMAILS_RETENTION_HOURS (${settings.processedEmailsRetentionHours}h) < ` +
      `FETCH_WINDOW_HOURS (${settings.fetchWindowHours}h) — dedup state may expire before the ` +
      `fetch window closes, risking reprocessed emails.`
    );
  }

  await pruneProcessedIds();

  const lastRunCutoff = await getLastRunCutoff();
  const since = lastRunCutoff
    ? lastRunCutoff
    : new Date(Date.now() - settings.fetchWindowHours * 60 * 60 * 1000);

  console.log(
    lastRunCutoff
      ? `Cutoff: ${since.toISOString()} (source: last run − ${settings.overlapBufferMinutes}m buffer)`
      : `Cutoff: ${since.toISOString()} (source: ${settings.fetchWindowHours}h fallback window)`
  );

  let emailItems;
  let labelIdToName;
  try {
    ({ items: emailItems, labelIdToName } = await fetchEmailIds(auth, since, settings.gmailLabels));
  } catch (err) {
    throw new Error(`Failed to fetch email list: ${err.message}`);
  }

  console.log(`Gmail returned: ${emailItems.length} email(s) across labels [${settings.gmailLabels.join(', ')}]`);

  const processedIds = await loadProcessedIds(since);
  const newItems = emailItems.filter(item => !processedIds.has(item.id));
  console.log(`Already processed (DB dedup): ${emailItems.length - newItems.length}`);
  console.log(`Sent to Gemini: ${newItems.length}`);

  const stats = { parsed: 0, skipped: 0, errors: 0, recategorized: 0 };

  if (newItems.length === 0) {
    console.log('No new transactions found.');
    stats.recategorized = await recategorizeUncategorized();
    if (stats.recategorized > 0) {
      console.log(`Re-categorized ${stats.recategorized} previously Uncategorized rows.`);
    }
    return stats;
  }

  // 1. Fetch all bodies in parallel
  console.log('Fetching email bodies in parallel...');
  const fetchResults = await Promise.all(
    newItems.map(async ({ id: emailId }) => {
      try {
        const data = await fetchEmailBody(auth, emailId);
        const label = resolveLabelName(data.labelIds, labelIdToName, settings.gmailLabels);
        return { emailId, label, ...data };
      } catch (err) {
        console.error(`  [${emailId}] Failed to fetch body: ${err.message}`);
        await writeLog('ERROR', emailId, '', `fetch_failed: ${err.message}`);
        return { emailId, label: settings.gmailLabels[0] || 'unknown', fetchError: err.message };
      }
    })
  );

  // Mark fetch-failed emails as processed immediately
  for (const item of fetchResults) {
    if (item.fetchError) {
      stats.errors++;
      await saveProcessedId(item.emailId);
    }
  }

  const toparse = fetchResults.filter(item => !item.fetchError);

  if (toparse.length === 0) {
    console.log('No emails to parse after fetch errors.');
  } else {
    // 2. Batch parse (chunked by geminiBatchSize)
    const emailBodies = new Map(toparse.map(item => [item.emailId, item]));
    const batchSize = settings.geminiBatchSize;
    const chunks = [];
    for (let i = 0; i < toparse.length; i += batchSize) {
      chunks.push(toparse.slice(i, i + batchSize));
    }
    for (const chunk of chunks) {
      const results = await parseExpensesBatch(chunk);

      // 3. Process results
      for (const { emailId, label, subject, expense, geminiError } of results) {
        if (geminiError) {
          console.error(`  [${emailId}] Gemini error: ${geminiError}`);
          await writeLog('ERROR', emailId, subject || '', `gemini_failed: ${geminiError}`);
          stats.errors++;
          continue;
        }

        if (!expense) {
          console.log(`  [${emailId}] Skipped (not a transaction): "${subject}"`);
          const bodySnippet = (emailBodies.get(emailId)?.body || '').slice(0, 300);
          await writeLog('SKIP', emailId, subject || '', `not_a_transaction body="${bodySnippet}"`);
          stats.skipped++;
          await saveProcessedId(emailId);
          continue;
        }

        const category = await getCategory(expense.merchant);

        const row = {
          label,
          date: expense.date,
          amount: expense.amount,
          currency: expense.currency,
          type: expense.type,
          merchant: expense.merchant,
          category,
          rawDescription: expense.rawDescription,
          availableCreditLimit: expense.availableCreditLimit,
          accountType: expense.accountType,
          accountLast4: expense.accountLast4,
          emailId,
        };

        await insertExpense(row);
        await saveProcessedId(emailId);

        console.log(
          `  [${emailId}] Logged: ${expense.date} | ${expense.type} | ${expense.currency} ${expense.amount} | ${expense.merchant} | ${category}`
        );
        stats.parsed++;
      }
    }
  }

  stats.recategorized = await recategorizeUncategorized();

  console.log('\n─── Summary ───────────────────────────────────');
  console.log(`  Transactions logged  : ${stats.parsed}`);
  console.log(`  Skipped (Gemini)     : ${stats.skipped}`);
  console.log(`  Errors               : ${stats.errors}`);
  if (stats.recategorized > 0) {
    console.log(`  Re-categorized       : ${stats.recategorized} previously Uncategorized rows`);
  }
  console.log('───────────────────────────────────────────────');

  return stats;
}

module.exports = { runSync };
