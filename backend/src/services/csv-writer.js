const fs = require('fs');
const settings = require('../config/settings');
const { getCategory } = require('./merchant-mapper');

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
    return;
  }
  const content = fs.readFileSync(settings.csvFilePath, 'utf8');
  const firstField = parseCsvLine(content.split('\n')[0])[0];
  if (firstField !== settings.csvHeaders[0]) {
    fs.writeFileSync(settings.csvFilePath, settings.csvHeaders.join(',') + '\n' + content);
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

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { fields.push(current); current = ''; }
      else current += ch;
    }
  }
  fields.push(current);
  return fields;
}

async function recategorizeUncategorized() {
  if (!fs.existsSync(settings.csvFilePath)) return 0;

  const content = fs.readFileSync(settings.csvFilePath, 'utf8');
  const lines = content.split('\n');
  const [firstLine, ...rest] = lines;
  const hasHeader = parseCsvLine(firstLine)[0] === settings.csvHeaders[0];
  const header = hasHeader ? firstLine : settings.csvHeaders.join(',');
  const rows = (hasHeader ? rest : lines).filter(l => l.trim() !== '');

  const headers = settings.csvHeaders;
  const merchantIdx = headers.indexOf('merchant');
  const categoryIdx = headers.indexOf('category');

  let count = 0;
  const updatedRows = rows.map(line => {
    const fields = parseCsvLine(line);
    if (fields[categoryIdx] === 'Uncategorized') {
      const newCategory = getCategory(fields[merchantIdx]);
      if (newCategory !== 'Uncategorized') {
        fields[categoryIdx] = newCategory;
        count++;
      }
    }
    return fields.map(escapeField).join(',');
  });

  if (count > 0) {
    fs.writeFileSync(settings.csvFilePath, [header, ...updatedRows].join('\n') + '\n');
  }

  return count;
}

module.exports = { appendExpense, initCsv, recategorizeUncategorized };
