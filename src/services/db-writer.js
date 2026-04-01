const supabase = require('./db');

/**
 * Upsert a single expense row into the `expenses` table.
 * Uses email_id as the conflict key — safe to call multiple times.
 */
async function insertExpense(row) {
  const { error } = await supabase.from('expenses').upsert(
    {
      email_id: row.emailId,
      label: row.label,
      date: row.date,
      amount: row.amount,
      currency: row.currency,
      type: row.type,
      merchant: row.merchant,
      category: row.category,
      raw_description: row.rawDescription,
      available_credit_limit: row.availableCreditLimit ?? null,
      account_type: row.accountType ?? null,
      account_last4: row.accountLast4 ?? null,
    },
    { onConflict: 'email_id' }
  );
  if (error) throw new Error(`insertExpense failed: ${error.message}`);
}

/**
 * For every expense with category='Uncategorized', look up the current
 * merchant_mappings and update the category if a better one exists.
 * Returns the number of rows updated.
 */
async function recategorizeUncategorized() {
  // Fetch all uncategorized expenses
  const { data: rows, error: fetchErr } = await supabase
    .from('expenses')
    .select('id, merchant')
    .eq('category', 'Uncategorized');

  if (fetchErr) throw new Error(`recategorize fetch failed: ${fetchErr.message}`);
  if (!rows || rows.length === 0) return 0;

  // Fetch all current mappings in one go
  const { data: mappings, error: mapErr } = await supabase
    .from('merchant_mappings')
    .select('merchant, category')
    .neq('category', 'Uncategorized');

  if (mapErr) throw new Error(`recategorize mappings fetch failed: ${mapErr.message}`);

  const map = new Map((mappings || []).map(m => [m.merchant, m.category]));

  let count = 0;
  for (const row of rows) {
    const key = (row.merchant || '').toLowerCase().trim();
    const newCategory = map.get(key);
    if (newCategory) {
      const { error: updateErr } = await supabase
        .from('expenses')
        .update({ category: newCategory })
        .eq('id', row.id);
      if (updateErr) throw new Error(`recategorize update failed: ${updateErr.message}`);
      count++;
    }
  }

  return count;
}

module.exports = { insertExpense, recategorizeUncategorized };
