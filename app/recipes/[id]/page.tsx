import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import StateControls from './StateControls'
import RecipeIngredients from './RecipeIngredients'
import type { Recipe, Ingredient } from '@/lib/types'

export default async function RecipeDetailPage({ params }: { params: { id: string } }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const db = createAdminClient()
  const { data } = await db
    .from('recipes')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!data) notFound()

  const recipe = data as Recipe
  const ingredients = (recipe.ingredients ?? []) as Ingredient[]
  const steps = recipe.instructions
    ? recipe.instructions
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    : []

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto">
          <Link href="/recipes" className="text-gray-500 py-1 pr-3 inline-block">
            ‹ Recipes
          </Link>
        </div>
      </header>

      <div className="max-w-lg mx-auto">
        <StateControls
          recipeId={recipe.id}
          initialState={recipe.state}
          hasOriginal={recipe.original_parsed_json !== null}
        />

        <div className="px-4 py-5 space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 leading-tight">{recipe.title}</h1>
            {recipe.description && (
              <p className="text-gray-500 mt-1 text-base">{recipe.description}</p>
            )}
            {recipe.source_url && (
              <div className="flex items-center gap-2 mt-2 text-sm text-gray-400">
                <a
                  href={recipe.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-green-600"
                >
                  Source ↗
                </a>
              </div>
            )}
          </div>

          {ingredients.length > 0 && (
            <RecipeIngredients
              ingredients={ingredients}
              defaultServings={recipe.default_servings}
            />
          )}

          {steps.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Instructions
              </h2>
              <ol className="space-y-4">
                {steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-green-100 text-green-700 rounded-full text-xs font-bold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-gray-700 text-sm leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {ingredients.length === 0 && steps.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-10">
              No ingredients or instructions added yet.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
