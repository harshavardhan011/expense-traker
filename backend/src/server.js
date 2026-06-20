require('dotenv').config();
const express = require('express');
const { bootstrapSchema } = require('./services/db-bootstrap');
const {
  listAccounts,
  createAccount,
  getAccountById,
  getAccountTransactions,
  addFunds,
  recordPayment,
  backfillAccountBalance,
} = require('./services/account-manager');
const { listExpenses, getExpenseById } = require('./services/expense-reader');
const { runSync } = require('./pipeline');

const app = express();
app.use(express.json());

// Wrap async route handlers so thrown errors reach the error middleware
const ah = fn => (req, res, next) => fn(req, res, next).catch(next);

// ─── Sync concurrency guard ───────────────────────────────────────────────────
let syncRunning = false;

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true }));

// Accounts
app.get('/accounts', ah(async (req, res) => {
  const activeOnly = req.query.activeOnly !== 'false';
  const data = await listAccounts({ activeOnly });
  res.json(data);
}));

app.post('/accounts', ah(async (req, res) => {
  const account = await createAccount(req.body);
  res.status(201).json(account);
}));

app.get('/accounts/:id', ah(async (req, res) => {
  const account = await getAccountById(Number(req.params.id));
  res.json(account);
}));

app.get('/accounts/:id/transactions', ah(async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 20;
  const txns = await getAccountTransactions(Number(req.params.id), limit);
  res.json(txns);
}));

app.post('/accounts/:id/add-funds', ah(async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || isNaN(amount) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  const newBalance = await addFunds(Number(req.params.id), Number(amount), description);
  res.json({ balance: newBalance });
}));

app.post('/accounts/:id/pay', ah(async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || isNaN(amount) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  const newBalance = await recordPayment(Number(req.params.id), Number(amount), description);
  res.json({ balance: newBalance });
}));

app.post('/accounts/:id/backfill', ah(async (req, res) => {
  const result = await backfillAccountBalance(Number(req.params.id));
  res.json(result);
}));

// Expenses
app.get('/expenses', ah(async (req, res) => {
  const { limit, offset, category, accountLast4 } = req.query;
  const data = await listExpenses({
    limit: limit ? Number(limit) : 50,
    offset: offset ? Number(offset) : 0,
    category,
    accountLast4,
  });
  res.json(data);
}));

app.get('/expenses/:id', ah(async (req, res) => {
  const expense = await getExpenseById(Number(req.params.id));
  res.json(expense);
}));

// Sync
app.post('/sync', ah(async (_req, res) => {
  if (syncRunning) {
    return res.status(409).json({ error: 'sync already in progress' });
  }
  syncRunning = true;
  try {
    const stats = await runSync();
    res.json(stats);
  } finally {
    syncRunning = false;
  }
}));

// ─── Error handler ────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[server error]', err.message);
  res.status(500).json({ error: err.message });
});

// ─── Startup ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await bootstrapSchema();
  } catch (err) {
    console.error('Schema bootstrap failed:', err.message);
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Endpoints: GET /health, GET /accounts, GET /expenses, POST /sync, ...');
    console.log('Note: POST /sync requires a pre-authorized data/token.json (run: npm run auth)');
  });
})();
