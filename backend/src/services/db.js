const { Pool } = require('pg');
const settings = require('../config/settings');

if (!settings.databaseUrl) {
  throw new Error('DATABASE_URL must be set in .env (local Postgres connection)');
}

// Local Postgres: no SSL.
const pool = new Pool({ connectionString: settings.databaseUrl });

/**
 * Run a query, return the rows array.
 */
async function query(text, params) {
  const res = await pool.query(text, params);
  return res.rows;
}

/**
 * Run a query, return the first row or null.
 * Use for 0-or-1-row queries.
 */
async function queryOne(text, params) {
  const res = await pool.query(text, params);
  return res.rows[0] ?? null;
}

/**
 * Run fn(client) inside a transaction. Commits on success, rolls back on throw.
 * fn receives a client with the same query/queryOne-shaped `.query()` from `pg`.
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, queryOne, withTransaction };
