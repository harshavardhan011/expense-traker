/**
 * One-time migration: import existing data/ files into Supabase.
 *
 * Run once after setting up Supabase:
 *   node scripts/migrate-to-supabase.js
 *
 * Safe to re-run — all inserts use ON CONFLICT DO NOTHING / upsert.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const DATA_DIR = path.join(__dirname, '../data');

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { fields.push(current); current = ''; }
      else current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseCsv(content) {
  const lines = content.split('\n').filter(l => l.trim() !== '');
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
  });
}

// ─── Migrate expenses.csv → expenses table ────────────────────────────────────

async function migrateExpenses() {
  const csvPath = path.join(DATA_DIR, 'expenses.csv');
  if (!fs.existsSync(csvPath)) {
    console.log('  expenses.csv not found — skipping.');
    return;
  }

  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  console.log(`  Found ${rows.length} rows in expenses.csv`);

  const records = rows.map(r => ({
    email_id: r.emailId,
    label: r.label || null,
    date: r.date,
    amount: parseFloat(r.amount) || 0,
    currency: r.currency || 'INR',
    type: r.type || 'DR',
    merchant: r.merchant || null,
    category: r.category || 'Uncategorized',
    raw_description: r.rawDescription || null,
    available_credit_limit: r.availableCreditLimit ? parseFloat(r.availableCreditLimit) : null,
    account_type: r.accountType || null,
    account_last4: r.accountLast4 || null,
  })).filter(r => r.email_id);

  // Batch in chunks of 500
  let inserted = 0;
  for (let i = 0; i < records.length; i += 500) {
    const chunk = records.slice(i, i + 500);
    const { error } = await supabase
      .from('expenses')
      .upsert(chunk, { onConflict: 'email_id' });
    if (error) throw new Error(`expenses upsert failed: ${error.message}`);
    inserted += chunk.length;
    process.stdout.write(`\r  Inserted ${inserted}/${records.length} expense rows...`);
  }
  console.log(`\n  Done — ${inserted} expenses migrated.`);
}

// ─── Migrate processed-emails.json → processed_emails table ──────────────────

async function migrateProcessedEmails() {
  const jsonPath = path.join(DATA_DIR, 'processed-emails.json');
  if (!fs.existsSync(jsonPath)) {
    console.log('  processed-emails.json not found — skipping.');
    return;
  }

  const ids = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  console.log(`  Found ${ids.length} processed email IDs`);

  const records = ids.map(id => ({ email_id: id }));

  let inserted = 0;
  for (let i = 0; i < records.length; i += 500) {
    const chunk = records.slice(i, i + 500);
    const { error } = await supabase
      .from('processed_emails')
      .upsert(chunk, { onConflict: 'email_id' });
    if (error) throw new Error(`processed_emails upsert failed: ${error.message}`);
    inserted += chunk.length;
  }
  console.log(`  Done — ${inserted} processed email IDs migrated.`);
}

// ─── Migrate merchant-mapping.json → merchant_mappings table ─────────────────

async function migrateMerchantMappings() {
  const jsonPath = path.join(DATA_DIR, 'merchant-mapping.json');
  if (!fs.existsSync(jsonPath)) {
    console.log('  merchant-mapping.json not found — skipping.');
    return;
  }

  const mapping = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const entries = Object.entries(mapping);
  console.log(`  Found ${entries.length} merchant mappings`);

  const records = entries.map(([merchant, category]) => ({ merchant, category }));

  let inserted = 0;
  for (let i = 0; i < records.length; i += 500) {
    const chunk = records.slice(i, i + 500);
    const { error } = await supabase
      .from('merchant_mappings')
      .upsert(chunk, { onConflict: 'merchant' });
    if (error) throw new Error(`merchant_mappings upsert failed: ${error.message}`);
    inserted += chunk.length;
  }
  console.log(`  Done — ${inserted} merchant mappings migrated.`);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Migrating data/ files to Supabase...\n');

  console.log('1. Migrating expenses.csv...');
  await migrateExpenses();

  console.log('\n2. Migrating processed-emails.json...');
  await migrateProcessedEmails();

  console.log('\n3. Migrating merchant-mapping.json...');
  await migrateMerchantMappings();

  console.log('\nMigration complete.');
}

main().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
