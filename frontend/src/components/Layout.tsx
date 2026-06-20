import { useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ApiError } from '../lib/api'
import { useSync } from '../hooks/useSync'
import { useToast } from '../context/ToastContext'
import { Spinner } from './Spinner'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/expenses', label: 'Expenses', icon: '🧾' },
  { to: '/accounts', label: 'Accounts', icon: '🏦' },
]

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { toast } = useToast()
  const sync = useSync()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const pageTitle = NAV_ITEMS.find((n) => {
    if (n.to === '/') return location.pathname === '/'
    return location.pathname.startsWith(n.to)
  })?.label ?? 'Expense Manager'

  async function handleSync() {
    try {
      const stats = await sync.mutateAsync()
      toast(
        `Sync done — ${stats.parsed} parsed, ${stats.skipped} skipped, ${stats.errors} errors, ${stats.recategorized} recategorized`,
        'success',
      )
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 409
        ? 'Sync already in progress'
        : err instanceof Error ? err.message : 'Sync failed'
      toast(msg, err instanceof ApiError && err.status === 409 ? 'info' : 'error')
    }
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-slate-100">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={[
          'fixed lg:static z-30 inset-y-0 left-0 w-60 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 ease-in-out',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
          <span className="text-2xl">💸</span>
          <span className="font-semibold text-slate-800 text-base">Expense Manager</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                ].join(' ')
              }
            >
              <span className="text-lg leading-none">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Sync button in sidebar */}
        <div className="px-3 pb-5">
          <button
            onClick={handleSync}
            disabled={sync.isPending}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg px-3 py-2 transition-colors"
          >
            {sync.isPending ? <Spinner size="sm" /> : <span>🔄</span>}
            {sync.isPending ? 'Syncing…' : 'Sync Emails'}
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-slate-200 px-4 lg:px-6 py-3 flex items-center gap-3">
          {/* Hamburger (mobile) */}
          <button
            className="lg:hidden text-slate-500 hover:text-slate-800"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1 className="text-base font-semibold text-slate-800 flex-1">{pageTitle}</h1>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto px-4 lg:px-6 py-5">
          {children}
        </main>
      </div>
    </div>
  )
}
