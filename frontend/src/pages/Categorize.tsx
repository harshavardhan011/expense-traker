import { useState } from 'react'
import {
  useUncategorizedMerchants,
  useSetCategory,
  useCategoryStats,
  useRenameCategory,
  useDeleteCategory,
} from '../hooks/useCategories'
import { useToast } from '../context/ToastContext'
import { formatCurrency } from '../lib/format'
import { isPresetCategory } from '../lib/categories'
import { CategoryPicker } from '../components/CategoryPicker'
import { Badge } from '../components/Badge'
import { ErrorState } from '../components/ErrorState'
import { Spinner } from '../components/Spinner'

interface RowState {
  category: string
  saving: boolean
}

/** A single row in the "Manage categories" panel — handles its own rename/delete UI state. */
function ManageCategoryRow({ category, count }: { category: string; count: number }) {
  const locked = isPresetCategory(category)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState(category)
  const renameCategory = useRenameCategory()
  const deleteCategory = useDeleteCategory()
  const { toast } = useToast()

  async function handleRename() {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === category) { setRenaming(false); return }
    try {
      const result = await renameCategory.mutateAsync({ from: category, to: trimmed })
      toast(`Renamed "${category}" → "${trimmed}". ${result.updated} expense${result.updated === 1 ? '' : 's'} updated.`, 'success')
      setRenaming(false)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Rename failed', 'error')
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${category}"? ${count} expense${count === 1 ? '' : 's'} will become Uncategorized.`)) return
    try {
      const result = await deleteCategory.mutateAsync(category)
      toast(`Deleted "${category}". ${result.reassigned} expense${result.reassigned === 1 ? '' : 's'} reassigned to Uncategorized.`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed', 'error')
    }
  }

  const busy = renameCategory.isPending || deleteCategory.isPending

  return (
    <tr className="hover:bg-slate-50/60 transition-colors">
      <td className="px-5 py-3">
        {renaming ? (
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            disabled={busy}
            className="border border-slate-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 w-44"
          />
        ) : (
          <Badge label={category} />
        )}
      </td>
      <td className="px-5 py-3 text-center text-slate-500">{count}</td>
      <td className="px-5 py-3 text-right">
        {locked ? (
          <span className="text-xs text-slate-300">locked</span>
        ) : renaming ? (
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={handleRename}
              disabled={busy}
              className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 transition-colors"
            >
              {renameCategory.isPending ? <Spinner size="sm" /> : null}
              Save
            </button>
            <button onClick={() => setRenaming(false)} className="text-xs text-slate-400 hover:text-slate-600">
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={() => { setNewName(category); setRenaming(true) }}
              disabled={busy}
              className="text-xs font-medium text-slate-500 hover:text-slate-800 disabled:opacity-40"
            >
              Rename
            </button>
            <button
              onClick={handleDelete}
              disabled={busy}
              className="flex items-center gap-1 text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-40"
            >
              {deleteCategory.isPending ? <Spinner size="sm" /> : null}
              Delete
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

/** Shows category count summary and lets custom categories be renamed/deleted. */
function ManageCategoriesPanel() {
  const { data, isLoading, error } = useCategoryStats()

  if (isLoading) return null
  if (error) return <ErrorState message={(error as Error).message} />
  if (!data?.length) return null

  const customCount = data.filter((c) => !isPresetCategory(c.category)).length

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-500">
        {data.length} categor{data.length === 1 ? 'y' : 'ies'} · {customCount} custom
      </p>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left">
              <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Category</th>
              <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-center">Expenses</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {data.map((c) => <ManageCategoryRow key={c.category} category={c.category} count={c.count} />)}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function Categorize() {
  const { data, isLoading, error } = useUncategorizedMerchants()
  const setCategory = useSetCategory()
  const { toast } = useToast()

  // per-row state: { [merchant]: RowState }
  const [rowState, setRowState] = useState<Record<string, RowState>>({})

  function getRow(merchant: string): RowState {
    return rowState[merchant] ?? { category: '', saving: false }
  }

  function setRow(merchant: string, patch: Partial<RowState>) {
    setRowState((prev) => ({ ...prev, [merchant]: { ...getRow(merchant), ...patch } }))
  }

  async function handleSave(merchant: string) {
    const row = getRow(merchant)
    if (!row.category) return
    setRow(merchant, { saving: true })
    try {
      const result = await setCategory.mutateAsync({ merchant, category: row.category })
      toast(
        `Mapped "${merchant}" → "${row.category}". ${result.recategorized} expense${result.recategorized === 1 ? '' : 's'} updated.`,
        'success',
      )
      // Clean up local state for this merchant (it disappears from the list after refetch)
      setRowState((prev) => {
        const next = { ...prev }
        delete next[merchant]
        return next
      })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save', 'error')
      setRow(merchant, { saving: false })
    }
  }

  if (isLoading) return (
    <div className="flex items-center justify-center h-full"><Spinner size="lg" /></div>
  )
  if (error) return <ErrorState message={(error as Error).message} />

  if (!data?.length) {
    return (
      <div className="flex flex-col gap-8">
        <div className="flex flex-col items-center justify-center py-24">
          <span className="text-5xl mb-4">🎉</span>
          <p className="text-lg font-semibold text-slate-700">All caught up!</p>
          <p className="text-sm text-slate-400 mt-1">Nothing to categorize — every merchant has a mapping.</p>
        </div>
        <ManageCategoriesPanel />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-500">
        {data.length} merchant{data.length === 1 ? '' : 's'} need a category. Assigning one here will retroactively update all their past expenses.
      </p>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left">
              <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Merchant</th>
              <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-center">Txns</th>
              <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Total spent</th>
              <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Category</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {data.map((item) => {
              const row = getRow(item.merchant)
              return (
                <tr key={item.merchant} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-5 py-3 font-medium text-slate-700 max-w-[200px] truncate">
                    {item.merchant}
                  </td>
                  <td className="px-5 py-3 text-center text-slate-500">{item.count}</td>
                  <td className="px-5 py-3 text-right font-semibold text-red-600 tabular-nums">
                    {formatCurrency(item.total)}
                  </td>
                  <td className="px-5 py-3">
                    <CategoryPicker
                      value={row.category || undefined}
                      onChange={(cat) => setRow(item.merchant, { category: cat })}
                      disabled={row.saving}
                      className="w-48"
                    />
                  </td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => handleSave(item.merchant)}
                      disabled={!row.category || row.saving}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                    >
                      {row.saving ? <Spinner size="sm" /> : null}
                      {row.saving ? 'Saving…' : 'Save'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      </div>

      <ManageCategoriesPanel />
    </div>
  )
}
