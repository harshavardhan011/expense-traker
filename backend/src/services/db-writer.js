const pool = require('./db');
const { recordExpenseImpact } = require('./account-manager');

/**
 * Upsert a single expense row into the `expenses` table.
 * Uses email_id as the conflict key — safe to call multiple times.
 * After upsert, updates the linked account balance (if any).
 */
async function insertExpense(row) {
  let result;
  try {
    result = await pool.query(
      `INSERT INTO expenses (
         email_id, label, date, amount, currency, type, merchant, category,
         raw_description, available_credit_limit, account_type, account_last4
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (email_id) DO UPDATE SET
         label = EXCLUDED.label,
         date = EXCLUDED.date,
         amount = EXCLUDED.amount,
         currency = EXCLUDED.currency,
         type = EXCLUDED.type,
         merchant = EXCLUDED.merchant,
         category = EXCLUDED.category,
         raw_description = EXCLUDED.raw_description,
         available_credit_limit = EXCLUDED.available_credit_limit,
         account_type = EXCLUDED.account_type,
         account_last4 = EXCLUDED.account_last4
       RETURNING id`,
      [
        row.emailId,
        row.label,
        row.date,
        row.amount,
        row.currency,
        row.type,
        row.merchant,
        row.category,
        row.rawDescription,
        row.availableCreditLimit ?? null,
        row.accountType ?? null,
        row.accountLast4 ?? null,
      ]
    );
  } catch (err) {
    throw new Error(`insertExpense failed: ${err.message}`);
  }

  // Update linked account balance (non-blocking — warns if no account found)
  try {
    await recordExpenseImpact(row, result.rows[0].id);
  } catch (err) {
    console.warn(`[insertExpense] account balance update failed (non-fatal): ${err.message}`);
  }
}

/**
 * For every expense with category='Uncategorized', look up the current
 * merchant_mappings and update the category if a better one exists.
 * Returns the number of rows updated.
 */
async function recategorizeUncategorized() {
  // Fetch all uncategorized expenses
  let rows;
  try {
    const result = await pool.query(
      `SELECT id, merchant FROM expenses WHERE category = 'Uncategorized'`
    );
    rows = result.rows;
  } catch (err) {
    throw new Error(`recategorize fetch failed: ${err.message}`);
  }

  if (!rows || rows.length === 0) return 0;

  // Fetch all current mappings in one go
  let mappings;
  try {
    const result = await pool.query(
      `SELECT merchant, category FROM merchant_mappings WHERE category != 'Uncategorized'`
    );
    mappings = result.rows;
  } catch (err) {
    throw new Error(`recategorize mappings fetch failed: ${err.message}`);
  }

  const map = new Map((mappings || []).map(m => [m.merchant, m.category]));

  let count = 0;
  for (const row of rows) {
    const key = (row.merchant || '').toLowerCase().trim();
    const newCategory = map.get(key);
    if (newCategory) {
      try {
        await pool.query('UPDATE expenses SET category = $1 WHERE id = $2', [newCategory, row.id]);
      } catch (err) {
        throw new Error(`recategorize update failed: ${err.message}`);
      }
      count++;
    }
  }

  return count;
}

module.exports = { insertExpense, recategorizeUncategorized };
