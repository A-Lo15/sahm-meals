'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import {
  normalizeName,
  buildStoreAssignments,
  formatQty,
  volumeFromCanonical,
  weightFromCanonical,
  type StoreAssignments,
  type ShoppingItem,
  type ManualItem,
  type ConflictItem,
  type UnitPreferences,
} from '@/lib/shopping'
import Anthropic from '@anthropic-ai/sdk'
import { type Store } from '@/lib/stores'

async function getContext() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const db = createAdminClient()
  const { data: userData } = await db
    .from('users')
    .select('household_id')
    .eq('id', user.id)
    .single()

  const householdId = userData?.household_id as string | undefined
  if (!householdId) throw new Error('No household found')
  return { db, householdId }
}

async function loadStores(
  db: ReturnType<typeof createAdminClient>,
  householdId: string
): Promise<Store[]> {
  const { data } = await db
    .from('stores')
    .select('id, name, abbreviation, display_order')
    .eq('household_id', householdId)
    .order('display_order', { ascending: true })
  return (data ?? []).map(row => ({
    id: row.id as string,
    name: row.name as string,
    abbreviation: row.abbreviation as string,
    displayOrder: row.display_order as number,
  }))
}

async function fetchConversionSuggestions(
  conflicts: ConflictItem[]
): Promise<Record<string, number>> {
  if (conflicts.length === 0) return {}

  const lines = conflicts.map(c => {
    const measureOpt = c.options[1]
    const measureUnit = measureOpt.family === 'volume' ? 'tablespoons' : 'grams'
    return `- ${c.displayName}: 1 ${c.options[0].unit} = ? ${measureUnit}`
  })

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are a cooking measurement expert. For each ingredient, give the conversion factor as a positive decimal number.
Return ONLY valid JSON, no markdown. Format: {"ingredient_name": number}

${lines.join('\n')}`,
      }],
    })

    const block = response.content[0]
    if (block.type !== 'text') return {}

    const jsonMatch = block.text.match(/\{[\s\S]+\}/)
    if (!jsonMatch) return {}

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    const result: Record<string, number> = {}
    for (const [key, val] of Object.entries(parsed)) {
      if (typeof val !== 'number' || val <= 0) continue
      const match = conflicts.find(
        c =>
          c.displayName.toLowerCase() === key.toLowerCase() ||
          c.normalizedName === key.toLowerCase()
      )
      if (match) result[match.normalizedName] = val
    }
    return result
  } catch {
    return {}
  }
}

function computeConflictDisplay(
  conflict: ConflictItem,
  factor: number | undefined
): ResolvedConflict {
  const [otherOpt, measureOpt] = conflict.options

  if (factor != null && factor > 0) {
    // Compute merged totals for both unit choices
    const totalCount = otherOpt.canonicalQty + measureOpt.canonicalQty / factor
    const totalMeasure = otherOpt.canonicalQty * factor + measureOpt.canonicalQty

    const countDisplay = `${formatQty(totalCount)} ${otherOpt.unit}`

    let measureDisplay: string
    if (measureOpt.family === 'volume') {
      const { qty, unit } = volumeFromCanonical(totalMeasure)
      measureDisplay = `${formatQty(qty)} ${unit}`
    } else {
      const { qty, unit } = weightFromCanonical(totalMeasure)
      measureDisplay = `${formatQty(qty)} ${unit}`
    }

    return {
      normalizedName: conflict.normalizedName,
      displayName: conflict.displayName,
      options: [
        { family: 'other', unit: otherOpt.unit, displayQty: countDisplay, isSuggested: true },
        { family: measureOpt.family, unit: measureOpt.unit, displayQty: measureDisplay, isSuggested: false },
      ],
    }
  }

  // No factor from Claude — show raw unmerged quantities, no suggestion
  let measureDisplay: string
  if (measureOpt.family === 'volume') {
    const { qty, unit } = volumeFromCanonical(measureOpt.canonicalQty)
    measureDisplay = `${formatQty(qty)} ${unit}`
  } else {
    const { qty, unit } = weightFromCanonical(measureOpt.canonicalQty)
    measureDisplay = `${formatQty(qty)} ${unit}`
  }

  return {
    normalizedName: conflict.normalizedName,
    displayName: conflict.displayName,
    options: [
      {
        family: 'other',
        unit: otherOpt.unit,
        displayQty: `${formatQty(otherOpt.canonicalQty)} ${otherOpt.unit}`,
        isSuggested: false,
      },
      { family: measureOpt.family, unit: measureOpt.unit, displayQty: measureDisplay, isSuggested: false },
    ],
  }
}

export interface ShoppingListData {
  id: string
  storeAssignments: StoreAssignments
  generatedAt: string
  mealPlanId: string
  manualItems: ManualItem[]
  stores: Store[]
  pantryStaples: string[]
}

export interface ResolvedConflictOption {
  family: 'other' | 'volume' | 'weight'
  unit: string
  displayQty: string    // merged total in this unit, e.g. "6 cloves" or "2 tablespoons"
  isSuggested: boolean
}

export interface ResolvedConflict {
  normalizedName: string
  displayName: string
  options: [ResolvedConflictOption, ResolvedConflictOption]
}

export type GenerateResult =
  | ({ type: 'success' } & ShoppingListData)
  | { type: 'conflicts'; conflicts: ResolvedConflict[]; suggestions: Record<string, number> }

async function _buildAndSaveList(
  db: ReturnType<typeof createAdminClient>,
  householdId: string,
  mealPlanId: string,
  unitPreferences: UnitPreferences,
  pantryStaples: string[]
): Promise<ShoppingListData | null> {
  const stores = await loadStores(db, householdId)

  const { data: plan } = await db
    .from('meal_plans')
    .select('id')
    .eq('id', mealPlanId)
    .eq('household_id', householdId)
    .single()

  if (!plan) return null

  const { data: slots } = await db
    .from('meal_plan_recipes')
    .select(`servings_override, recipe:recipes(default_servings, ingredients)`)
    .eq('meal_plan_id', mealPlanId)

  const { data: existingList } = await db
    .from('shopping_lists')
    .select('manual_overrides, store_assignments')
    .eq('meal_plan_id', mealPlanId)
    .single()

  const priorRouteMap = new Map<string, string>()
  if (existingList?.store_assignments) {
    const prior = existingList.store_assignments as StoreAssignments
    for (const [storeName, items] of Object.entries(prior)) {
      for (const item of (items as ShoppingItem[])) {
        if (!item.manual && !priorRouteMap.has(item.name.toLowerCase())) {
          priorRouteMap.set(item.name.toLowerCase(), storeName)
        }
      }
    }
  }

  const { assignments: storeAssignments } = buildStoreAssignments(
    (slots ?? []) as unknown as Parameters<typeof buildStoreAssignments>[0],
    stores.map(s => s.name),
    priorRouteMap,
    unitPreferences
  )

  const manualItems: ManualItem[] =
    (existingList?.manual_overrides as { added?: ManualItem[] } | null)?.added ?? []

  const priorAssignments = (existingList?.store_assignments ?? {}) as StoreAssignments
  const priorCheckedMap = new Map<string, boolean>()
  for (const storeName of Object.keys(priorAssignments)) {
    for (const item of priorAssignments[storeName] ?? []) {
      if (item.manualId) priorCheckedMap.set(item.manualId, item.checked)
    }
  }

  for (const mi of manualItems) {
    const shoppingItem: ShoppingItem = {
      name: mi.name,
      quantity: mi.quantity,
      unit: mi.unit,
      category: 'other',
      checked: priorCheckedMap.get(mi.id) ?? false,
      manual: true,
      manualId: mi.id,
    }
    storeAssignments[mi.store] = [
      ...(storeAssignments[mi.store] ?? []),
      shoppingItem,
    ]
  }

  const now = new Date().toISOString()
  const { data: saved, error } = await db
    .from('shopping_lists')
    .upsert(
      {
        meal_plan_id: mealPlanId,
        store_assignments: storeAssignments,
        generated_at: now,
        // manual_overrides intentionally omitted — Supabase only updates
        // specified columns on conflict, so existing manual items are preserved
      },
      { onConflict: 'meal_plan_id' }
    )
    .select('id, generated_at')
    .single()

  if (error) throw error

  return {
    id: saved.id,
    storeAssignments,
    generatedAt: saved.generated_at,
    mealPlanId,
    manualItems,
    stores,
    pantryStaples,
  }
}

export async function generateShoppingList(mealPlanId: string): Promise<GenerateResult | null> {
  const { db, householdId } = await getContext()

  // Load stored unit preferences
  const { data: household } = await db
    .from('households')
    .select('preferences, pantry_staples')
    .eq('id', householdId)
    .single()

  const pantryStaples: string[] = (household?.pantry_staples as string[] | null) ?? []
  const storedPrefs = (household?.preferences as Record<string, unknown>) ?? {}
  const unitPreferences: UnitPreferences =
    (storedPrefs.unit_preferences as UnitPreferences) ?? {}

  // Get meal plan + slots to detect conflicts
  const stores = await loadStores(db, householdId)

  const { data: plan } = await db
    .from('meal_plans')
    .select('id')
    .eq('id', mealPlanId)
    .eq('household_id', householdId)
    .single()

  if (!plan) return null

  const { data: slots } = await db
    .from('meal_plan_recipes')
    .select(`servings_override, recipe:recipes(default_servings, ingredients)`)
    .eq('meal_plan_id', mealPlanId)

  const { data: existingList } = await db
    .from('shopping_lists')
    .select('manual_overrides, store_assignments')
    .eq('meal_plan_id', mealPlanId)
    .single()

  const priorRouteMap = new Map<string, string>()
  if (existingList?.store_assignments) {
    const prior = existingList.store_assignments as StoreAssignments
    for (const [storeName, items] of Object.entries(prior)) {
      for (const item of (items as ShoppingItem[])) {
        if (!item.manual && !priorRouteMap.has(item.name.toLowerCase())) {
          priorRouteMap.set(item.name.toLowerCase(), storeName)
        }
      }
    }
  }

  const { conflicts } = buildStoreAssignments(
    (slots ?? []) as unknown as Parameters<typeof buildStoreAssignments>[0],
    stores.map(s => s.name),
    priorRouteMap,
    unitPreferences
  )

  if (conflicts.length > 0) {
    const suggestions = await fetchConversionSuggestions(conflicts)
    const resolvedConflicts = conflicts.map(c =>
      computeConflictDisplay(c, suggestions[c.normalizedName])
    )
    return { type: 'conflicts', conflicts: resolvedConflicts, suggestions }
  }

  const result = await _buildAndSaveList(db, householdId, mealPlanId, unitPreferences, pantryStaples)
  if (!result) return null
  return { type: 'success', ...result }
}

export async function resolveAndGenerateList(
  mealPlanId: string,
  newPreferences: UnitPreferences
): Promise<ShoppingListData | null> {
  const { db, householdId } = await getContext()

  // Merge new preferences into existing stored preferences
  const { data: household } = await db
    .from('households')
    .select('preferences, pantry_staples')
    .eq('id', householdId)
    .single()

  const pantryStaples: string[] = (household?.pantry_staples as string[] | null) ?? []
  const currentPrefs = (household?.preferences as Record<string, unknown>) ?? {}
  const currentUnitPrefs = (currentPrefs.unit_preferences as UnitPreferences) ?? {}
  const mergedUnitPrefs: UnitPreferences = { ...currentUnitPrefs, ...newPreferences }

  // Best-effort preference save — non-fatal if it fails
  const { error: prefSaveError } = await db
    .from('households')
    .update({ preferences: { ...currentPrefs, unit_preferences: mergedUnitPrefs } })
    .eq('id', householdId)
  if (prefSaveError) console.error('Failed to save unit preferences:', prefSaveError)

  return _buildAndSaveList(db, householdId, mealPlanId, mergedUnitPrefs, pantryStaples)
}

export async function loadShoppingList(mealPlanId: string): Promise<ShoppingListData | null> {
  const { db, householdId } = await getContext()
  const stores = await loadStores(db, householdId)

  const { data: household } = await db
    .from('households')
    .select('pantry_staples')
    .eq('id', householdId)
    .single()
  const pantryStaples: string[] = (household?.pantry_staples as string[] | null) ?? []

  const { data: plan } = await db
    .from('meal_plans')
    .select('id')
    .eq('id', mealPlanId)
    .eq('household_id', householdId)
    .single()

  if (!plan) return null

  const { data: list } = await db
    .from('shopping_lists')
    .select('id, store_assignments, generated_at, manual_overrides')
    .eq('meal_plan_id', mealPlanId)
    .single()

  if (!list) return null

  const manualItems: ManualItem[] =
    (list.manual_overrides as { added?: ManualItem[] } | null)?.added ?? []

  // Merge any manual items that are in manual_overrides but missing from
  // store_assignments (e.g. scheduleSave debounce didn't fire before navigation).
  const storeAssignments = list.store_assignments as StoreAssignments
  const existingManualIds = new Set<string>()
  for (const storeName of Object.keys(storeAssignments)) {
    for (const item of storeAssignments[storeName] ?? []) {
      if (item.manualId) existingManualIds.add(item.manualId)
    }
  }
  for (const mi of manualItems) {
    if (!existingManualIds.has(mi.id)) {
      const shoppingItem: ShoppingItem = {
        name: mi.name,
        quantity: mi.quantity,
        unit: mi.unit,
        category: 'other',
        checked: false,
        manual: true,
        manualId: mi.id,
      }
      storeAssignments[mi.store] = [
        ...(storeAssignments[mi.store] ?? []),
        shoppingItem,
      ]
    }
  }

  return {
    id: list.id,
    storeAssignments,
    generatedAt: list.generated_at,
    mealPlanId,
    manualItems,
    stores,
    pantryStaples,
  }
}

export async function saveCheckedState(
  listId: string,
  storeAssignments: StoreAssignments
): Promise<void> {
  const { db } = await getContext()
  await db
    .from('shopping_lists')
    .update({ store_assignments: storeAssignments })
    .eq('id', listId)
}

export async function saveManualItems(
  listId: string,
  items: ManualItem[]
): Promise<void> {
  const { db } = await getContext()
  await db
    .from('shopping_lists')
    .update({ manual_overrides: { added: items } })
    .eq('id', listId)
}

export async function addPantryStaple(rawName: string): Promise<void> {
  const { db, householdId } = await getContext()
  const normalized = normalizeName(rawName)

  const { data } = await db
    .from('households')
    .select('pantry_staples')
    .eq('id', householdId)
    .single()

  const current: string[] = (data?.pantry_staples as string[] | null) ?? []
  if (current.includes(normalized)) return

  await db
    .from('households')
    .update({ pantry_staples: [...current, normalized] })
    .eq('id', householdId)
}

export async function removePantryStaple(rawName: string): Promise<void> {
  const { db, householdId } = await getContext()
  const normalized = normalizeName(rawName)

  const { data } = await db
    .from('households')
    .select('pantry_staples')
    .eq('id', householdId)
    .single()

  const current: string[] = (data?.pantry_staples as string[] | null) ?? []

  await db
    .from('households')
    .update({ pantry_staples: current.filter(s => s !== normalized) })
    .eq('id', householdId)
}
