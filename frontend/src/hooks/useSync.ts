import { useMutation, useQueryClient } from '@tanstack/react-query'
import { runSync } from '../lib/api'
import { ACCOUNTS_KEY } from './useAccounts'

export function useSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: runSync,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ACCOUNTS_KEY })
      qc.invalidateQueries({ queryKey: ['expenses'] })
    },
  })
}
