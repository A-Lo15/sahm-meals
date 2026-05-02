import type { IngredientCategory } from './types'

const UNICODE_FRACTIONS: Record<string, number> = {
  '¼': 0.25, '½': 0.5, '¾': 0.75,
  '⅓': 1 / 3, '⅔': 2 / 3,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
}

function parseQty(s: string): number {
  if (!s?.trim()) return 0
  let str = s.trim()
  for (const [char, val] of Object.entries(UNICODE_FRACTIONS)) {
    str = str.replace(char, ` ${val}`)
  }
  str = str.trim()
  const mixed = str.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3])
  const frac = str.match(/^(\d+)\/(\d+)$/)
  if (frac) return parseInt(frac[1]) / parseInt(frac[2])
  const n = parseFloat(str)
  return isNaN(n) ? 0 : n
}

function formatQty(n: number): string {
  if (n === 0) return ''
  const fracs: [number, string][] = [
    [0.25, '¼'], [0.5, '½'], [0.75, '¾'],
    [1 / 3, '⅓'], [2 / 3, '⅔'],
    [0.125, '⅛'], [0.375, '⅜'], [0.625, '⅝'], [0.875, '⅞'],
  ]
  const whole = Math.floor(n)
  const frac = n - whole
  for (const [val, char] of fracs) {
    if (Math.abs(frac - val) < 0.02) {
      return whole > 0 ? `${whole} ${char}` : char
    }
  }
  if (Number.isInteger(n)) return String(n)
  return parseFloat(n.toFixed(2)).toString()
}

export const STORE_FOR_CATEGORY: Record<string, string> = {
  produce: 'Whole Foods',
  meat: 'Whole Foods',
  dairy: 'Whole Foods',
  pantry: "Sam's Club",
  frozen: "Sam's Club",
  household: "Sam's Club",
  other: "Trader Joe's",
  '': "Trader Joe's",
}

export const STORES = ['Whole Foods', "Sam's Club", "Trader Joe's"] as const
export type StoreName = (typeof STORES)[number]

export interface ShoppingItem {
  name: string
  quantity: string
  unit: string
  category: IngredientCategory
  checked: boolean
}

export type StoreAssignments = Record<StoreName, ShoppingItem[]>

const CATEGORY_ORDER: IngredientCategory[] = [
  'produce', 'meat', 'dairy', 'pantry', 'frozen', 'household', 'other', '',
]

interface RawSlot {
  servings_override: number | null
  recipe: {
    default_servings: number
    ingredients: Array<{
      name: string
      quantity: string
      unit: string
      category: IngredientCategory
    }>
  }
}

export function buildStoreAssignments(slots: RawSlot[]): StoreAssignments {
  const agg = new Map<string, { qty: number; unit: string; category: IngredientCategory }>()

  for (const slot of slots) {
    const scale =
      (slot.servings_override ?? slot.recipe.default_servings) / slot.recipe.default_servings

    for (const ing of slot.recipe.ingredients ?? []) {
      if (!ing.name?.trim()) continue
      const key = `${ing.name.toLowerCase().trim()}|||${ing.unit.toLowerCase().trim()}`
      const qty = parseQty(ing.quantity) * scale
      const existing = agg.get(key)
      if (existing) {
        existing.qty += qty
      } else {
        agg.set(key, { qty, unit: ing.unit, category: ing.category ?? '' })
      }
    }
  }

  const result: StoreAssignments = {
    'Whole Foods': [],
    "Sam's Club": [],
    "Trader Joe's": [],
  }

  for (const [key, { qty, unit, category }] of Array.from(agg.entries())) {
    const rawName = key.split('|||')[0]
    const name = rawName.charAt(0).toUpperCase() + rawName.slice(1)
    const store = (STORE_FOR_CATEGORY[category] ?? "Trader Joe's") as StoreName
    result[store].push({ name, quantity: formatQty(qty), unit, category, checked: false })
  }

  for (const store of STORES) {
    result[store].sort((a, b) => {
      const ci = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
      return ci !== 0 ? ci : a.name.localeCompare(b.name)
    })
  }

  return result
}
