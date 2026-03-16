const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const DATA_DIR = path.join(__dirname, '../../data');

module.exports = {
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: 'gemini-2.5-flash',

  // Gmail settings
  gmailLabel: process.env.GMAIL_LABEL || 'bank-alerts',
  fetchWindowHours: parseInt(process.env.FETCH_WINDOW_HOURS || '24', 10),
  geminiBatchSize: parseInt(process.env.GEMINI_BATCH_SIZE || '20', 10),

  // File paths — all relative to project root, not cwd
  dataDir: DATA_DIR,
  csvFilePath: path.join(DATA_DIR, 'expenses.csv'),
  processedEmailsPath: path.join(DATA_DIR, 'processed-emails.json'),
  merchantMappingPath: path.join(DATA_DIR, 'merchant-mapping.json'),
  credentialsPath: path.join(DATA_DIR, 'credentials.json'),
  tokenPath: path.join(DATA_DIR, 'token.json'),

  // OAuth
  oauthRedirectHost: '127.0.0.1',
  oauthRedirectPort: 3001,

  // CSV columns
  csvHeaders: ['date', 'amount', 'currency', 'type', 'merchant', 'category', 'rawDescription', 'emailId'],

  // Log file for skipped and errored emails
  activityLogPath: path.join(DATA_DIR, 'activity.log'),
};
