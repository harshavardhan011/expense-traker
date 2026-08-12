import { useState } from 'react'
import { useCategories } from '../hooks/useCategories'
import { mergeCategories } from '../lib/categories'

const NEW_SENTINEL = '__new__'

interface CategoryPickerProps {
  /** Currently selected value (shows as selected in the dropdown) */
  value?: string
  onChange: (category: string) => void
  disabled?: boolean
  className?: string
}

export function CategoryPicker({ value, onChange, disabled, className = '' }: CategoryPickerProps) {
  const { data: apiCategories } = useCategories()
  const [customMode, setCustomMode] = useState(false)
  const [customValue, setCustomValue] = useState('')

  const allCategories = mergeCategories(apiCategories ?? [])

  function handleSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    if (e.target.value === NEW_SENTINEL) {
      setCustomMode(true)
      setCustomValue('')
    } else {
      setCustomMode(false)
      onChange(e.target.value)
    }
  }

  function handleCustomKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && customValue.trim()) {
      onChange(customValue.trim())
      setCustomMode(false)
    }
    if (e.key === 'Escape') {
      setCustomMode(false)
    }
  }

  if (customMode) {
    return (
      <input
        autoFocus
        type="text"
        value={customValue}
        onChange={(e) => setCustomValue(e.target.value)}
        onKeyDown={handleCustomKey}
        onBlur={() => {
          if (customValue.trim()) onChange(customValue.trim())
          setCustomMode(false)
        }}
        placeholder="Type category, press Enter"
        className={`border border-indigo-400 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${className}`}
      />
    )
  }

  return (
    <select
      value={value ?? ''}
      onChange={handleSelect}
      disabled={disabled}
      className={`border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 ${className}`}
    >
      <option value="" disabled>Pick a category…</option>
      {allCategories.map((cat) => (
        <option key={cat} value={cat}>{cat}</option>
      ))}
      <option value={NEW_SENTINEL}>+ New category…</option>
    </select>
  )
}
