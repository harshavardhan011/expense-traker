import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  deleteCategory,
  getCategories,
  getCategoryStats,
  getUncategorizedMerchants,
  renameCategory,
  setMerchantCategory,
} from '../lib/api'

export const CATEGORIES_KEY = ['categories'] as const
export const UNCATEGORIZED_KEY = ['uncategorized-merchants'] as const
export const CATEGORY_STATS_KEY = ['category-stats'] as const

export function useCategories() {
  return useQuery({
    queryKey: CATEGORIES_KEY,
    queryFn: getCategories,
    staleTime: 60_000,
  })
}

export function useCategoryStats() {
  return useQuery({
    queryKey: CATEGORY_STATS_KEY,
    queryFn: getCategoryStats,
  })
}

export function useUncategorizedMerchants() {
  return useQuery({
    queryKey: UNCATEGORIZED_KEY,
    queryFn: getUncategorizedMerchants,
  })
}

export function useSetCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ merchant, category }: { merchant: string; category: string }) =>
      setMerchantCategory(merchant, category),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] })
      qc.invalidateQueries({ queryKey: UNCATEGORIZED_KEY })
      qc.invalidateQueries({ queryKey: CATEGORIES_KEY })
      qc.invalidateQueries({ queryKey: CATEGORY_STATS_KEY })
    },
  })
}

function invalidateCategoryQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['expenses'] })
  qc.invalidateQueries({ queryKey: UNCATEGORIZED_KEY })
  qc.invalidateQueries({ queryKey: CATEGORIES_KEY })
  qc.invalidateQueries({ queryKey: CATEGORY_STATS_KEY })
}

export function useRenameCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => renameCategory(from, to),
    onSuccess: () => invalidateCategoryQueries(qc),
  })
}

export function useDeleteCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => deleteCategory(name),
    onSuccess: () => invalidateCategoryQueries(qc),
  })
}
