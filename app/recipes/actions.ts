'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { Ingredient, RecipeState } from '@/lib/types'

// Auth is enforced via getUser(); admin client is used for DB ops because
// the user JWT is not forwarded to PostgREST in server action context.
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

  let householdId = userData?.household_id as string | undefined

  if (!householdId) {
    const { data: household } = await db
      .from('households')
      .insert({ name: 'My Household' })
      .select('id')
      .single()

    if (household) {
      await db
        .from('users')
        .upsert({ id: user.id, email: user.email!, household_id: household.id })
      householdId = household.id
    }
  }

  if (!householdId) throw new Error('Failed to find or create household')
  return { db, householdId }
}

export async function createRecipe(formData: FormData): Promise<{ id: string }> {
  const { db, householdId } = await getContext()

  const ingredientsRaw = formData.get('ingredients') as string
  const ingredients: Ingredient[] = ingredientsRaw ? JSON.parse(ingredientsRaw) : []
  const servings = Math.max(1, parseInt(formData.get('default_servings') as string) || 4)

  const { data: recipe, error } = await db
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
  const { db } = await getContext()
  await db.from('recipes').update({ state: newState }).eq('id', recipeId)
  revalidatePath('/recipes')
  revalidatePath(`/recipes/${recipeId}`)
}

export async function deleteRecipe(recipeId: string): Promise<void> {
  const { db } = await getContext()
  await db.from('recipes').delete().eq('id', recipeId)
  revalidatePath('/recipes')
}

export async function resetRecipeToOriginal(recipeId: string): Promise<void> {
  const { db } = await getContext()

  const { data: recipe } = await db
    .from('recipes')
    .select('original_parsed_json')
    .eq('id', recipeId)
    .single()

  if (!recipe?.original_parsed_json) return

  const orig = recipe.original_parsed_json as Record<string, unknown>

  await db
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
