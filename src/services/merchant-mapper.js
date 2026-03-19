const fs = require('fs');
const settings = require('../config/settings');

let mapping = null;

function loadMapping() {
  if (mapping) return mapping;
  try {
    const raw = fs.readFileSync(settings.merchantMappingPath, 'utf8');
    mapping = JSON.parse(raw);
  } catch {
    mapping = {};
  }
  return mapping;
}

function saveMapping(data) {
  fs.writeFileSync(settings.merchantMappingPath, JSON.stringify(data, null, 2));
  mapping = data;
}

/**
 * Look up the category for a merchant name.
 * Matching is case-insensitive; keys stored as lowercase.
 * Returns 'Uncategorized' if no match found.
 * @param {string} merchantName
 * @returns {string} category
 */
function getCategory(merchantName) {
  const map = loadMapping();
  const key = (merchantName || '').toLowerCase().trim();
  if (map[key] !== undefined) return map[key];
  addMapping(key, 'Uncategorized');
  return 'Uncategorized';
}

/**
 * Add or update a merchant→category mapping.
 * Stub implementation for v1 — no file locking.
 * @param {string} merchantName
 * @param {string} category
 */
function addMapping(merchantName, category) {
  const map = loadMapping();
  const key = merchantName.toLowerCase().trim();
  map[key] = category;
  saveMapping(map);
}

module.exports = { getCategory, addMapping };
