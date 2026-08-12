const { queryOne } = require('./db');

/**
 * Update the user-editable notes field on a single expense row.
 * @param {number} id
 * @param {string|null} notes
 * @returns {Promise<object>} the updated expense row
 */
async function updateExpenseNotes(id, notes) {
  let row;
  try {
    row = await queryOne(
      `UPDATE expenses SET notes = $1 WHERE id = $2 RETURNING *`,
      [notes, id]
    );
  } catch (err) {
    throw new Error(`updateExpenseNotes failed: ${err.message}`);
  }
  if (!row) throw new Error(`updateExpenseNotes failed: no expense with id ${id}`);
  return row;
}

module.exports = { updateExpenseNotes };
