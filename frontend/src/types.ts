export type AccountType = 'credit_card' | 'savings' | 'salary' | 'debit_card'
export type ExpenseType = 'DR' | 'CR'

export interface Account {
  id: number
  name: string
  account_type: AccountType
  account_last4: string
  currency: string
  balance: number
  credit_limit: number | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Expense {
  id: number
  email_id: string
  label: string | null
  date: string | null
  amount: number | null
  currency: string | null
  type: ExpenseType | null
  merchant: string | null
  category: string | null
  raw_description: string | null
  available_credit_limit: number | null
  account_type: string | null
  account_last4: string | null
  notes: string | null
  created_at: string
}

export interface AccountTxn {
  id: number
  account_id: number
  type: string
  amount: number
  balance_after: number
  description: string | null
  expense_id: number | null
  created_at: string
}

export interface SyncStats {
  parsed: number
  skipped: number
  errors: number
  recategorized: number
}

export interface UncategorizedMerchant {
  merchant: string
  count: number
  total: number
}

export interface CreateAccountPayload {
  name: string
  accountType: AccountType
  accountLast4: string
  currency?: string
  balance?: number
  creditLimit?: number | null
}
