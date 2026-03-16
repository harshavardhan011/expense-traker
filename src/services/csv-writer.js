const fs = require('fs');
const settings = require('../config/settings');

/**
 * Escape a CSV field value.
 * Wraps in double-quotes if it contains commas, quotes, or newlines.
 */
function escapeField(value) {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function rowToLine(row) {
  return settings.csvHeaders.map(h => escapeField(row[h])).join(',');
}

/**
 * Ensure the CSV file exists with a header row.
 */
function initCsv() {
  if (!fs.existsSync(settings.csvFilePath)) {
    fs.writeFileSync(settings.csvFilePath, settings.csvHeaders.join(',') + '\n');
  }
}

/**
 * Append a single expense row to the CSV.
 * @param {{ date, amount, currency, merchant, category, rawDescription, emailId }} expense
 */
function appendExpense(expense) {
  initCsv();
  const line = rowToLine(expense) + '\n';
  fs.appendFileSync(settings.csvFilePath, line);
}

module.exports = { appendExpense, initCsv };
