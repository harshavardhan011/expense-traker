const supabase = require('./db');

// ─── Account CRUD ────────────────────────────────────────────────────────────

/**
 * Create a new account.
 * If initialBalance > 0, also records an opening_balance transaction.
 */
async function createAccount({ name, accountType, accountLast4, currency = 'INR', balance = 0, creditLimit = null }) {
  const { data, error } = await supabase
    .from('accounts')
    .insert({
      name,
      account_type: accountType,
      account_last4: accountLast4,
      currency,
      balance,
      credit_limit: creditLimit,
    })
    .select('id, balance')
    .single();

  if (error) throw new Error(`createAccount failed: ${error.message}`);

  // Record opening balance transaction if non-zero
  if (balance !== 0) {
    const { error: txnErr } = await supabase.from('account_transactions').insert({
      account_id: data.id,
      type: 'opening_balance',
      amount: Math.abs(balance),
      balance_after: balance,
      description: 'Opening balance',
    });
    if (txnErr) console.warn(`[createAccount] opening_balance txn failed (non-fatal): ${txnErr.message}`);
  }

  return data;
}

/**
 * List all accounts. By default only active ones.
 */
async function listAccounts({ activeOnly = true } = {}) {
  let query = supabase.from('accounts').select('*').order('created_at', { ascending: true });
  if (activeOnly) query = query.eq('is_active', true);

  const { data, error } = await query;
  if (error) throw new Error(`listAccounts failed: ${error.message}`);
  return data || [];
}

/**
 * Find an account by (accountType, accountLast4).
 * Falls back to matching by accountLast4 alone if exact match not found.
 * Returns null if no match or ambiguous fallback.
 */
async function findAccount(accountType, accountLast4) {
  if (!accountLast4) return null;

  // 1. Exact match
  const { data: exact, error: exactErr } = await supabase
    .from('accounts')
    .select('*')
    .eq('account_type', accountType)
    .eq('account_last4', accountLast4)
    .eq('is_active', true)
    .maybeSingle();

  if (exactErr) throw new Error(`findAccount exact failed: ${exactErr.message}`);
  if (exact) return exact;

  // 2. Fallback: match by last4 alone (handles upi/netbanking → savings)
  const { data: fallback, error: fbErr } = await supabase
    .from('accounts')
    .select('*')
    .eq('account_last4', accountLast4)
    .eq('is_active', true);

  if (fbErr) throw new Error(`findAccount fallback failed: ${fbErr.message}`);
  if (fallback && fallback.length === 1) return fallback[0];

  // Ambiguous or no match
  return null;
}

/**
 * Find account by ID.
 */
async function getAccountById(id) {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw new Error(`getAccountById failed: ${error.message}`);
  return data;
}

/**
 * Resolve a CLI identifier (last4 digits or account id) to an account.
 * If last4 is ambiguous (multiple accounts), returns all matches for the caller to handle.
 */
async function resolveAccount(identifier) {
  // If it's a number > 9999, treat as account ID
  const num = Number(identifier);
  if (!isNaN(num) && num > 9999) {
    const acct = await getAccountById(num);
    return acct ? [acct] : [];
  }

  // Otherwise treat as last4
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('account_last4', identifier)
    .eq('is_active', true);

  if (error) throw new Error(`resolveAccount failed: ${error.message}`);
  return data || [];
}

// ─── Balance Operations ──────────────────────────────────────────────────────

/**
 * Compute the balance delta for an expense on a given account type.
 * Credit cards: DR increases balance (owe more), CR decreases (owe less).
 * Savings/salary: DR decreases balance (funds leave), CR increases (funds arrive).
 */
function computeDelta(accountType, expenseType, amount) {
  const isCreditCard = accountType === 'credit_card';
  if (expenseType === 'DR') {
    return isCreditCard ? amount : -amount;
  } else {
    return isCreditCard ? -amount : amount;
  }
}

/**
 * Called after an expense is inserted into the expenses table.
 * Links the expense to an account and updates the balance.
 * Non-breaking: if no matching account, logs a warning and returns.
 */
