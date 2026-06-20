import type { AccountType } from '../types'

export function formatCurrency(amount: number | null | undefined, currency = 'INR'): string {
  if (amount == null) return '—'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  // Try as ISO first; fallback to raw value
  const d = new Date(value)
  if (isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatDateShort(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  credit_card: 'Credit Card',
  savings: 'Savings',
  salary: 'Salary A/C',
  debit_card: 'Debit Card',
}

export function labelAccountType(type: AccountType | string): string {
  return ACCOUNT_TYPE_LABELS[type as AccountType] ?? type
}

export const TXN_TYPE_LABELS: Record<string, string> = {
  expense_dr: 'Expense (DR)',
  expense_cr: 'Refund (CR)',
  manual_credit: 'Manual Credit',
  manual_debit: 'Manual Debit',
  payment: 'Bill Payment',
  opening_balance: 'Opening Balance',
}

export function labelTxnType(type: string): string {
  return TXN_TYPE_LABELS[type] ?? type
}

/** Returns true if the account holds funds you own (not owed). */
export function isAssetAccount(type: AccountType | string): boolean {
  return type === 'savings' || type === 'salary' || type === 'debit_card'
}
