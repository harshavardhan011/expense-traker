const fs = require('fs');
const path = require('path');
const { authorize } = require('./auth');
const { fetchEmailIds, fetchEmailBody } = require('./services/gmail-reader');
const { parseExpensesBatch } = require('./services/gemini-parser');
const { getCategory } = require('./services/merchant-mapper');
const { appendExpense, initCsv } = require('./services/csv-writer');
const settings = require('./config/settings');

// ─── First-run setup ──────────────────────────────────────────────────────────

function initDataDirectory() {
  if (!fs.existsSync(settings.dataDir)) {
    fs.mkdirSync(settings.dataDir, { recursive: true });
    console.log('Created data/ directory.');
  }

  if (!fs.existsSync(settings.processedEmailsPath)) {
    fs.writeFileSync(settings.processedEmailsPath, '[]');
  }

  if (!fs.existsSync(settings.merchantMappingPath)) {
    fs.writeFileSync(settings.merchantMappingPath, '{}');
  }

  initCsv();
}

// ─── Activity log ─────────────────────────────────────────────────────────────

function writeLog(level, emailId, subject, detail) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] emailId=${emailId} subject="${subject}" ${detail}\n`;
  fs.appendFileSync(settings.activityLogPath, line);
}

// ─── State: processed email IDs ───────────────────────────────────────────────

function loadProcessedIds() {
  try {
    const raw = fs.readFileSync(settings.processedEmailsPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    console.warn('processed-emails.json is missing or corrupted. Starting fresh.');
    return [];
  }
}

function saveProcessedId(id, processedIds) {
  processedIds.push(id);
  fs.writeFileSync(settings.processedEmailsPath, JSON.stringify(processedIds, null, 2));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  initDataDirectory();

  let auth;
  try {
    auth = await authorize();
  } catch (err) {
    console.error('Authorization failed:', err.message);
    process.exit(1);
  }

  const since = new Date(Date.now() - settings.fetchWindowHours * 60 * 60 * 1000);
  console.log(
    `Fetching emails since ${since.toISOString()} (last ${settings.fetchWindowHours}h)...`
  );

  let emailIds;
  try {
    emailIds = await fetchEmailIds(auth, since);
  } catch (err) {
    console.error('Failed to fetch email list:', err.message);
    process.exit(1);
  }

  console.log(`Found ${emailIds.length} email(s) in window.`);

  const processedIds = loadProcessedIds();
  const newIds = emailIds.filter(id => !processedIds.includes(id));
  console.log(`${newIds.length} new (unprocessed) email(s).`);

  if (newIds.length === 0) {
    console.log('No new transactions found. Exiting.');
    return;
  }

  const stats = { parsed: 0, skipped: 0, errors: 0 };

  // 1. Fetch all bodies in parallel
  console.log('Fetching email bodies in parallel...');
  const fetchResults = await Promise.all(
    newIds.map(async emailId => {
      try {
        const data = await fetchEmailBody(auth, emailId);
        return { emailId, ...data };
      } catch (err) {
        console.error(`  [${emailId}] Failed to fetch body: ${err.message}`);
        writeLog('ERROR', emailId, '', `fetch_failed: ${err.message}`);
        return { emailId, fetchError: err.message };
      }
    })
  );

  // Mark fetch-failed emails as processed immediately
  for (const item of fetchResults) {
    if (item.fetchError) {
      stats.errors++;
      saveProcessedId(item.emailId, processedIds);
    }
  }

  const toparse = fetchResults.filter(item => !item.fetchError);

  if (toparse.length === 0) {
    console.log('No emails to parse after fetch errors.');
  } else {
    // 2. Batch parse (chunked by geminiBatchSize)
    const batchSize = settings.geminiBatchSize;
    const chunks = [];
    for (let i = 0; i < toparse.length; i += batchSize) {
      chunks.push(toparse.slice(i, i + batchSize));
    }

    for (const chunk of chunks) {
      const results = await parseExpensesBatch(chunk);

      // 3. Process results
      for (const { emailId, subject, expense, geminiError } of results) {
        if (geminiError) {
          console.error(`  [${emailId}] Gemini error: ${geminiError}`);
          writeLog('ERROR', emailId, subject || '', `gemini_failed: ${geminiError}`);
          stats.errors++;
          saveProcessedId(emailId, processedIds);
          continue;
        }

        if (!expense) {
          console.log(`  [${emailId}] Skipped (not a transaction): "${subject}"`);
          writeLog('SKIP', emailId, subject || '', 'not_a_transaction');
          stats.skipped++;
          saveProcessedId(emailId, processedIds);
          continue;
        }

        const category = getCategory(expense.merchant);

        const row = {
          date: expense.date,
          amount: expense.amount,
          currency: expense.currency,
          type: expense.type,
          merchant: expense.merchant,
          category,
          rawDescription: expense.rawDescription,
          emailId,
        };

        appendExpense(row);

        // Save state immediately after writing to CSV — prevents duplicates on crash
        saveProcessedId(emailId, processedIds);

        console.log(
          `  [${emailId}] Logged: ${expense.date} | ${expense.type} | ${expense.currency} ${expense.amount} | ${expense.merchant} | ${category}`
        );
        stats.parsed++;
      }
    }
  }

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log('\n─── Summary ───────────────────────────────────');
  console.log(`  Transactions logged : ${stats.parsed}`);
  console.log(`  Non-transaction emails skipped : ${stats.skipped}`);
  console.log(`  Parse / fetch errors : ${stats.errors}`);
  console.log(`  CSV : ${settings.csvFilePath}`);
  console.log(`  Log : ${settings.activityLogPath}`);
  console.log('───────────────────────────────────────────────');
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
