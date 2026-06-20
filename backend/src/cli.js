const readline = require('readline');
const {
  createAccount,
  listAccounts,
  resolveAccount,
  addFunds,
  recordPayment,
  getAccountTransactions,
  backfillAccountBalance,
} = require('./services/account-manager');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function printTable(rows, columns) {
  if (rows.length === 0) {
    console.log('  (none)');
    return;
  }

  // Compute column widths
  const widths = columns.map(col =>
    Math.max(col.header.length, ...rows.map(r => String(col.value(r)).length))
  );

  // Header
  const header = columns.map((col, i) => col.header.padEnd(widths[i])).join('  ');
  console.log(`  ${header}`);
  console.log(`  ${widths.map(w => '─'.repeat(w)).join('──')}`);

  // Rows
  for (const row of rows) {
    const line = columns.map((col, i) => {
      const val = String(col.value(row));
      return col.align === 'right' ? val.padStart(widths[i]) : val.padEnd(widths[i]);
    }).join('  ');
    console.log(`  ${line}`);
  }
}

/**
 * Resolve a last4/id to exactly one account. Exits on ambiguity or not found.
 */
async function resolveOne(identifier) {
  const matches = await resolveAccount(identifier);
  if (matches.length === 0) {
    console.error(`No account found for "${identifier}".`);
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`Multiple accounts match "${identifier}":`);
    for (const m of matches) {
      console.error(`  [${m.id}] ${m.name} (${m.account_type} / ${m.account_last4})`);
    }
    console.error('Please use the account ID instead.');
    process.exit(1);
  }
  return matches[0];
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdList() {
  const accounts = await listAccounts();
  if (accounts.length === 0) {
    console.log('\nNo accounts found. Use "account add" to create one.\n');
    return;
  }

  console.log('\n─── Accounts ───────────────────────────────────────');
  printTable(accounts, [
    { header: 'ID', value: r => r.id, align: 'right' },
    { header: 'Name', value: r => r.name },
    { header: 'Type', value: r => r.account_type },
    { header: 'Last4', value: r => r.account_last4 },
    { header: 'Balance', value: r => `${r.currency} ${Number(r.balance).toFixed(2)}`, align: 'right' },
    { header: 'Credit Limit', value: r => r.credit_limit ? `${r.currency} ${Number(r.credit_limit).toFixed(2)}` : '—', align: 'right' },
  ]);
  console.log('────────────────────────────────────────────────────\n');
}

async function cmdAdd() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log('\n─── Add New Account ───');

    const name = await ask(rl, 'Account name (e.g., "HDFC Platinum"): ');
    if (!name.trim()) { console.error('Name is required.'); return; }

    console.log('Account types: credit_card, savings, salary, debit_card');
    const accountType = (await ask(rl, 'Account type: ')).trim().toLowerCase();
    if (!['credit_card', 'savings', 'salary', 'debit_card'].includes(accountType)) {
      console.error('Invalid account type.');
      return;
    }

    const accountLast4 = (await ask(rl, 'Last 4 digits of card/account: ')).trim();
    if (!/^\d{4}$/.test(accountLast4)) {
      console.error('Must be exactly 4 digits.');
      return;
    }

    const currency = (await ask(rl, 'Currency (default INR): ')).trim().toUpperCase() || 'INR';

    const balanceStr = await ask(rl,
      accountType === 'credit_card'
        ? 'Current unbilled amount (default 0): '
        : 'Current balance (default 0): '
    );
    const balance = parseFloat(balanceStr) || 0;

    let creditLimit = null;
    if (accountType === 'credit_card') {
      const limitStr = await ask(rl, 'Credit limit (or press Enter to skip): ');
      creditLimit = parseFloat(limitStr) || null;
    }

    const result = await createAccount({ name: name.trim(), accountType, accountLast4, currency, balance, creditLimit });
    console.log(`\nAccount created (ID: ${result.id}). Balance: ${balance}`);

  } finally {
    rl.close();
  }
}

