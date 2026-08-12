const { query } = require('./db');

// In-process cache — same pattern as the file-based merchant-mapper.js
let cache = null;

// If merchant string is "upi-id@bank name", return just "name".
function normalizeUpiMerchant(name) {
  const m = name.match(/^[\w.]+@\w+\s+(.+)$/);
  return m ? m[1] : name;
}

async function loadCache() {
  if (cache) return cache;
  let rows;
  try {
    rows = await query(`SELECT merchant, category FROM merchant_mappings`);
  } catch (err) {
    throw new Error(`merchant cache load failed: ${err.message}`);
  }
  cache = new Map(rows.map(r => [r.merchant, r.category]));
  return cache;
}

/**
 * Look up the category for a merchant name.
 * If not found, inserts an 'Uncategorized' entry and returns 'Uncategorized'.
 */
async function getCategory(merchantName) {
  const map = await loadCache();
  const key = normalizeUpiMerchant((merchantName || '').toLowerCase().trim());
  if (map.has(key)) return map.get(key);
  await addMapping(key, 'Uncategorized');
  return 'Uncategorized';
}

/**
 * Upsert a merchant → category mapping.
 */
async function addMapping(merchantName, category) {
  const key = normalizeUpiMerchant((merchantName || '').toLowerCase().trim());
  try {
    await query(
      `INSERT INTO merchant_mappings (merchant, category) VALUES ($1, $2)
       ON CONFLICT (merchant) DO UPDATE SET category = EXCLUDED.category`,
      [key, category]
    );
  } catch (err) {
    throw new Error(`addMapping failed: ${err.message}`);
  }
  // Update local cache
  if (cache) cache.set(key, category);
}

module.exports = { getCategory, addMapping };
