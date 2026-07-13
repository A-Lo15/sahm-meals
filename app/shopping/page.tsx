import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadShoppingList } from './actions'
import ShoppingClient from './ShoppingClient'

export default async function ShoppingPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const params = await searchParams
  const mealPlanId = params.plan

  if (!mealPlanId) redirect('/planner')

  const db = createAdminClient()
  const { data: userData } = await db
    .from('users')
    .select('household_id')
    .eq('id', user.id)
    .single()

  const householdId = userData?.household_id as string | undefined
  if (!householdId) redirect('/login')

  const { data: householdData } = await db
    .from('households')
    .select('pantry_staples')
    .eq('id', householdId)
    .single()
  const initialStaples = (householdData?.pantry_staples as string[] | null) ?? []

  // Verify the plan belongs to this household
  const { data: plan } = await db
    .from('meal_plans')
    .select('id, start_date, end_date')
    .eq('id', mealPlanId)
    .eq('household_id', householdId)
    .single()

  if (!plan) redirect('/planner')

  const { count } = await db
    .from('meal_plan_recipes')
    .select('id', { count: 'exact', head: true })
    .eq('meal_plan_id', mealPlanId)
  const hasMeals = (count ?? 0) > 0

  const existing = await loadShoppingList(mealPlanId)

  return (
    <ShoppingClient
      mealPlanId={mealPlanId}
      initialListId={existing?.id ?? null}
      initialAssignments={existing?.storeAssignments ?? null}
      initialGeneratedAt={existing?.generatedAt ?? null}
      hasMeals={hasMeals}
      initialManualItems={existing?.manualItems ?? []}
      initialStores={existing?.stores ?? []}
      initialStaples={initialStaples}
    />
  )
}
