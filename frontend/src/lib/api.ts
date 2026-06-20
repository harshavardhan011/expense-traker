import type { Account, AccountTxn, CreateAccountPayload, Expense, SyncStats } from '../types'

const BASE = '/api'

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new ApiError(res.status, body.error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }))
    throw new ApiError(res.status, data.error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export function getAccounts(activeOnly = true): Promise<Account[]> {
  return apiGet(`/accounts?activeOnly=${activeOnly}`)
}

export function getAccount(id: number): Promise<Account> {
  return apiGet(`/accounts/${id}`)
}

export function createAccount(payload: CreateAccountPayload): Promise<{ id: number; balance: number }> {
  return apiPost('/accounts', payload)
}

export function getAccountTransactions(id: number, limit = 50): Promise<AccountTxn[]> {
  return apiGet(`/accounts/${id}/transactions?limit=${limit}`)
}

export function addFunds(id: number, amount: number, description?: string): Promise<{ balance: number }> {
  return apiPost(`/accounts/${id}/add-funds`, { amount, description })
}

export function payBill(id: number, amount: number, description?: string): Promise<{ balance: number }> {
  return apiPost(`/accounts/${id}/pay`, { amount, description })
}

export function backfill(id: number): Promise<{ balance: number; expensesLinked: number }> {
  return apiPost(`/accounts/${id}/backfill`)
}

// ─── Expenses ────────────────────────────────────────────────────────────────

export function getExpenses(params?: {
  limit?: number
  offset?: number
  category?: string
  accountLast4?: string
}): Promise<Expense[]> {
  const qs = new URLSearchParams()
  if (params?.limit != null) qs.set('limit', String(params.limit))
  if (params?.offset != null) qs.set('offset', String(params.offset))
  if (params?.category) qs.set('category', params.category)
  if (params?.accountLast4) qs.set('accountLast4', params.accountLast4)
  const q = qs.toString()
  return apiGet(`/expenses${q ? `?${q}` : ''}`)
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

export function runSync(): Promise<SyncStats> {
  return apiPost('/sync')
}

export { ApiError }
