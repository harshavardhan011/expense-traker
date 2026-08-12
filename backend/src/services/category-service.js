const { query, withTransaction } = require('./db');
const { addMapping } = require('./db-merchant-mapper');
const { recategorizeUncategorized } = require('./db-writer');

/**
 * Return all merchants that still have category='Uncategorized',
 * aggregated by merchant with txn count and total DR spend.
 * Sorted by total desc.
 * @returns {Promise<Array<{merchant:string, count:number, total:number}>>}
 */
async function listUncategorizedMerchants() {
  let rows;
  try {
    rows = await query(
      `SELECT
         COALESCE(NULLIF(MIN(trim(merchant)), ''), '(unknown)') AS merchant,
         COUNT(*)::int AS count,
         COALESCE(SUM(amount) FILTER (WHERE type = 'DR'), 0) AS total
       FROM expenses
       WHERE category = 'Uncategorized'
       GROUP BY lower(trim(merchant))
       ORDER BY total DESC`
    );
  } catch (err) {
    throw new Error(`listUncategorizedMerchants failed: ${err.message}`);
  }

  return rows.map(r => ({ merchant: r.merchant, count: r.count, total: Number(r.total) }));
}

/**
 * Return a sorted list of distinct non-Uncategorized categories
 * from both merchant_mappings and expenses tables.
 * @returns {Promise<string[]>}
 */
async function listCategories() {
  let rows;
  try {
    rows = await query(
      `SELECT category FROM merchant_mappings WHERE category <> 'Uncategorized'
       UNION
       SELECT category FROM expenses WHERE category <> 'Uncategorized' AND category IS NOT NULL
       ORDER BY category`
    );
  } catch (err) {
    throw new Error(`listCategories failed: ${err.message}`);
  }

  return rows.map(r => r.category);
}

/**
 * Assign a category to a merchant, then retroactively fix all
 * existing Uncategorized expenses for any merchant.
 * @returns {Promise<{recategorized:number}>}
 */
async function setMerchantCategory(merchant, category) {
  await addMapping(merchant, category);
  const recategorized = await recategorizeUncategorized();
  return { recategorized };
}

/**
 * Return every distinct non-Uncategorized category with its usage count
 * (number of expenses currently tagged with it). Categories that only exist
 * as a merchant mapping (no expenses yet) are included with count 0.
 * @returns {Promise<Array<{category:string, count:number}>>}
 */
async function listCategoriesWithCounts() {
  let rows;
  try {
    rows = await query(
      `SELECT category, COUNT(*)::int AS count
       FROM expenses
       WHERE category <> 'Uncategorized' AND category IS NOT NULL
       GROUP BY category
       UNION ALL
       SELECT m.category, 0
       FROM merchant_mappings m
       WHERE m.category <> 'Uncategorized'
         AND NOT EXISTS (
           SELECT 1 FROM expenses e
           WHERE e.category = m.category
         )`
    );
  } catch (err) {
    throw new Error(`listCategoriesWithCounts failed: ${err.message}`);
  }

  // Merge duplicate categories (the mapping-only UNION ALL branch could still
  // collide if two mapping rows share a category) and sort by name.
  const counts = new Map();
  for (const row of rows) {
    counts.set(row.category, (counts.get(row.category) || 0) + row.count);
  }

  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

/**
 * Rename a category everywhere it appears (expenses + merchant_mappings).
 * @returns {Promise<{updated:number}>}
 */
async function renameCategory(from, to) {
  try {
    return await withTransaction(async client => {
      const expRes = await client.query(
        `UPDATE expenses SET category = $1 WHERE category = $2 RETURNING id`,
        [to, from]
      );
      await client.query(
        `UPDATE merchant_mappings SET category = $1 WHERE category = $2`,
        [to, from]
      );
      return { updated: expRes.rows.length };
    });
  } catch (err) {
    throw new Error(`renameCategory failed: ${err.message}`);
  }
}

/**
 * Delete a category: affected expenses fall back to 'Uncategorized', and
 * its merchant mappings are removed so those merchants resurface for
 * recategorization.
 * @returns {Promise<{reassigned:number}>}
 */
async function deleteCategory(name) {
  try {
    return await withTransaction(async client => {
      const expRes = await client.query(
        `UPDATE expenses SET category = 'Uncategorized' WHERE category = $1 RETURNING id`,
        [name]
      );
      await client.query(`DELETE FROM merchant_mappings WHERE category = $1`, [name]);
      return { reassigned: expRes.rows.length };
    });
  } catch (err) {
    throw new Error(`deleteCategory failed: ${err.message}`);
  }
}

module.exports = {
  listUncategorizedMerchants,
  listCategories,
  setMerchantCategory,
  listCategoriesWithCounts,
  renameCategory,
  deleteCategory,
};
