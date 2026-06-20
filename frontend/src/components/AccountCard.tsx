import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Account } from '../types'
import { formatCurrency, isAssetAccount, labelAccountType } from '../lib/format'
import { useAddFunds, useBackfill, usePayBill } from '../hooks/useAccounts'
import { useToast } from '../context/ToastContext'
import { Badge } from './Badge'
import { Modal } from './Modal'
import { AmountForm } from './forms/AmountForm'

const ACCOUNT_ICONS: Record<string, string> = {
  credit_card: '💳',
  savings: '🏦',
  salary: '💰',
  debit_card: '🏧',
}

interface AccountCardProps {
  account: Account
}

export function AccountCard({ account }: AccountCardProps) {
  const { toast } = useToast()
  const [fundsOpen, setFundsOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)

  const addFunds = useAddFunds(account.id)
  const payBill = usePayBill(account.id)
  const backfill = useBackfill(account.id)

  const asset = isAssetAccount(account.account_type)
  const balanceColor = asset
    ? account.balance >= 0 ? 'text-emerald-600' : 'text-red-600'
    : account.balance > 0 ? 'text-red-600' : 'text-emerald-600'

  const utilization = account.credit_limit && account.credit_limit > 0
    ? Math.min(100, (account.balance / account.credit_limit) * 100)
    : null

  async function handleAddFunds(amount: number, description?: string) {
    try {
      await addFunds.mutateAsync({ amount, description })
      toast(`Added ${formatCurrency(amount)} to ${account.name}`, 'success')
      setFundsOpen(false)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed', 'error')
    }
  }

  async function handlePay(amount: number, description?: string) {
    try {
      await payBill.mutateAsync({ amount, description })
      toast(`Recorded payment of ${formatCurrency(amount)} for ${account.name}`, 'success')
      setPayOpen(false)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed', 'error')
    }
  }

  async function handleBackfill() {
    try {
      const res = await backfill.mutateAsync()
      toast(`Backfill done — ${res.expensesLinked} expenses linked, balance: ${formatCurrency(res.balance)}`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Backfill failed', 'error')
    }
  }

  return (
    <>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <span className="text-3xl">{ACCOUNT_ICONS[account.account_type] ?? '🏦'}</span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-800 truncate">{account.name}</p>
            <p className="text-xs text-slate-500">•••• {account.account_last4}</p>
          </div>
          <Badge label={labelAccountType(account.account_type)} variant="type" />
        </div>

        {/* Balance */}
        <div>
          <p className="text-xs text-slate-500 mb-0.5">
            {asset ? 'Available balance' : 'Amount owed'}
          </p>
          <p className={`text-2xl font-bold ${balanceColor}`}>
            {formatCurrency(account.balance, account.currency)}
          </p>
          {account.credit_limit && (
            <p className="text-xs text-slate-400 mt-0.5">
              Limit: {formatCurrency(account.credit_limit, account.currency)}
            </p>
          )}
        </div>

        {/* Credit utilization bar */}
        {utilization !== null && (
          <div>
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>Utilization</span>
              <span>{utilization.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${utilization > 80 ? 'bg-red-500' : utilization > 50 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                style={{ width: `${utilization}%` }}
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
          {asset ? (
            <button
              onClick={() => setFundsOpen(true)}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
            >
              + Add funds
            </button>
          ) : (
            <button
              onClick={() => setPayOpen(true)}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
            >
              Pay bill
            </button>
          )}
          <button
            onClick={handleBackfill}
            disabled={backfill.isPending}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-50 transition-colors"
          >
            {backfill.isPending ? 'Backfilling…' : 'Backfill'}
          </button>
          <Link
            to={`/accounts/${account.id}`}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors ml-auto"
          >
            History →
          </Link>
        </div>
      </div>

      <Modal open={fundsOpen} onClose={() => setFundsOpen(false)} title={`Add Funds — ${account.name}`}>
        <AmountForm
          label="Add Funds"
          onSubmit={handleAddFunds}
          loading={addFunds.isPending}
        />
      </Modal>

      <Modal open={payOpen} onClose={() => setPayOpen(false)} title={`Pay Bill — ${account.name}`}>
        <AmountForm
          label="Record Payment"
          onSubmit={handlePay}
          loading={payBill.isPending}
        />
      </Modal>
    </>
  )
}
