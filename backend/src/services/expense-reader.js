const pool = require('./db');

async function listExpenses({ limit = 50, offset = 0, category, accountLast4 } = {}) {
  const conditions = [];
  const params = [];

  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }
  if (accountLast4) {
    params.push(accountLast4);
    conditions.push(`account_last4 = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  let result;
  try {
    result = await pool.query(
      `SELECT * FROM expenses ${where} ORDER BY created_at DESC LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params
    );
  } catch (err) {
    throw new Error(`listExpenses failed: ${err.message}`);
  }
  return result.rows || [];
}

async function getExpenseById(id) {
  let result;
  try {
    result = await pool.query('SELECT * FROM expenses WHERE id = $1 LIMIT 1', [id]);
  } catch (err) {
    throw new Error(`getExpenseById failed: ${err.message}`);
  }
  if (result.rows.length === 0) throw new Error('getExpenseById failed: no rows returned');
  return result.rows[0];
}

module.exports = { listExpenses, getExpenseById };
