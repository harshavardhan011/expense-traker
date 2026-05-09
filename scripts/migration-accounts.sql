-- Migration: create_accounts_tables
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)

-- 1. accounts table
CREATE TABLE accounts (
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

-- 2. account_transactions audit trail
CREATE TABLE account_transactions (
  id              BIGSERIAL PRIMARY KEY,
  account_id      BIGINT NOT NULL REFERENCES accounts(id),
  type            TEXT NOT NULL CHECK (type IN (
                    'expense_dr','expense_cr',
                    'manual_credit','manual_debit',
                    'payment','opening_balance'
                  )),
  amount          NUMERIC(12,2) NOT NULL,
  balance_after   NUMERIC(12,2) NOT NULL,
  description     TEXT,
  expense_id      BIGINT REFERENCES expenses(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_acct_txn_account_id ON account_transactions(account_id);
CREATE INDEX idx_acct_txn_expense_id ON account_transactions(expense_id);

-- 3. Atomic balance update RPC function
CREATE OR REPLACE FUNCTION update_account_balance(
  p_account_id BIGINT,
  p_delta NUMERIC(12,2),
  p_txn_type TEXT,
  p_description TEXT DEFAULT NULL,
  p_expense_id BIGINT DEFAULT NULL
) RETURNS NUMERIC(12,2) AS $$
DECLARE
  v_new_balance NUMERIC(12,2);
BEGIN
  UPDATE accounts
    SET balance = balance + p_delta,
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
