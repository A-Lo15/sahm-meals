import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import PlanDetailClient from './PlanDetailClient'
import type { SlotWithRecipe, RecipeOption } from '@/lib/types'

export default async function PlanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
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

  const { id } = await params

  const { data: plan } = await db
    .from('meal_plans')
    .select('id, start_date, end_date')
    .eq('id', id)
    .eq('household_id', householdId)
    .single()

  if (!plan) notFound()

  const [slotsResult, recipesResult] = await Promise.all([
    db
      .from('meal_plan_recipes')
      .select(
        `id, meal_plan_id, recipe_id, plan_date, servings_override, position,
         recipe:recipes(id, title, default_servings, source_image_url, state, in_library, ingredients, instructions)`
      )
      .eq('meal_plan_id', plan.id)
      .order('position'),

    db
      .from('recipes')
      .select('id, title, default_servings, source_image_url, state, ingredients, cuisines, meal_types, cooking_methods')
      .eq('household_id', householdId)
      .eq('in_library', true)
      .order('title'),
  ])

  const slots = (slotsResult.data ?? []) as unknown as SlotWithRecipe[]
  const recipes = (recipesResult.data ?? []) as RecipeOption[]

  return (
    <PlanDetailClient
      key={plan.id}
      mealPlanId={plan.id}
      startDate={plan.start_date}
      endDate={plan.end_date}
      initialSlots={slots}
      recipes={recipes}
    />
  )
}
