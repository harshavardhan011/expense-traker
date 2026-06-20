import { useState } from 'react'
import { useExpenses } from '../hooks/useExpenses'
import { formatCurrency, formatDate } from '../lib/format'
import { Badge } from '../components/Badge'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Spinner } from '../components/Spinner'

const PAGE_SIZE = 50

export function Expenses() {
  const [offset, setOffset] = useState(0)
  const [category, setCategory] = useState('')
  const [accountLast4, setAccountLast4] = useState('')

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

  return (
    <div className="flex flex-col gap-4">
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
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Category</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Account</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {data.map((exp) => (
                  <tr key={exp.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-3 text-slate-500 text-xs whitespace-nowrap">
                      {formatDate(exp.date ?? exp.created_at)}
                    </td>
                    <td className="px-5 py-3 font-medium text-slate-700 max-w-[200px] truncate">
                      {exp.merchant ?? '—'}
                    </td>
                    <td className="px-5 py-3">
                      {exp.category ? (
                        <Badge label={exp.category} />
                      ) : (
                        <Badge label="Uncategorized" />
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-500 text-xs whitespace-nowrap">
                      {exp.account_type && exp.account_last4
                        ? `${exp.account_type.replace('_', ' ')} ••${exp.account_last4}`
                        : '—'}
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
