import { useQuery } from '@tanstack/react-query'
import { getExpenses } from '../lib/api'

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
