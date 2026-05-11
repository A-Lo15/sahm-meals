'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { buildStoreAssignments, STORES, type StoreAssignments, type ShoppingItem, type ManualItem } from '@/lib/shopping'

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

export interface ShoppingListData {
  id: string
  storeAssignments: StoreAssignments
  generatedAt: string
  mealPlanId: string
  manualItems: ManualItem[]
}

export async function generateShoppingList(weekStart: string): Promise<ShoppingListData | null> {
  const { db, householdId } = await getContext()

  const { data: plan } = await db
    .from('meal_plans')
    .select('id')
    .eq('household_id', householdId)
    .eq('week_start_date', weekStart)
    .single()

  if (!plan) return null

  const { data: slots } = await db
    .from('meal_plan_recipes')
    .select(`servings_override, recipe:recipes(default_servings, ingredients)`)
    .eq('meal_plan_id', plan.id)

  const storeAssignments = buildStoreAssignments(
    (slots ?? []) as unknown as Parameters<typeof buildStoreAssignments>[0]
  )

  // Load existing manual items and their prior checked states
  const { data: existingList } = await db
    .from('shopping_lists')
    .select('manual_overrides, store_assignments')
    .eq('meal_plan_id', plan.id)
    .single()

  const manualItems: ManualItem[] =
    (existingList?.manual_overrides as { added?: ManualItem[] } | null)?.added ?? []

  // Preserve checked states of manual items across regeneration
  const priorAssignments = (existingList?.store_assignments ?? {}) as StoreAssignments
  const priorCheckedMap = new Map<string, boolean>()
  for (const store of STORES) {
    for (const item of priorAssignments[store] ?? []) {
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
        meal_plan_id: plan.id,
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
    mealPlanId: plan.id,
    manualItems,
  }
}

export async function loadShoppingList(weekStart: string): Promise<ShoppingListData | null> {
  const { db, householdId } = await getContext()

  const { data: plan } = await db
    .from('meal_plans')
    .select('id')
    .eq('household_id', householdId)
    .eq('week_start_date', weekStart)
    .single()

  if (!plan) return null

  const { data: list } = await db
    .from('shopping_lists')
    .select('id, store_assignments, generated_at, manual_overrides')
    .eq('meal_plan_id', plan.id)
    .single()

  if (!list) return null

  const manualItems: ManualItem[] =
    (list.manual_overrides as { added?: ManualItem[] } | null)?.added ?? []

  // Merge any manual items that are in manual_overrides but missing from
  // store_assignments (e.g. scheduleSave debounce didn't fire before navigation).
  const storeAssignments = list.store_assignments as StoreAssignments
  const existingManualIds = new Set<string>()
  for (const store of STORES) {
    for (const item of storeAssignments[store] ?? []) {
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
    mealPlanId: plan.id,
    manualItems,
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
