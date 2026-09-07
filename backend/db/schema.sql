-- Single source of truth for all PostgreSQL tables.
-- Every statement is idempotent (IF NOT EXISTS / OR REPLACE).
-- Applied automatically on `npm start` when DATABASE_URL is set.

-- ─── expenses ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expenses (
  id                     BIGSERIAL PRIMARY KEY,
  email_id               TEXT UNIQUE NOT NULL,
  label                  TEXT,
  date                   TEXT,
  amount                 NUMERIC(12,2),
  currency               CHAR(3),
  type                   TEXT,
  merchant               TEXT,
  category               TEXT,
  raw_description        TEXT,
  available_credit_limit NUMERIC(12,2),
  account_type           TEXT,
  account_last4          TEXT,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

-- ─── merchant_mappings ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS merchant_mappings (
  merchant  TEXT PRIMARY KEY,
  category  TEXT NOT NULL
);

-- ─── activity_logs ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_logs (
  id         BIGSERIAL PRIMARY KEY,
  level      TEXT NOT NULL,
  email_id   TEXT,
  subject    TEXT,
  detail     TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── processed_emails ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS processed_emails (
  email_id     TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processed_emails_processed_at
  ON processed_emails (processed_at);

-- ─── accounts ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  account_type  TEXT NOT NULL CHECK (account_type IN (
                  'credit_card','savings','salary','debit_card'
                )),
  account_last4 TEXT NOT NULL,
  currency      CHAR(3) NOT NULL DEFAULT 'INR',
  balance       NUMERIC(12,2) NOT NULL DEFAULT 0,
  credit_limit  NUMERIC(12,2),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_type, account_last4)
);

-- ─── account_transactions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS account_transactions (
  id           BIGSERIAL PRIMARY KEY,
  account_id   BIGINT NOT NULL REFERENCES accounts(id),
  type         TEXT NOT NULL CHECK (type IN (
                 'expense_dr','expense_cr',
                 'manual_credit','manual_debit',
                 'payment','opening_balance'
               )),
  amount       NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  description  TEXT,
  expense_id   BIGINT REFERENCES expenses(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_acct_txn_account_id ON account_transactions (account_id);
CREATE INDEX IF NOT EXISTS idx_acct_txn_expense_id ON account_transactions (expense_id);

-- ─── update_account_balance RPC ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_account_balance(
  p_account_id  BIGINT,
  p_delta       NUMERIC(12,2),
  p_txn_type    TEXT,
  p_description TEXT DEFAULT NULL,
  p_expense_id  BIGINT DEFAULT NULL
) RETURNS NUMERIC(12,2) AS $$
DECLARE
  v_new_balance NUMERIC(12,2);
BEGIN
  UPDATE accounts
    SET balance    = balance + p_delta,
        updated_at = NOW()
    WHERE id = p_account_id
    RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account % not found', p_account_id;
  END IF;

  INSERT INTO account_transactions (account_id, type, amount, balance_after, description, expense_id)
  VALUES (p_account_id, p_txn_type, ABS(p_delta), v_new_balance, p_description, p_expense_id);

  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql;
