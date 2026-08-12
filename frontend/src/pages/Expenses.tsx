import { useState } from 'react'
import { useExpenses, useUpdateNotes } from '../hooks/useExpenses'
import { useSetCategory } from '../hooks/useCategories'
import { useToast } from '../context/ToastContext'
import { formatCurrency, formatDate } from '../lib/format'
import { Badge } from '../components/Badge'
import { CategoryPicker } from '../components/CategoryPicker'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Spinner } from '../components/Spinner'

const PAGE_SIZE = 50

/** Inline category editor shown when a badge is clicked. */
function InlineCategoryEditor({
  expenseId,
  merchant,
  currentCategory,
  onDone,
}: {
  expenseId: number
  merchant: string | null
  currentCategory: string | null
  onDone: () => void
}) {
  const [picked, setPicked] = useState(currentCategory ?? '')
  const setCategory = useSetCategory()
  const { toast } = useToast()

  async function handleSave() {
    if (!picked || !merchant) return
    try {
      const result = await setCategory.mutateAsync({ merchant, category: picked })
      toast(
        `Mapped "${merchant}" → "${picked}". ${result.recategorized} expense${result.recategorized === 1 ? '' : 's'} updated.`,
        'success',
      )
      onDone()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed', 'error')
    }
  }

  void expenseId // not used directly but kept in signature for clarity

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <CategoryPicker
        value={picked || undefined}
        onChange={setPicked}
        disabled={setCategory.isPending}
        className="w-44"
      />
      <button
        onClick={handleSave}
        disabled={!picked || setCategory.isPending}
        className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 transition-colors"
      >
        {setCategory.isPending ? <Spinner size="sm" /> : null}
        Save
      </button>
      <button
        onClick={onDone}
        className="text-xs text-slate-400 hover:text-slate-600"
      >
        Cancel
      </button>
    </div>
  )
}

/** Inline notes editor shown when a row's notes cell is clicked. */
function InlineNotesEditor({
  expenseId,
  currentNotes,
  onDone,
}: {
  expenseId: number
  currentNotes: string | null
  onDone: () => void
}) {
  const [value, setValue] = useState(currentNotes ?? '')
  const updateNotes = useUpdateNotes()
  const { toast } = useToast()

  async function handleSave() {
    try {
      await updateNotes.mutateAsync({ id: expenseId, notes: value })
      toast('Note saved.', 'success')
      onDone()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save note', 'error')
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        list="notes-suggestions"
        placeholder="Add a note…"
        autoFocus
        disabled={updateNotes.isPending}
        className="border border-slate-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 w-40"
      />
      <button
        onClick={handleSave}
        disabled={updateNotes.isPending}
        className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 transition-colors"
      >
        {updateNotes.isPending ? <Spinner size="sm" /> : null}
        Save
      </button>
      <button
        onClick={onDone}
        className="text-xs text-slate-400 hover:text-slate-600"
      >
        Cancel
      </button>
    </div>
  )
}

export function Expenses() {
  const [offset, setOffset] = useState(0)
  const [category, setCategory] = useState('')
  const [accountLast4, setAccountLast4] = useState('')
  const [editingExpenseId, setEditingExpenseId] = useState<number | null>(null)
  const [editingNotesId, setEditingNotesId] = useState<number | null>(null)

  const { data, isLoading, error } = useExpenses({
    limit: PAGE_SIZE,
    offset,
    category: category || undefined,
    accountLast4: accountLast4 || undefined,
  })

  function reset() {
    setOffset(0)
    setCategory('')
    setAccountLast4('')
  }

  const notesSuggestions = [...new Set((data ?? []).map((e) => e.notes).filter((n): n is string => !!n))]

  return (
    <div className="flex flex-col gap-4">
      <datalist id="notes-suggestions">
        {notesSuggestions.map((n) => <option key={n} value={n} />)}
      </datalist>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 px-5 py-4 flex flex-wrap items-center gap-3">
        <input
          value={category}
          onChange={(e) => { setCategory(e.target.value); setOffset(0) }}
          placeholder="Filter by category"
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-48"
        />
        <input
          value={accountLast4}
          onChange={(e) => { setAccountLast4(e.target.value.replace(/\D/g, '').slice(0, 4)); setOffset(0) }}
          placeholder="Account last 4"
          maxLength={4}
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-36"
        />
        {(category || accountLast4) && (
          <button onClick={reset} className="text-xs text-slate-500 hover:text-slate-800 underline">
            Clear filters
          </button>
        )}
        <span className="ml-auto text-xs text-slate-400">
          {isLoading ? '' : `${data?.length ?? 0} rows`}
        </span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>
        ) : error ? (
          <ErrorState message={(error as Error).message} />
        ) : !data?.length ? (
          <EmptyState message="No expenses found" icon="🧾" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left">
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Merchant</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Category
                    <span className="ml-1 text-slate-400 normal-case font-normal">(click to remap)</span>
                  </th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Account</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Notes</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {data.map((exp) => (
                  <tr key={exp.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-3 text-slate-500 text-xs whitespace-nowrap">
                      {formatDate(exp.date ?? exp.created_at)}
                    </td>
                    <td className="px-5 py-3 font-medium text-slate-700 max-w-[180px] truncate">
                      {exp.merchant ?? '—'}
                    </td>
                    <td className="px-5 py-3 min-w-[200px]">
                      {editingExpenseId === exp.id ? (
                        <InlineCategoryEditor
                          expenseId={exp.id}
                          merchant={exp.merchant}
                          currentCategory={exp.category}
                          onDone={() => setEditingExpenseId(null)}
                        />
                      ) : (
                        <button
                          onClick={() => exp.merchant && setEditingExpenseId(exp.id)}
                          title={exp.merchant ? 'Click to remap merchant category' : 'No merchant — cannot remap'}
                          className="group flex items-center gap-1"
                        >
                          <Badge label={exp.category ?? 'Uncategorized'} />
                          {exp.merchant && (
                            <span className="text-slate-300 group-hover:text-slate-500 transition-colors text-xs">✏️</span>
                          )}
                        </button>
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-500 text-xs whitespace-nowrap">
                      {exp.account_type && exp.account_last4
                        ? `${exp.account_type.replace('_', ' ')} ••${exp.account_last4}`
                        : '—'}
                    </td>
                    <td className="px-5 py-3 min-w-[160px]">
                      {editingNotesId === exp.id ? (
                        <InlineNotesEditor
                          expenseId={exp.id}
                          currentNotes={exp.notes}
                          onDone={() => setEditingNotesId(null)}
                        />
                      ) : (
                        <button
                          onClick={() => setEditingNotesId(exp.id)}
                          title="Click to add/edit note"
                          className="group flex items-center gap-1 max-w-[180px] text-left"
                        >
                          <span className={exp.notes ? 'text-slate-600 text-xs truncate' : 'text-slate-300 text-xs italic'}>
                            {exp.notes || '+ add note'}
                          </span>
                          <span className="text-slate-300 group-hover:text-slate-500 transition-colors text-xs">✏️</span>
                        </button>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums whitespace-nowrap">
                      <span className={exp.type === 'DR' ? 'text-red-600' : 'text-emerald-600'}>
                        {exp.type === 'DR' ? '-' : '+'}{formatCurrency(exp.amount, exp.currency ?? undefined)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!isLoading && !error && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="text-xs font-medium text-slate-500 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Prev
            </button>
            <span className="text-xs text-slate-400">
              Showing {offset + 1}–{offset + (data?.length ?? 0)}
            </span>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={(data?.length ?? 0) < PAGE_SIZE}
              className="text-xs font-medium text-slate-500 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
