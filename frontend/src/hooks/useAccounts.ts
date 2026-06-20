import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addFunds,
  backfill,
  createAccount,
  getAccount,
  getAccounts,
  getAccountTransactions,
  payBill,
} from '../lib/api'
import type { CreateAccountPayload } from '../types'

export const ACCOUNTS_KEY = ['accounts'] as const

export function useAccounts(activeOnly = true) {
  return useQuery({
    queryKey: [...ACCOUNTS_KEY, activeOnly],
    queryFn: () => getAccounts(activeOnly),
  })
}

export function useAccount(id: number) {
  return useQuery({
    queryKey: ['account', id],
    queryFn: () => getAccount(id),
    enabled: !!id,
  })
}

export function useAccountTransactions(id: number, limit = 50) {
  return useQuery({
    queryKey: ['account-txns', id, limit],
    queryFn: () => getAccountTransactions(id, limit),
    enabled: !!id,
  })
}

export function useCreateAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateAccountPayload) => createAccount(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCOUNTS_KEY }),
  })
}

export function useAddFunds(accountId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ amount, description }: { amount: number; description?: string }) =>
      addFunds(accountId, amount, description),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACCOUNTS_KEY })
      qc.invalidateQueries({ queryKey: ['account', accountId] })
      qc.invalidateQueries({ queryKey: ['account-txns', accountId] })
    },
  })
}

export function usePayBill(accountId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ amount, description }: { amount: number; description?: string }) =>
      payBill(accountId, amount, description),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACCOUNTS_KEY })
      qc.invalidateQueries({ queryKey: ['account', accountId] })
      qc.invalidateQueries({ queryKey: ['account-txns', accountId] })
    },
  })
}

export function useBackfill(accountId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => backfill(accountId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACCOUNTS_KEY })
      qc.invalidateQueries({ queryKey: ['account', accountId] })
      qc.invalidateQueries({ queryKey: ['account-txns', accountId] })
    },
  })
}