async function recordExpenseImpact(expenseRow, expenseId) {
  if (!expenseRow.accountLast4) return; // no account info on this expense

  const account = await findAccount(expenseRow.accountType, expenseRow.accountLast4);
  if (!account) {
    console.warn(
      `[accounts] No account registered for ${expenseRow.accountType || '?'}/${expenseRow.accountLast4} — balance not updated.`
    );
    return;
  }

  // Idempotency: skip if already recorded
  const { data: existing } = await supabase
    .from('account_transactions')
    .select('id')
    .eq('expense_id', expenseId)
    .maybeSingle();

  if (existing) return; // already processed

  const delta = computeDelta(account.account_type, expenseRow.type, expenseRow.amount);
  const txnType = expenseRow.type === 'DR' ? 'expense_dr' : 'expense_cr';
  const description = `${expenseRow.type} ${expenseRow.currency || 'INR'} ${expenseRow.amount} — ${expenseRow.merchant || 'Unknown'}`;

  const { data, error } = await supabase.rpc('update_account_balance', {
    p_account_id: account.id,
    p_delta: delta,
    p_txn_type: txnType,
    p_description: description,
    p_expense_id: expenseId,
  });

  if (error) {
    console.error(`[accounts] Balance update failed for account ${account.id}: ${error.message}`);
  }
}

/**
 * Add funds to a savings/salary account (salary deposit, manual transfer in).
 */
async function addFunds(accountId, amount, description = 'Manual credit') {
  const { data, error } = await supabase.rpc('update_account_balance', {
    p_account_id: accountId,
    p_delta: amount,
    p_txn_type: 'manual_credit',
    p_description: description,
  });

  if (error) throw new Error(`addFunds failed: ${error.message}`);
  return data; // new balance
}

/**
 * Record a credit card bill payment (reduces unbilled amount).
 */
async function recordPayment(accountId, amount, description = 'Bill payment') {
  const { data, error } = await supabase.rpc('update_account_balance', {
    p_account_id: accountId,
    p_delta: -amount,
    p_txn_type: 'payment',
    p_description: description,
  });

  if (error) throw new Error(`recordPayment failed: ${error.message}`);
  return data; // new balance
}

/**
 * Fetch recent transactions for an account.
 */
async function getAccountTransactions(accountId, limit = 20) {
  const { data, error } = await supabase
    .from('account_transactions')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`getAccountTransactions failed: ${error.message}`);
  return data || [];
}

/**
 * Recalculate an account's balance from all linked expenses + manual transactions.
 * Useful after creating an account that already has expenses in the DB.
 */
async function backfillAccountBalance(accountId) {
  const account = await getAccountById(accountId);

  // Fetch all expenses linked to this account
  let query = supabase
    .from('expenses')
    .select('id, amount, type, currency, merchant, date')
    .eq('account_last4', account.account_last4);

  // For credit_card accounts, match on account_type too
  // For savings/salary, also pick up upi/netbanking/bank_transfer expenses
  if (account.account_type === 'credit_card') {
    query = query.eq('account_type', 'credit_card');
  }

  const { data: expenses, error: expErr } = await query;
  if (expErr) throw new Error(`backfill: fetch expenses failed: ${expErr.message}`);

  let balance = 0;
  let count = 0;

  for (const exp of (expenses || [])) {
    // Check if this expense already has a transaction record
    const { data: existing } = await supabase
      .from('account_transactions')
      .select('id')
      .eq('expense_id', exp.id)
      .maybeSingle();

    if (existing) continue; // already recorded

    const delta = computeDelta(account.account_type, exp.type, Number(exp.amount));
    const txnType = exp.type === 'DR' ? 'expense_dr' : 'expense_cr';
    const description = `[backfill] ${exp.type} ${exp.currency || 'INR'} ${exp.amount} — ${exp.merchant || 'Unknown'} (${exp.date})`;

    const { error: rpcErr } = await supabase.rpc('update_account_balance', {
      p_account_id: accountId,
      p_delta: delta,
      p_txn_type: txnType,
      p_description: description,
      p_expense_id: exp.id,
    });

    if (rpcErr) {
      console.error(`[backfill] Failed for expense ${exp.id}: ${rpcErr.message}`);
      continue;
    }
    count++;
  }

  // Fetch final balance
  const updated = await getAccountById(accountId);
  return { balance: updated.balance, expensesLinked: count };
}

module.exports = {
  createAccount,
  listAccounts,
  findAccount,
  getAccountById,
  resolveAccount,
  recordExpenseImpact,
  addFunds,
  recordPayment,
  getAccountTransactions,
  backfillAccountBalance,
};
