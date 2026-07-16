import { createAdminClient } from '../lib/supabase/admin'
import { suggestRecipeTags } from '../lib/recipeTagsAi'
import type { Ingredient } from '../lib/types'

async function main() {
  const db = createAdminClient()

  const { data: recipes, error } = await db
    .from('recipes')
    .select('id, title, description, ingredients, instructions, cuisines, meal_types, cooking_methods')

  if (error) {
    console.error('Failed to fetch recipes:', error)
    process.exit(1)
  }

  // Note: "untagged" = all three arrays empty. A recipe intentionally cleared to zero tags
  // would be re-tagged if this script runs again — acceptable for a one-off backfill.
  const untagged = (recipes ?? []).filter(
    (r) => r.cuisines.length === 0 && r.meal_types.length === 0 && r.cooking_methods.length === 0
  )

  console.log(`Found ${untagged.length} untagged recipe(s) out of ${recipes?.length ?? 0} total.`)

  for (const recipe of untagged) {
    const tags = await suggestRecipeTags({
      title: recipe.title,
      description: recipe.description,
      ingredients: (recipe.ingredients ?? []) as Ingredient[],
      instructions: recipe.instructions,
    })

    const { error: updateError } = await db
      .from('recipes')
      .update({
        cuisines: tags.cuisines,
        meal_types: tags.meal_types,
        cooking_methods: tags.cooking_methods,
      })
      .eq('id', recipe.id)

    if (updateError) {
      console.error(`Failed to update recipe ${recipe.id} (${recipe.title}):`, updateError)
    } else {
      console.log(`Tagged "${recipe.title}":`, tags)
    }
  }

  console.log('Backfill complete.')
}

main()
