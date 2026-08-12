const { query, queryOne } = require('./db');

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
  params.push(limit, offset);

  try {
    return await query(
      `SELECT * FROM expenses ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
  } catch (err) {
    throw new Error(`listExpenses failed: ${err.message}`);
  }
}

async function getExpenseById(id) {
  let row;
  try {
    row = await queryOne(`SELECT * FROM expenses WHERE id = $1`, [id]);
  } catch (err) {
    throw new Error(`getExpenseById failed: ${err.message}`);
  }
  if (!row) throw new Error(`getExpenseById failed: no expense with id ${id}`);
  return row;
}

module.exports = { listExpenses, getExpenseById };
