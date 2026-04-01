const supabase = require('./db');

// In-process cache — same pattern as the file-based merchant-mapper.js
let cache = null;

// If merchant string is "upi-id@bank name", return just "name".
function normalizeUpiMerchant(name) {
  const m = name.match(/^[\w.]+@\w+\s+(.+)$/);
  return m ? m[1] : name;
}

async function loadCache() {
  if (cache) return cache;
  const { data, error } = await supabase.from('merchant_mappings').select('merchant, category');
  if (error) throw new Error(`merchant cache load failed: ${error.message}`);
  cache = new Map((data || []).map(r => [r.merchant, r.category]));
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
  const { error } = await supabase
    .from('merchant_mappings')
    .upsert({ merchant: key, category }, { onConflict: 'merchant' });
  if (error) throw new Error(`addMapping failed: ${error.message}`);
  // Update local cache
  if (cache) cache.set(key, category);
}

module.exports = { getCategory, addMapping };
