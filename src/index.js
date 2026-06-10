const fs = require('fs');
const path = require('path');
const { authorize } = require('./auth');
const { fetchEmailIds, fetchEmailBody, resolveLabelName } = require('./services/gmail-reader');
const { parseExpensesBatch } = require('./services/gemini-parser');
const { getCategory } = require('./services/db-merchant-mapper');
const { insertExpense, recategorizeUncategorized } = require('./services/db-writer');
const supabase = require('./services/db');
const { bootstrapSchema } = require('./services/db-bootstrap');
const settings = require('./config/settings');

// ─── First-run setup ──────────────────────────────────────────────────────────

function initDataDirectory() {
  // Only ensure the data/ dir exists for OAuth credential files — all data now lives in Supabase
  if (!fs.existsSync(settings.dataDir)) {
    fs.mkdirSync(settings.dataDir, { recursive: true });
    console.log('Created data/ directory.');
  }
}

// ─── Activity log → Supabase ──────────────────────────────────────────────────

async function writeLog(level, emailId, subject, detail) {
  const { error } = await supabase.from('activity_logs').insert({
    level,
    email_id: emailId,
    subject: subject || '',
    detail,
  });
  if (error) {
    // Non-fatal: log to stderr but don't crash the run
    console.error(`[writeLog] DB insert failed: ${error.message}`);
  }
}

// ─── State: processed email IDs → Supabase ────────────────────────────────────

async function pruneProcessedIds() {
  const cutoff = new Date(Date.now() - settings.processedEmailsRetentionHours * 60 * 60 * 1000);
  const { count, error } = await supabase
    .from('processed_emails')
    .delete({ count: 'exact' })
    .lt('processed_at', cutoff.toISOString());
  if (error) console.warn('[pruneProcessedIds] failed (non-fatal):', error.message);
  else if (count > 0) console.log(`Pruned ${count} old processed_emails entries.`);
}

async function getLastRunCutoff() {
  const { data } = await supabase
    .from('processed_emails')
    .select('processed_at')
    .order('processed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null; // empty table → caller falls back to FETCH_WINDOW_HOURS
  return new Date(
    new Date(data.processed_at).getTime() - settings.overlapBufferMinutes * 60 * 1000
  );
}

async function loadProcessedIds(since) {
  const windowStart = new Date(since.getTime() - settings.overlapBufferMinutes * 60 * 1000);
  const { data, error } = await supabase
    .from('processed_emails')
    .select('email_id')
    .gte('processed_at', windowStart.toISOString());
  if (error) {
    console.warn('Could not load processed emails from DB:', error.message);
    return new Set();
  }
  return new Set((data || []).map(r => r.email_id));
}

async function saveProcessedId(id) {
  const { error } = await supabase.from('processed_emails').insert({ email_id: id });
  // Ignore duplicate key errors (email already marked processed)
  if (error && !error.message.includes('duplicate')) {
    console.error(`[saveProcessedId] failed for ${id}: ${error.message}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  initDataDirectory();

  try {
    await bootstrapSchema();
  } catch (err) {
    console.error('Schema bootstrap failed:', err.message);
    process.exit(1);
  }

  let auth;
  try {
    auth = await authorize();
  } catch (err) {
    console.error('Authorization failed:', err.message);
    process.exit(1);
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
    console.error('Failed to fetch email list:', err.message);
    process.exit(1);
  }

  console.log(`Gmail returned: ${emailItems.length} email(s) across labels [${settings.gmailLabels.join(', ')}]`);

  const processedIds = await loadProcessedIds(since);
  const newItems = emailItems.filter(item => !processedIds.has(item.id));
  console.log(`Already processed (DB dedup): ${emailItems.length - newItems.length}`);
  console.log(`Sent to Gemini: ${newItems.length}`);

  if (newItems.length === 0) {
    console.log('No new transactions found.');
    const recategorized = await recategorizeUncategorized();
    if (recategorized > 0) {
      console.log(`Re-categorized ${recategorized} previously Uncategorized rows.`);
    }
    return;
  }

  const stats = { parsed: 0, skipped: 0, errors: 0 };

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
      // DEBUG: log stripped bodies before sending to Gemini
      for (const email of chunk) {
        console.log(`\n=== [${email.emailId}] Subject: "${email.subject}" ===`);
        console.log(email.body);
      }
      const results = await parseExpensesBatch(chunk);

      // 3. Process results
      for (const { emailId, label, subject, expense, geminiError } of results) {
        if (geminiError) {
          console.error(`  [${emailId}] Gemini error: ${geminiError}`);
          await writeLog('ERROR', emailId, subject || '', `gemini_failed: ${geminiError}`);
          stats.errors++;
          // Do NOT saveProcessedId — let next run retry while email is still in fetch window
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

        // Save state immediately after DB write — prevents duplicates on crash
        await saveProcessedId(emailId);

        console.log(
          `  [${emailId}] Logged: ${expense.date} | ${expense.type} | ${expense.currency} ${expense.amount} | ${expense.merchant} | ${category}`
        );
        stats.parsed++;
      }
    }
  }

  const recategorized = await recategorizeUncategorized();

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log('\n─── Summary ───────────────────────────────────');
  console.log(`  Transactions logged  : ${stats.parsed}`);
  console.log(`  Skipped (Gemini)     : ${stats.skipped}`);
  console.log(`  Errors               : ${stats.errors}`);
  if (recategorized > 0) {
    console.log(`  Re-categorized   : ${recategorized} previously Uncategorized rows`);
  }
  console.log(`  DB : ${settings.supabaseUrl}`);
  console.log(`  Log : activity_logs table in Supabase`);
  console.log('───────────────────────────────────────────────');
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