async function cmdAddFunds(identifier) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const account = await resolveOne(identifier);

    if (account.account_type === 'credit_card') {
      console.error('Use "account pay" for credit card payments.');
      return;
    }

    console.log(`\n─── Add Funds to: ${account.name} (${account.account_type}/${account.account_last4}) ───`);
    console.log(`Current balance: ${account.currency} ${Number(account.balance).toFixed(2)}\n`);

    const amountStr = await ask(rl, 'Amount to add: ');
    const amount = parseFloat(amountStr);
    if (!amount || amount <= 0) { console.error('Invalid amount.'); return; }

    const description = (await ask(rl, 'Description (e.g., "Salary April"): ')).trim() || 'Manual credit';

    const newBalance = await addFunds(account.id, amount, description);
    console.log(`\nDone. New balance: ${account.currency} ${Number(newBalance).toFixed(2)}`);

  } finally {
    rl.close();
  }
}

async function cmdPay(identifier) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const account = await resolveOne(identifier);

    if (account.account_type !== 'credit_card') {
      console.error('Payments are only for credit card accounts. Use "account add-funds" for savings/salary.');
      return;
    }

    console.log(`\n─── Record Payment for: ${account.name} (${account.account_last4}) ───`);
    console.log(`Current unbilled: ${account.currency} ${Number(account.balance).toFixed(2)}\n`);

    const amountStr = await ask(rl, 'Payment amount: ');
    const amount = parseFloat(amountStr);
    if (!amount || amount <= 0) { console.error('Invalid amount.'); return; }

    const description = (await ask(rl, 'Description (e.g., "April bill payment"): ')).trim() || 'Bill payment';

    const newBalance = await recordPayment(account.id, amount, description);
    console.log(`\nDone. New unbilled: ${account.currency} ${Number(newBalance).toFixed(2)}`);

  } finally {
    rl.close();
  }
}

async function cmdHistory(identifier) {
  const account = await resolveOne(identifier);

  console.log(`\n─── Transaction History: ${account.name} (${account.account_type}/${account.account_last4}) ───`);
  console.log(`Current balance: ${account.currency} ${Number(account.balance).toFixed(2)}\n`);

  const txns = await getAccountTransactions(account.id, 30);

  if (txns.length === 0) {
    console.log('  No transactions yet.\n');
    return;
  }

  printTable(txns, [
    { header: 'Date', value: r => new Date(r.created_at).toLocaleDateString('en-IN') },
    { header: 'Type', value: r => r.type },
    { header: 'Amount', value: r => Number(r.amount).toFixed(2), align: 'right' },
    { header: 'Balance After', value: r => Number(r.balance_after).toFixed(2), align: 'right' },
    { header: 'Description', value: r => (r.description || '').slice(0, 50) },
  ]);
  console.log('');
}

async function cmdBackfill(identifier) {
  const account = await resolveOne(identifier);

  console.log(`\nBackfilling balance for: ${account.name} (${account.account_type}/${account.account_last4})...`);

  const { balance, expensesLinked } = await backfillAccountBalance(account.id);
  console.log(`Done. Linked ${expensesLinked} new expense(s). Balance: ${account.currency} ${Number(balance).toFixed(2)}\n`);
}

// ─── Usage ───────────────────────────────────────────────────────────────────

function printUsage() {
  console.log(`
Usage: node src/cli.js account <command> [args]

Commands:
  list                      List all accounts with balances
  add                       Add a new account (interactive)
  add-funds <last4|id>      Add funds to a savings/salary account
  pay <last4|id>            Record a credit card payment
  history <last4|id>        Show transaction history
  backfill <last4|id>       Recalculate balance from existing expenses
`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args[0] !== 'account' || args.length < 2) {
    printUsage();
    process.exit(1);
  }

  const command = args[1];
  const arg = args[2];

  switch (command) {
    case 'list':
      await cmdList();
      break;
    case 'add':
      await cmdAdd();
      break;
    case 'add-funds':
      if (!arg) { console.error('Usage: account add-funds <last4|id>'); process.exit(1); }
      await cmdAddFunds(arg);
      break;
    case 'pay':
      if (!arg) { console.error('Usage: account pay <last4|id>'); process.exit(1); }
      await cmdPay(arg);
      break;
    case 'history':
      if (!arg) { console.error('Usage: account history <last4|id>'); process.exit(1); }
      await cmdHistory(arg);
      break;
    case 'backfill':
      if (!arg) { console.error('Usage: account backfill <last4|id>'); process.exit(1); }
      await cmdBackfill(arg);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
