'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { buildStoreAssignments, type StoreAssignments } from '@/lib/shopping'

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

  const storeAssignments = buildStoreAssignments((slots ?? []) as unknown as Parameters<typeof buildStoreAssignments>[0])

  const now = new Date().toISOString()
  const { data: saved, error } = await db
    .from('shopping_lists')
    .upsert(
      {
        meal_plan_id: plan.id,
        store_assignments: storeAssignments,
        generated_at: now,
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
    .select('id, store_assignments, generated_at')
    .eq('meal_plan_id', plan.id)
    .single()

  if (!list) return null

  return {
    id: list.id,
    storeAssignments: list.store_assignments as StoreAssignments,
    generatedAt: list.generated_at,
    mealPlanId: plan.id,
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
