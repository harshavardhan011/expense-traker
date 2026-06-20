import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAccount, useAccountTransactions, useAddFunds, useBackfill, usePayBill } from '../hooks/useAccounts'
import { useToast } from '../context/ToastContext'
import { formatCurrency, formatDate, isAssetAccount, labelAccountType, labelTxnType } from '../lib/format'
import { Badge } from '../components/Badge'
import { Modal } from '../components/Modal'
import { AmountForm } from '../components/forms/AmountForm'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Spinner } from '../components/Spinner'

export function AccountDetail() {
  const { id } = useParams<{ id: string }>()
  const accountId = Number(id)

  const { data: account, isLoading: acctLoading, error: acctError } = useAccount(accountId)
  const { data: txns, isLoading: txnsLoading, error: txnsError } = useAccountTransactions(accountId)
  const { toast } = useToast()

  const [fundsOpen, setFundsOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)

  const addFunds = useAddFunds(accountId)
  const payBill = usePayBill(accountId)
  const backfill = useBackfill(accountId)

  if (acctLoading || txnsLoading) return (
    <div className="flex items-center justify-center h-full"><Spinner size="lg" /></div>
  )
  const err = acctError ?? txnsError
  if (err || !account) return <ErrorState message={(err as Error | null)?.message ?? 'Account not found'} />

  const asset = isAssetAccount(account.account_type)

  async function handleAddFunds(amount: number, description?: string) {
    try {
      await addFunds.mutateAsync({ amount, description })
      toast(`Added ${formatCurrency(amount)}`, 'success')
      setFundsOpen(false)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error')
    }
  }

  async function handlePay(amount: number, description?: string) {
    try {
      await payBill.mutateAsync({ amount, description })
      toast(`Recorded payment of ${formatCurrency(amount)}`, 'success')
      setPayOpen(false)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error')
    }
  }

  async function handleBackfill() {
    try {
      const res = await backfill.mutateAsync()
      toast(`Backfill done — ${res.expensesLinked} expenses linked`, 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Backfill failed', 'error')
    }
  }

  const balanceColor = asset
    ? account.balance >= 0 ? 'text-emerald-600' : 'text-red-600'
    : account.balance > 0 ? 'text-red-600' : 'text-emerald-600'

  return (
    <>
      <div className="flex flex-col gap-5">
        {/* Back link */}
        <Link to="/accounts" className="text-sm text-indigo-600 hover:text-indigo-800 font-medium w-fit">
          ← Back to Accounts
        </Link>

        {/* Account header card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="flex flex-wrap items-start gap-4 justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-800">{account.name}</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {labelAccountType(account.account_type)} &nbsp;•&nbsp; •••• {account.account_last4}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500 mb-0.5">{asset ? 'Available balance' : 'Amount owed'}</p>
              <p className={`text-3xl font-bold ${balanceColor}`}>
                {formatCurrency(account.balance, account.currency)}
              </p>
              {account.credit_limit && (
                <p className="text-xs text-slate-400">
                  Limit: {formatCurrency(account.credit_limit, account.currency)}
                </p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 mt-5 pt-5 border-t border-slate-100">
            {asset ? (
              <button
                onClick={() => setFundsOpen(true)}
                className="text-sm font-medium px-4 py-2 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
              >
                + Add Funds
              </button>
            ) : (
              <button
                onClick={() => setPayOpen(true)}
                className="text-sm font-medium px-4 py-2 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
              >
                Pay Bill
              </button>
            )}
            <button
              onClick={handleBackfill}
              disabled={backfill.isPending}
              className="text-sm font-medium px-4 py-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-50 transition-colors"
            >
              {backfill.isPending ? 'Backfilling…' : 'Recalculate Balance'}
            </button>
          </div>
        </div>

        {/* Transaction history */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700">Transaction History</h3>
          </div>

          {!txns?.length ? (
            <EmptyState message="No transactions yet" icon="📋" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left">
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Type</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Description</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Amount</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Balance after</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {txns.map((txn) => {
                    const isDebit = txn.type === 'expense_dr' || txn.type === 'manual_debit' || txn.type === 'payment'
                    return (
                      <tr key={txn.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-5 py-3 text-slate-500 text-xs whitespace-nowrap">
                          {formatDate(txn.created_at)}
                        </td>
                        <td className="px-5 py-3">
                          <Badge
                            label={labelTxnType(txn.type)}
                            variant={isDebit ? 'dr' : 'cr'}
                          />
                        </td>
                        <td className="px-5 py-3 text-slate-600 max-w-[200px] truncate text-xs">
                          {txn.description ?? '—'}
                        </td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums whitespace-nowrap">
                          <span className={isDebit ? 'text-red-600' : 'text-emerald-600'}>
                            {isDebit ? '-' : '+'}{formatCurrency(txn.amount, account.currency)}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right text-slate-500 tabular-nums text-xs whitespace-nowrap">
                          {formatCurrency(txn.balance_after, account.currency)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Modal open={fundsOpen} onClose={() => setFundsOpen(false)} title={`Add Funds — ${account.name}`}>
        <AmountForm label="Add Funds" onSubmit={handleAddFunds} loading={addFunds.isPending} />
      </Modal>
      <Modal open={payOpen} onClose={() => setPayOpen(false)} title={`Pay Bill — ${account.name}`}>
        <AmountForm label="Record Payment" onSubmit={handlePay} loading={payBill.isPending} />
      </Modal>
    </>
  )
}
