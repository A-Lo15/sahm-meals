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

export function formatQty(n: number): string {
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

const UNIT_ALIASES: Record<string, string> = {
  // Teaspoon
  tsp: 'teaspoon', teaspoons: 'teaspoon',
  // Tablespoon
  tbsp: 'tablespoon', tbs: 'tablespoon', tb: 'tablespoon', tablespoons: 'tablespoon',
  // Fluid ounce
  'fl oz': 'fluid ounce', 'fl. oz.': 'fluid ounce', 'fluid ounces': 'fluid ounce',
  // Cup
  c: 'cup', cups: 'cup',
  // Pint
  pt: 'pint', pts: 'pint', pints: 'pint',
  // Quart
  qt: 'quart', qts: 'quart', quarts: 'quart',
  // Gallon
  gal: 'gallon', gallons: 'gallon',
  // Milliliter
  ml: 'milliliter', millilitre: 'milliliter', milliliters: 'milliliter', millilitres: 'milliliter',
  // Liter
  'l.': 'liter', l: 'liter', litre: 'liter', liters: 'liter', litres: 'liter',
  // Gram
  'g.': 'gram', g: 'gram', grams: 'gram',
  // Kilogram
  'kg.': 'kilogram', kg: 'kilogram', kilograms: 'kilogram',
  // Ounce (weight)
  'oz.': 'ounce', oz: 'ounce', ounces: 'ounce',
  // Pound
  lb: 'pound', lbs: 'pound', 'lbs.': 'pound', pounds: 'pound',
}

function normalizeUnit(unit: string): string {
  const u = unit.toLowerCase().trim()
  return UNIT_ALIASES[u] ?? u
}

const VOLUME_UNITS = new Set([
  'teaspoon', 'tablespoon', 'fluid ounce', 'cup', 'pint', 'quart', 'gallon',
  'milliliter', 'liter',
])

const WEIGHT_UNITS = new Set([
  'gram', 'kilogram', 'ounce', 'pound',
])

function unitFamily(unit: string): 'volume' | 'weight' | 'other' {
  if (VOLUME_UNITS.has(unit)) return 'volume'
  if (WEIGHT_UNITS.has(unit)) return 'weight'
  return 'other'
}

const TO_TABLESPOONS: Record<string, number> = {
  teaspoon: 1 / 3,
  tablespoon: 1,
  'fluid ounce': 2,
  cup: 16,
  pint: 32,
  quart: 64,
  gallon: 256,
  milliliter: 1 / 14.787,
  liter: 1000 / 14.787,
}

const TO_GRAMS: Record<string, number> = {
  gram: 1,
  kilogram: 1000,
  ounce: 28.3495,
  pound: 453.592,
}

export function volumeFromCanonical(tbsp: number): { qty: number; unit: string } {
  if (tbsp >= 16) return { qty: tbsp / 16, unit: 'cup' }
  if (tbsp >= 1) return { qty: tbsp, unit: 'tablespoon' }
  return { qty: tbsp * 3, unit: 'teaspoon' }
}

export function weightFromCanonical(grams: number): { qty: number; unit: string } {
  if (grams >= 453.592) return { qty: grams / 453.592, unit: 'pound' }
  if (grams >= 28.3495) return { qty: grams / 28.3495, unit: 'ounce' }
  return { qty: grams, unit: 'gram' }
}

const STEM_EXCEPTIONS = new Set(['molasses', 'series'])

export function normalizeName(raw: string): string {
  const s = raw.toLowerCase().trim()
  if (STEM_EXCEPTIONS.has(s)) return s
  if (s.endsWith('ies') && s.length > 4) return s.slice(0, -3) + 'y'
  if (s.endsWith('oes') && s.length > 4) return s.slice(0, -2)
  if (s.endsWith('es') && s.length > 4) {
    const stem = s.slice(0, -2)
    if (/(?:ch|sh|x|z)$/.test(stem)) return stem
  }
  if (s.endsWith('us')) return s
  if (s.endsWith('s') && s.length > 3 && !s.endsWith('ss')) return s.slice(0, -1)
  return s
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

export interface ShoppingItem {
  name: string
  quantity: string
  unit: string
  category: IngredientCategory
  checked: boolean
  manual?: boolean   // true for user-added items not from any recipe
  manualId?: string  // stable UUID matching ManualItem.id; present when manual === true
}

export interface ManualItem {
  id: string       // crypto.randomUUID() — stable identity for removal and dedup
  store: string
  name: string
  quantity: string // empty string if not provided by user
  unit: string     // empty string if not provided by user
}

export interface UnitPreference {
  preferredUnit: string            // e.g. "clove" or "tablespoon"
  preferredFamily: 'other' | 'volume' | 'weight'
  factor: number | null            // tbsp per count (volume) or grams per count (weight); null = unknown
}

export type UnitPreferences = Record<string, UnitPreference>

export interface ConflictItem {
  normalizedName: string           // e.g. "garlic"
  displayName: string              // e.g. "Garlic"
  options: [
    { family: 'other'; unit: string; canonicalQty: number },
    { family: 'volume' | 'weight'; unit: string; canonicalQty: number },
  ]
}

export type StoreAssignments = Record<string, ShoppingItem[]>

export const CATEGORY_ORDER: IngredientCategory[] = [
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

interface AggEntry {
  canonical: number
  family: 'volume' | 'weight' | 'other'
  unit: string
  category: IngredientCategory
}

export function buildStoreAssignments(
  slots: RawSlot[],
  storeNames: string[],
  priorRouteMap: Map<string, string>,
  unitPreferences: UnitPreferences = {}
): { assignments: StoreAssignments; conflicts: ConflictItem[] } {
  const agg = new Map<string, AggEntry>()

  for (const slot of slots) {
    const scale =
      (slot.servings_override ?? slot.recipe.default_servings) / slot.recipe.default_servings

    for (const ing of slot.recipe.ingredients ?? []) {
      if (!ing.name?.trim()) continue

      const normalizedName = normalizeName(ing.name)
      const normalizedUnit = normalizeUnit(ing.unit)
      const family = unitFamily(normalizedUnit)

      const key =
        family === 'other'
          ? `${normalizedName}|||${normalizedUnit}`
          : `${normalizedName}|||${family}`

      const rawQty = parseQty(ing.quantity) * scale

      let canonical: number
      if (family === 'volume') {
        canonical = rawQty * TO_TABLESPOONS[normalizedUnit]!
      } else if (family === 'weight') {
        canonical = rawQty * TO_GRAMS[normalizedUnit]!
      } else {
        canonical = rawQty
      }

      const existing = agg.get(key)
      if (existing) {
        existing.canonical += canonical
      } else {
        agg.set(key, { canonical, family, unit: normalizedUnit, category: ing.category ?? '' })
      }
    }
  }

  // ── Cross-family conflict detection ─────────────────────────────────────────

  const conflicts: ConflictItem[] = []

  // Group agg keys by normalized ingredient name
  const nameToKeys = new Map<string, string[]>()
  for (const key of Array.from(agg.keys())) {
    const name = key.split('|||')[0]
    if (!nameToKeys.has(name)) nameToKeys.set(name, [])
    nameToKeys.get(name)!.push(key)
  }

  for (const [name, keys] of Array.from(nameToKeys.entries())) {
    if (keys.length <= 1) continue

    const otherKey = keys.find(k => agg.get(k)!.family === 'other')
    const measureKey = keys.find(k => {
      const f = agg.get(k)!.family
      return f === 'volume' || f === 'weight'
    })
    // Only handle other↔volume or other↔weight conflicts. Volume↔weight cross-family
    // and same-family conflicts (grams vs ounces) are handled elsewhere or out of scope.
    if (!otherKey || !measureKey) continue

    const otherEntry = agg.get(otherKey)!
    const measureEntry = agg.get(measureKey)!
    const measureFamily = measureEntry.family as 'volume' | 'weight'

    const pref = unitPreferences[name]

    if (pref?.factor != null) {
      // Resolve inline: convert minority family into preferred family and merge
      if (pref.preferredFamily === 'other') {
        otherEntry.canonical += measureEntry.canonical / pref.factor
        agg.delete(measureKey)
      } else {
        measureEntry.canonical += otherEntry.canonical * pref.factor
        agg.delete(otherKey)
      }
    } else if (pref?.preferredFamily != null) {
      // User expressed a preference but no conversion factor is available (Claude
      // failed to return one). Drop the non-preferred side without converting —
      // the quantities are approximate but the conflict won't re-surface every week.
      if (pref.preferredFamily === 'other') {
        agg.delete(measureKey)
      } else {
        agg.delete(otherKey)
      }
    } else {
      // True first-time conflict — surface as a conflict for the UI.
      // Remove from agg so assignments never contains duplicate unmerged entries.
      agg.delete(otherKey)
      agg.delete(measureKey)
      conflicts.push({
        normalizedName: name,
        displayName: name.charAt(0).toUpperCase() + name.slice(1),
        options: [
          { family: 'other', unit: otherEntry.unit, canonicalQty: otherEntry.canonical },
          { family: measureFamily, unit: measureEntry.unit, canonicalQty: measureEntry.canonical },
        ],
      })
    }
  }

  const result: StoreAssignments = {}
  for (const name of storeNames) {
    result[name] = []
  }

  for (const [key, { canonical, family, unit, category }] of Array.from(agg.entries())) {
    const rawName = key.split('|||')[0]
    const name = rawName.charAt(0).toUpperCase() + rawName.slice(1)

    let displayQty: number
    let displayUnit: string

    const pref = unitPreferences[rawName]

    if (family === 'volume') {
      const preferred = pref?.preferredFamily === 'volume' ? pref.preferredUnit : null
      const factor = preferred ? TO_TABLESPOONS[preferred] : null
      if (factor) {
        displayQty = canonical / factor
        displayUnit = preferred!
      } else {
        const converted = volumeFromCanonical(canonical)
        displayQty = converted.qty
        displayUnit = converted.unit
      }
    } else if (family === 'weight') {
      const preferred = pref?.preferredFamily === 'weight' ? pref.preferredUnit : null
      const factor = preferred ? TO_GRAMS[preferred] : null
      if (factor) {
        displayQty = canonical / factor
        displayUnit = preferred!
      } else {
        const converted = weightFromCanonical(canonical)
        displayQty = converted.qty
        displayUnit = converted.unit
      }
    } else {
      displayQty = canonical
      displayUnit = unit
    }

    const categoryDefault = STORE_FOR_CATEGORY[category]
    const priorStore = priorRouteMap.get(rawName)
    let store: string
    if (priorStore && storeNames.includes(priorStore)) {
      store = priorStore
    } else if (categoryDefault && storeNames.includes(categoryDefault)) {
      store = categoryDefault
    } else {
      store = storeNames[0] ?? ''
    }
    if (!store) continue
    result[store].push({ name, quantity: formatQty(displayQty), unit: displayUnit, category, checked: false })
  }

  for (const storeName of storeNames) {
    result[storeName]?.sort((a, b) => {
      const ci = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
      return ci !== 0 ? ci : a.name.localeCompare(b.name)
    })
  }

  return { assignments: result, conflicts }
}
