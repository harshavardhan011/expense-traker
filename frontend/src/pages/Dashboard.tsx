import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAccounts } from '../hooks/useAccounts'
import { useExpenses } from '../hooks/useExpenses'
import { formatCurrency, formatDateShort, isAssetAccount } from '../lib/format'
import { Badge } from '../components/Badge'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Spinner } from '../components/Spinner'

function KpiCard({ label, value, sub, color = 'slate' }: { label: string; value: string; sub?: string; color?: string }) {
  const colorMap: Record<string, string> = {
    green: 'border-l-emerald-500 text-emerald-700',
    red: 'border-l-red-500 text-red-700',
    indigo: 'border-l-indigo-500 text-indigo-700',
    slate: 'border-l-slate-400 text-slate-700',
  }
  const accent = colorMap[color] ?? colorMap.slate
  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 border-l-4 ${accent.split(' ')[0]} p-5`}>
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accent.split(' ')[1]}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

export function Dashboard() {
  const accounts = useAccounts()
  const expenses = useExpenses({ limit: 200 })

  // KPI aggregates
  const kpis = useMemo(() => {
    if (!accounts.data) return { assets: 0, owed: 0, accountCount: 0 }
    let assets = 0
    let owed = 0
    for (const a of accounts.data) {
      if (isAssetAccount(a.account_type)) assets += Number(a.balance)
      else if (a.balance > 0) owed += Number(a.balance)
    }
    return { assets, owed, accountCount: accounts.data.length }
  }, [accounts.data])

  // This-month DR spend
  const monthSpend = useMemo(() => {
    if (!expenses.data) return 0
    const now = new Date()
    const yyyymm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    return expenses.data
      .filter((e) => e.type === 'DR' && e.created_at?.startsWith(yyyymm))
      .reduce((s, e) => s + Number(e.amount ?? 0), 0)
  }, [expenses.data])

  // Category breakdown (current month DR)
  const categoryBreakdown = useMemo(() => {
    if (!expenses.data) return []
    const now = new Date()
    const yyyymm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const map = new Map<string, number>()
    for (const e of expenses.data) {
      if (e.type !== 'DR' || !e.created_at?.startsWith(yyyymm)) continue
      const cat = e.category ?? 'Uncategorized'
      map.set(cat, (map.get(cat) ?? 0) + Number(e.amount ?? 0))
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
  }, [expenses.data])

  const maxCategory = categoryBreakdown[0]?.[1] ?? 1

  // Recent 10 expenses
  const recent = expenses.data?.slice(0, 10) ?? []

  const loading = accounts.isLoading || expenses.isLoading
  const error = accounts.error ?? expenses.error

  if (loading) return (
    <div className="flex items-center justify-center h-full"><Spinner size="lg" /></div>
  )
  if (error) return <ErrorState message={(error as Error).message} />

  return (
    <div className="flex flex-col gap-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total available funds"
          value={formatCurrency(kpis.assets)}
          color="green"
        />
        <KpiCard
          label="Total owed (cards)"
          value={formatCurrency(kpis.owed)}
          sub="across credit cards"
          color="red"
        />
        <KpiCard
          label="This month's spend"
          value={formatCurrency(monthSpend)}
          sub="debit transactions"
          color="indigo"
        />
        <KpiCard
          label="Active accounts"
          value={String(kpis.accountCount)}
          color="slate"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Category breakdown */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">This month by category</h2>
          {categoryBreakdown.length === 0 ? (
            <EmptyState message="No expenses this month" icon="📂" />
          ) : (
            <div className="flex flex-col gap-3">
              {categoryBreakdown.map(([cat, total]) => (
                <div key={cat}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-600 font-medium truncate max-w-[60%]">{cat}</span>
                    <span className="text-slate-500">{formatCurrency(total)}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full"
                      style={{ width: `${(total / maxCategory) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent expenses */}
        <div className="lg:col-span-3 bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-700">Recent transactions</h2>
            <Link to="/expenses" className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
              View all →
            </Link>
          </div>
          {recent.length === 0 ? (
            <EmptyState message="No expenses yet — try syncing!" icon="📧" />
          ) : (
            <div className="flex flex-col gap-2">
              {recent.map((exp) => (
                <div key={exp.id} className="flex items-center gap-3 py-1.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">
                      {exp.merchant ?? exp.raw_description ?? 'Unknown'}
                    </p>
                    <p className="text-xs text-slate-400">{formatDateShort(exp.date ?? exp.created_at)}</p>
                  </div>
                  {exp.category && <Badge label={exp.category} />}
                  <span className={`text-sm font-semibold tabular-nums ${exp.type === 'DR' ? 'text-red-600' : 'text-emerald-600'}`}>
                    {exp.type === 'DR' ? '-' : '+'}{formatCurrency(exp.amount, exp.currency ?? undefined)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
