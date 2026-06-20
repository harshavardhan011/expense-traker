import { useState } from 'react'
import { Spinner } from '../Spinner'

interface AmountFormProps {
  label: string
  onSubmit: (amount: number, description?: string) => void
  loading?: boolean
  placeholder?: string
}

export function AmountForm({ label, onSubmit, loading, placeholder = 'e.g. 5000' }: AmountFormProps) {
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const val = parseFloat(amount)
    if (isNaN(val) || val <= 0) return
    onSubmit(val, description || undefined)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Amount (₹)</label>
        <input
          type="number"
          min="0.01"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={placeholder}
          required
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Description <span className="text-slate-400">(optional)</span>
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Salary deposit"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-medium rounded-lg px-4 py-2 text-sm transition-colors"
      >
        {loading && <Spinner size="sm" />}
        {label}
      </button>
    </form>
  )
}
