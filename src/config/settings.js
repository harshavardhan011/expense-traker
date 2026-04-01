const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const DATA_DIR = path.join(__dirname, '../../data');

module.exports = {
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: 'gemini-2.5-flash',

  // Gmail settings
  gmailLabels: (process.env.GMAIL_LABELS || process.env.GMAIL_LABEL || 'bank-alerts')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  fetchWindowHours: parseInt(process.env.FETCH_WINDOW_HOURS || '24', 10),
  geminiBatchSize: parseInt(process.env.GEMINI_BATCH_SIZE || '20', 10),
  // Minutes subtracted from last processed_at to absorb clock skew / in-flight emails
  overlapBufferMinutes: parseInt(process.env.OVERLAP_BUFFER_MINUTES || '10', 10),
  // How long to retain rows in processed_emails; must be >= fetchWindowHours
  processedEmailsRetentionHours: parseInt(
    process.env.PROCESSED_EMAILS_RETENTION_HOURS ||
    String(parseInt(process.env.FETCH_WINDOW_HOURS || '24', 10) * 2),
    10
  ),

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
  csvHeaders: [
    'label',
    'date',
    'amount',
    'currency',
    'type',
    'merchant',
    'category',
    'rawDescription',
    'availableCreditLimit',
    'accountType',
    'accountLast4',
    'emailId',
  ],

  // Log file for skipped and errored emails
  activityLogPath: path.join(DATA_DIR, 'activity.log'),

  // Supabase
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
};
