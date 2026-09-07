const pool = require('./db');

// ─── Account CRUD ────────────────────────────────────────────────────────────

/**
 * Create a new account.
 * If initialBalance > 0, also records an opening_balance transaction.
 */
async function createAccount({ name, accountType, accountLast4, currency = 'INR', balance = 0, creditLimit = null }) {
  let data;
  try {
    const result = await pool.query(
      `INSERT INTO accounts (name, account_type, account_last4, currency, balance, credit_limit)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, balance`,
      [name, accountType, accountLast4, currency, balance, creditLimit]
    );
    data = result.rows[0];
  } catch (err) {
    throw new Error(`createAccount failed: ${err.message}`);
  }

  // Record opening balance transaction if non-zero
  if (balance !== 0) {
    try {
      await pool.query(
        `INSERT INTO account_transactions (account_id, type, amount, balance_after, description)
         VALUES ($1, 'opening_balance', $2, $3, 'Opening balance')`,
        [data.id, Math.abs(balance), balance]
      );
    } catch (err) {
      console.warn(`[createAccount] opening_balance txn failed (non-fatal): ${err.message}`);
    }
  }

  return data;
}

/**
 * List all accounts. By default only active ones.
 */
async function listAccounts({ activeOnly = true } = {}) {
  const where = activeOnly ? 'WHERE is_active = true' : '';
  let result;
  try {
    result = await pool.query(`SELECT * FROM accounts ${where} ORDER BY created_at ASC`);
  } catch (err) {
    throw new Error(`listAccounts failed: ${err.message}`);
  }
  return result.rows || [];
}

/**
 * Find an account by (accountType, accountLast4).
 * Falls back to matching by accountLast4 alone if exact match not found.
 * Returns null if no match or ambiguous fallback.
 */
async function findAccount(accountType, accountLast4) {
  if (!accountLast4) return null;

  // 1. Exact match
  let exact;
  try {
    const result = await pool.query(
      `SELECT * FROM accounts WHERE account_type = $1 AND account_last4 = $2 AND is_active = true LIMIT 1`,
      [accountType, accountLast4]
    );
    exact = result.rows[0] || null;
  } catch (err) {
    throw new Error(`findAccount exact failed: ${err.message}`);
  }
  if (exact) return exact;

  // 2. Fallback: match by last4 alone (handles upi/netbanking → savings)
  let fallback;
  try {
    const result = await pool.query(
      `SELECT * FROM accounts WHERE account_last4 = $1 AND is_active = true`,
      [accountLast4]
    );
    fallback = result.rows;
  } catch (err) {
    throw new Error(`findAccount fallback failed: ${err.message}`);
  }
  if (fallback && fallback.length === 1) return fallback[0];

  // Ambiguous or no match
  return null;
}

/**
 * Find account by ID.
 */
