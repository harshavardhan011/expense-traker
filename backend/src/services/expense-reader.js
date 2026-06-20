const supabase = require('./db');

async function listExpenses({ limit = 50, offset = 0, category, accountLast4 } = {}) {
  let query = supabase
    .from('expenses')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (category) query = query.eq('category', category);
  if (accountLast4) query = query.eq('account_last4', accountLast4);

  const { data, error } = await query;
  if (error) throw new Error(`listExpenses failed: ${error.message}`);
  return data || [];
}

async function getExpenseById(id) {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw new Error(`getExpenseById failed: ${error.message}`);
  return data;
}

module.exports = { listExpenses, getExpenseById };
