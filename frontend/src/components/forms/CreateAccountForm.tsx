import { useState } from 'react'
import type { AccountType, CreateAccountPayload } from '../../types'
import { Spinner } from '../Spinner'

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'savings', label: 'Savings' },
  { value: 'salary', label: 'Salary A/C' },
  { value: 'debit_card', label: 'Debit Card' },
]

interface Props {
  onSubmit: (payload: CreateAccountPayload) => void
  loading?: boolean
}

export function CreateAccountForm({ onSubmit, loading }: Props) {
  const [name, setName] = useState('')
  const [type, setType] = useState<AccountType>('savings')
  const [last4, setLast4] = useState('')
  const [currency, setCurrency] = useState('INR')
  const [balance, setBalance] = useState('')
  const [creditLimit, setCreditLimit] = useState('')

  const isCard = type === 'credit_card' || type === 'debit_card'

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit({
      name,
      accountType: type,
      accountLast4: last4,
      currency,
      balance: balance ? parseFloat(balance) : 0,
      creditLimit: creditLimit ? parseFloat(creditLimit) : null,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Account Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. HDFC Savings"
          required
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as AccountType)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {ACCOUNT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Last 4 digits</label>
        <input
          value={last4}
          onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="e.g. 8735"
          required
          maxLength={4}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Currency</label>
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
            placeholder="INR"
            maxLength={3}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Opening balance <span className="text-slate-400">(₹)</span>
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            placeholder="0"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {isCard && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Credit limit <span className="text-slate-400">(₹, optional)</span>
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={creditLimit}
            onChange={(e) => setCreditLimit(e.target.value)}
            placeholder="e.g. 150000"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-medium rounded-lg px-4 py-2 text-sm transition-colors"
      >
        {loading && <Spinner size="sm" />}
        Create Account
      </button>
    </form>
  )
}