async function getAccountById(id) {
  let result;
  try {
    result = await pool.query('SELECT * FROM accounts WHERE id = $1 LIMIT 1', [id]);
  } catch (err) {
    throw new Error(`getAccountById failed: ${err.message}`);
  }
  if (result.rows.length === 0) throw new Error('getAccountById failed: no rows returned');
  return result.rows[0];
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
  let result;
  try {
    result = await pool.query(
      `SELECT * FROM accounts WHERE account_last4 = $1 AND is_active = true`,
      [identifier]
    );
  } catch (err) {
    throw new Error(`resolveAccount failed: ${err.message}`);
  }
  return result.rows || [];
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

async function callUpdateAccountBalance(accountId, delta, txnType, description, expenseId = null) {
  const result = await pool.query(
    'SELECT update_account_balance($1, $2, $3, $4, $5) AS new_balance',
    [accountId, delta, txnType, description, expenseId]
  );
  return result.rows[0].new_balance;
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
  let existing;
  try {
    const result = await pool.query(
      'SELECT id FROM account_transactions WHERE expense_id = $1 LIMIT 1',
      [expenseId]
    );
    existing = result.rows[0];
  } catch (err) {
    console.error(`[accounts] Idempotency check failed for expense ${expenseId}: ${err.message}`);
    return;
  }

  if (existing) return; // already processed

  const delta = computeDelta(account.account_type, expenseRow.type, expenseRow.amount);
  const txnType = expenseRow.type === 'DR' ? 'expense_dr' : 'expense_cr';
  const description = `${expenseRow.type} ${expenseRow.currency || 'INR'} ${expenseRow.amount} — ${expenseRow.merchant || 'Unknown'}`;

  try {
    await callUpdateAccountBalance(account.id, delta, txnType, description, expenseId);
  } catch (err) {
    console.error(`[accounts] Balance update failed for account ${account.id}: ${err.message}`);
  }
}

/**
 * Add funds to a savings/salary account (salary deposit, manual transfer in).
 */
async function addFunds(accountId, amount, description = 'Manual credit') {
  try {
    return await callUpdateAccountBalance(accountId, amount, 'manual_credit', description);
  } catch (err) {
    throw new Error(`addFunds failed: ${err.message}`);
  }
}

/**
 * Record a credit card bill payment (reduces unbilled amount).
 */
async function recordPayment(accountId, amount, description = 'Bill payment') {
  try {
    return await callUpdateAccountBalance(accountId, -amount, 'payment', description);
  } catch (err) {
    throw new Error(`recordPayment failed: ${err.message}`);
  }
}

/**
 * Fetch recent transactions for an account.
 */
async function getAccountTransactions(accountId, limit = 20) {
  let result;
  try {
    result = await pool.query(
      `SELECT * FROM account_transactions WHERE account_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [accountId, limit]
    );
  } catch (err) {
    throw new Error(`getAccountTransactions failed: ${err.message}`);
  }
  return result.rows || [];
}

/**
 * Recalculate an account's balance from all linked expenses + manual transactions.
 * Useful after creating an account that already has expenses in the DB.
 */
async function backfillAccountBalance(accountId) {
  const account = await getAccountById(accountId);

  // Fetch all expenses linked to this account.
  // For credit_card accounts, match on account_type too.
  // For savings/salary, also pick up upi/netbanking/bank_transfer expenses.
  let expenses;
  try {
    const query =
      account.account_type === 'credit_card'
        ? {
            text: `SELECT id, amount, type, currency, merchant, date FROM expenses
                   WHERE account_last4 = $1 AND account_type = 'credit_card'`,
            values: [account.account_last4],
          }
        : {
            text: `SELECT id, amount, type, currency, merchant, date FROM expenses WHERE account_last4 = $1`,
            values: [account.account_last4],
          };
    const result = await pool.query(query.text, query.values);
    expenses = result.rows;
  } catch (err) {
    throw new Error(`backfill: fetch expenses failed: ${err.message}`);
  }

  let count = 0;

  for (const exp of (expenses || [])) {
    // Check if this expense already has a transaction record
    let existing;
    try {
      const result = await pool.query(
        'SELECT id FROM account_transactions WHERE expense_id = $1 LIMIT 1',
        [exp.id]
      );
      existing = result.rows[0];
    } catch (err) {
      console.error(`[backfill] Idempotency check failed for expense ${exp.id}: ${err.message}`);
      continue;
    }

    if (existing) continue; // already recorded

    const delta = computeDelta(account.account_type, exp.type, Number(exp.amount));
    const txnType = exp.type === 'DR' ? 'expense_dr' : 'expense_cr';
    const description = `[backfill] ${exp.type} ${exp.currency || 'INR'} ${exp.amount} — ${exp.merchant || 'Unknown'} (${exp.date})`;

    try {
      await callUpdateAccountBalance(accountId, delta, txnType, description, exp.id);
    } catch (err) {
      console.error(`[backfill] Failed for expense ${exp.id}: ${err.message}`);
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
