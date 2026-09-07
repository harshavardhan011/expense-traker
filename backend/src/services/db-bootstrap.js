const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function bootstrapSchema() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn(
      '[bootstrap] DATABASE_URL not set — skipping schema sync. ' +
      'Set it to enable auto-create of missing tables.'
    );
    return;
  }

  const sql = fs.readFileSync(path.join(__dirname, '../../db/schema.sql'), 'utf8');
  const { hostname } = new URL(url);
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  const client = new Client({
    connectionString: url,
    ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('[bootstrap] Schema sync complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(`Schema bootstrap failed: ${err.message}`);
  } finally {
    await client.end();
  }
}

module.exports = { bootstrapSchema };
