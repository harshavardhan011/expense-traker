const { Pool } = require('pg');
const settings = require('../config/settings');

if (!settings.databaseUrl) {
  throw new Error('DATABASE_URL must be set in .env');
}

const { hostname } = new URL(settings.databaseUrl);
const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

const pool = new Pool({
  connectionString: settings.databaseUrl,
  ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
});

module.exports = pool;
