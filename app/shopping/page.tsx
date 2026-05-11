import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadShoppingList } from './actions'
import ShoppingClient from './ShoppingClient'

function getMondayOf(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().split('T')[0]
}

export default async function ShoppingPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>
}) {
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
  if (!householdId) redirect('/login')

  const params = await searchParams
  const weekStart = params.week
    ? getMondayOf(new Date(params.week + 'T12:00:00'))
    : getMondayOf(new Date())

  // Check if there are meals planned this week
  const { data: plan } = await db
    .from('meal_plans')
    .select('id')
    .eq('household_id', householdId)
    .eq('week_start_date', weekStart)
    .single()

  let hasMeals = false
  if (plan) {
    const { count } = await db
      .from('meal_plan_recipes')
      .select('id', { count: 'exact', head: true })
      .eq('meal_plan_id', plan.id)
    hasMeals = (count ?? 0) > 0
  }

  const existing = await loadShoppingList(weekStart)

  return (
    <ShoppingClient
      weekStart={weekStart}
      initialListId={existing?.id ?? null}
      initialAssignments={existing?.storeAssignments ?? null}
      initialGeneratedAt={existing?.generatedAt ?? null}
      hasMeals={hasMeals}
      initialManualItems={existing?.manualItems ?? []}
    />
  )
}
