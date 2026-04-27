'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { Ingredient, RecipeState } from '@/lib/types'

async function getContext() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data } = await supabase
    .from('users')
    .select('household_id')
    .eq('id', user.id)
    .single()

  if (!data?.household_id) throw new Error('No household found')
  return { supabase, householdId: data.household_id as string }
}

export async function createRecipe(formData: FormData): Promise<{ id: string }> {
  const { supabase, householdId } = await getContext()

  const ingredientsRaw = formData.get('ingredients') as string
  const ingredients: Ingredient[] = ingredientsRaw ? JSON.parse(ingredientsRaw) : []

  const servings = Math.max(1, parseInt(formData.get('default_servings') as string) || 4)

  const { data: recipe, error } = await supabase
    .from('recipes')
    .insert({
      household_id: householdId,
      title: (formData.get('title') as string).trim(),
      description: (formData.get('description') as string)?.trim() || null,
      default_servings: servings,
      source_url: (formData.get('source_url') as string)?.trim() || null,
      ingredients,
      instructions: (formData.get('instructions') as string)?.trim() || null,
      state: 'saved' as RecipeState,
    })
    .select('id')
    .single()

  if (error) throw error

  revalidatePath('/recipes')
  return { id: recipe.id }
}

export async function updateRecipeState(
  recipeId: string,
  newState: RecipeState
): Promise<void> {
  const { supabase } = await getContext()

  await supabase.from('recipes').update({ state: newState }).eq('id', recipeId)

  revalidatePath('/recipes')
  revalidatePath(`/recipes/${recipeId}`)
}

export async function deleteRecipe(recipeId: string): Promise<void> {
  const { supabase } = await getContext()

  await supabase.from('recipes').delete().eq('id', recipeId)

  revalidatePath('/recipes')
}

export async function resetRecipeToOriginal(recipeId: string): Promise<void> {
  const { supabase } = await getContext()

  const { data: recipe } = await supabase
    .from('recipes')
    .select('original_parsed_json')
    .eq('id', recipeId)
    .single()

  if (!recipe?.original_parsed_json) return

  const orig = recipe.original_parsed_json as Record<string, unknown>

  await supabase
    .from('recipes')
    .update({
      title: orig.title ?? null,
      description: orig.description ?? null,
      default_servings: orig.default_servings ?? 4,
      ingredients: orig.ingredients ?? [],
      instructions: orig.instructions ?? null,
      source_image_url: orig.source_image_url ?? null,
    })
    .eq('id', recipeId)

  revalidatePath(`/recipes/${recipeId}`)
}
