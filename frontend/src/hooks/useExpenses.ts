import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getExpenses, updateExpenseNotes } from '../lib/api'

export function useExpenses(params?: {
  limit?: number
  offset?: number
  category?: string
  accountLast4?: string
}) {
  return useQuery({
    queryKey: ['expenses', params],
    queryFn: () => getExpenses(params),
  })
}

export function useUpdateNotes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, notes }: { id: number; notes: string }) => updateExpenseNotes(id, notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] })
    },
  })
}
