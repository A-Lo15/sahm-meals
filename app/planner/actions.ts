'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ParsedRecipe } from '@/lib/parseRecipe'
import type { CustomMealInput, SlotWithRecipe } from '@/lib/types'

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

export async function ensureMealPlan(weekStartDate: string): Promise<{ id: string }> {
  const { db, householdId } = await getContext()

  const { data: existing } = await db
    .from('meal_plans')
    .select('id')
    .eq('household_id', householdId)
    .eq('week_start_date', weekStartDate)
    .single()

  if (existing) return { id: existing.id }

  const { data: created, error } = await db
    .from('meal_plans')
    .insert({ household_id: householdId, week_start_date: weekStartDate })
    .select('id')
    .single()

  if (error) throw error
  return { id: created.id }
}

export async function addRecipeToDay(
  mealPlanId: string,
  recipeId: string,
  dayOfWeek: number
): Promise<{ id: string }> {
  const { db } = await getContext()

  const { data: existing } = await db
    .from('meal_plan_recipes')
    .select('position')
    .eq('meal_plan_id', mealPlanId)
    .eq('day_of_week', dayOfWeek)
    .order('position', { ascending: false })
    .limit(1)
    .single()

  const nextPosition = existing ? existing.position + 1 : 0

  const { data, error } = await db
    .from('meal_plan_recipes')
    .insert({
      meal_plan_id: mealPlanId,
      recipe_id: recipeId,
      day_of_week: dayOfWeek,
      position: nextPosition,
    })
    .select('id')
    .single()

  if (error) throw error
  revalidatePath('/planner')
  return { id: data.id }
}

export async function removeSlot(slotId: string): Promise<void> {
  const { db } = await getContext()
  await db.from('meal_plan_recipes').delete().eq('id', slotId)
  revalidatePath('/planner')
}

export async function updateSlotServings(
  slotId: string,
  servings: number
): Promise<void> {
  const { db } = await getContext()
  await db
    .from('meal_plan_recipes')
    .update({ servings_override: servings })
    .eq('id', slotId)
}

export async function importAndAddToDay(
  parsedRecipe: ParsedRecipe,
  mealPlanId: string,
  dayOfWeek: number
): Promise<{ recipeId: string; slotId: string }> {
  const { db, householdId } = await getContext()

  const { data: plan } = await db
    .from('meal_plans')
    .select('id')
    .eq('id', mealPlanId)
    .eq('household_id', householdId)
    .single()
  if (!plan) throw new Error('Meal plan not found or access denied')

  const { data: recipe, error: recipeError } = await db
    .from('recipes')
    .insert({
      household_id: householdId,
      title: parsedRecipe.title,
      description: parsedRecipe.description ?? null,
      default_servings: parsedRecipe.default_servings,
      source_url: parsedRecipe.source_url || null,
      source_image_url: parsedRecipe.source_image_url ?? null,
      ingredients: parsedRecipe.ingredients,
      instructions: parsedRecipe.instructions ?? null,
      original_parsed_json: parsedRecipe,
      state: 'tried',
    })
    .select('id')
    .single()

  if (recipeError) throw recipeError

  const { data: existing } = await db
    .from('meal_plan_recipes')
    .select('position')
    .eq('meal_plan_id', mealPlanId)
    .eq('day_of_week', dayOfWeek)
    .order('position', { ascending: false })
    .limit(1)
    .single()

  const nextPosition = existing ? existing.position + 1 : 0

  const { data: slot, error: slotError } = await db
    .from('meal_plan_recipes')
    .insert({
      meal_plan_id: mealPlanId,
      recipe_id: recipe.id,
      day_of_week: dayOfWeek,
      position: nextPosition,
    })
    .select('id')
    .single()

  if (slotError) {
    const { error: deleteError } = await db.from('recipes').delete().eq('id', recipe.id)
    if (deleteError) console.error('Failed to clean up orphaned recipe', recipe.id, deleteError)
    throw slotError
  }

  revalidatePath('/planner')
  return { recipeId: recipe.id, slotId: slot.id }
}

export async function createCustomMeal(
  mealPlanId: string,
  dayOfWeek: number,
  input: CustomMealInput
): Promise<SlotWithRecipe> {
  const { db, householdId } = await getContext()

  const { data: plan } = await db
    .from('meal_plans')
    .select('id')
    .eq('id', mealPlanId)
    .eq('household_id', householdId)
    .single()
  if (!plan) throw new Error('Meal plan not found or access denied')

  const { data: recipe, error: recipeError } = await db
    .from('recipes')
    .insert({
      household_id: householdId,
      title: input.title,
      description: null,
      default_servings: input.servings,
      source_url: null,
      source_image_url: null,
      ingredients: input.ingredients,
      instructions: null,
      original_parsed_json: null,
      state: 'saved',
      in_library: input.saveToLibrary,
    })
    .select('id')
    .single()
  if (recipeError) throw recipeError

  const { data: existing } = await db
    .from('meal_plan_recipes')
    .select('position')
    .eq('meal_plan_id', mealPlanId)
    .eq('day_of_week', dayOfWeek)
    .order('position', { ascending: false })
    .limit(1)
    .single()
  const nextPosition = existing ? existing.position + 1 : 0

  const { data: slot, error: slotError } = await db
    .from('meal_plan_recipes')
    .insert({
      meal_plan_id: mealPlanId,
      recipe_id: recipe.id,
      day_of_week: dayOfWeek,
      position: nextPosition,
    })
    .select('id')
    .single()

  if (slotError) {
    await db.from('recipes').delete().eq('id', recipe.id)
    throw slotError
  }

  revalidatePath('/planner')
  return {
    id: slot.id,
    meal_plan_id: mealPlanId,
    recipe_id: recipe.id,
    day_of_week: dayOfWeek,
    servings_override: null,
    position: nextPosition,
    recipe: {
      id: recipe.id,
      title: input.title,
      default_servings: input.servings,
      source_image_url: null,
      state: 'saved',
      in_library: input.saveToLibrary,
    },
  }
}

export async function removeSlotAndRecipe(slotId: string, recipeId: string): Promise<void> {
  const { db } = await getContext()

  const { data: otherSlots } = await db
    .from('meal_plan_recipes')
    .select('id')
    .eq('recipe_id', recipeId)
    .neq('id', slotId)

  await db.from('meal_plan_recipes').delete().eq('id', slotId)

  if (!otherSlots || otherSlots.length === 0) {
    await db.from('recipes').delete().eq('id', recipeId)
  }

  revalidatePath('/planner')
}
