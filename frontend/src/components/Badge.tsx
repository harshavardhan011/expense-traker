const CATEGORY_COLORS: Record<string, string> = {
  'Food & Dining': 'bg-orange-100 text-orange-800',
  Food: 'bg-orange-100 text-orange-800',
  Shopping: 'bg-blue-100 text-blue-800',
  Transport: 'bg-cyan-100 text-cyan-800',
  Travel: 'bg-sky-100 text-sky-800',
  Entertainment: 'bg-purple-100 text-purple-800',
  Utilities: 'bg-yellow-100 text-yellow-800',
  Health: 'bg-green-100 text-green-800',
  Uncategorized: 'bg-slate-100 text-slate-600',
}

function getColor(label: string): string {
  return CATEGORY_COLORS[label] ?? 'bg-indigo-100 text-indigo-800'
}

interface BadgeProps {
  label: string
  variant?: 'category' | 'dr' | 'cr' | 'type' | 'gray'
}

export function Badge({ label, variant = 'category' }: BadgeProps) {
  let cls = ''
  if (variant === 'dr') cls = 'bg-red-100 text-red-700'
  else if (variant === 'cr') cls = 'bg-emerald-100 text-emerald-700'
  else if (variant === 'gray') cls = 'bg-slate-100 text-slate-600'
  else if (variant === 'type') cls = 'bg-indigo-100 text-indigo-700'
  else cls = getColor(label)

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}
