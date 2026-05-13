import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureMealPlan } from './actions'
import PlannerClient from './PlannerClient'
import type { SlotWithRecipe, RecipeOption } from '@/lib/types'

function getMondayOf(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().split('T')[0]
}

export default async function PlannerPage({
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
  const weekParam = params.week
  const weekStart = weekParam
    ? getMondayOf(new Date(weekParam + 'T12:00:00'))
    : getMondayOf(new Date())

  const { id: mealPlanId } = await ensureMealPlan(weekStart)

  const [slotsResult, recipesResult] = await Promise.all([
    db
      .from('meal_plan_recipes')
      .select(
        `id, meal_plan_id, recipe_id, day_of_week, servings_override, position,
         recipe:recipes(id, title, default_servings, source_image_url, state, in_library)`
      )
      .eq('meal_plan_id', mealPlanId)
      .order('position'),

    db
      .from('recipes')
      .select('id, title, default_servings, source_image_url, state')
      .eq('household_id', householdId)
      .eq('in_library', true)
      .order('title'),
  ])

  const slots = (slotsResult.data ?? []) as unknown as SlotWithRecipe[]
  const recipes = (recipesResult.data ?? []) as RecipeOption[]

  return (
    <PlannerClient
      key={mealPlanId}
      mealPlanId={mealPlanId}
      weekStart={weekStart}
      initialSlots={slots}
      recipes={recipes}
    />
  )
}
