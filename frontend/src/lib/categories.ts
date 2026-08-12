export const PRESET_CATEGORIES = [
  'Food & Dining',
  'Groceries',
  'Shopping',
  'Transport',
  'Fuel',
  'Travel',
  'Entertainment',
  'Utilities',
  'Health',
  'Rent',
  'Education',
  'Subscriptions',
  'Investments',
  'Cash Withdrawal',
  'Other',
]

/**
 * Merge preset categories with dynamically fetched ones from the API.
 * Deduped, sorted alphabetically.
 */
export function mergeCategories(apiCategories: string[]): string[] {
  const set = new Set([...PRESET_CATEGORIES, ...apiCategories])
  return [...set].sort()
}

/** Preset categories are built-in and cannot be renamed or deleted. */
export function isPresetCategory(name: string): boolean {
  return PRESET_CATEGORIES.includes(name)
}
