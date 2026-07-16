'use client'

import { useState } from 'react'
import Link from 'next/link'
import RecipeTagFilters from '../components/RecipeTagFilters'
import { matchesTagFilter } from '@/lib/recipeTags'
import type { Recipe } from '@/lib/types'

const STATE_BADGE: Record<string, { label: string; cls: string }> = {
  tried: { label: 'Tried', cls: 'bg-gray-100 text-gray-600' },
  saved: { label: 'Saved', cls: 'bg-blue-100 text-blue-700' },
  favorited: { label: '★ Fave', cls: 'bg-amber-100 text-amber-700' },
}

interface Props {
  recipes: Recipe[]
  emptyIcon: string
  emptyMessage: string
}

export default function RecipesListClient({ recipes, emptyIcon, emptyMessage }: Props) {
  const [search, setSearch] = useState('')
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>([])
  const [selectedMealTypes, setSelectedMealTypes] = useState<string[]>([])
  const [selectedCookingMethods, setSelectedCookingMethods] = useState<string[]>([])

  const q = search.trim().toLowerCase()
  const filtered = recipes.filter((r) => {
    const matchesSearch =
      q === '' || r.title.toLowerCase().includes(q) || r.ingredients.some((i) => i.name.toLowerCase().includes(q))
    return (
      matchesSearch &&
      matchesTagFilter(r.cuisines, selectedCuisines) &&
      matchesTagFilter(r.meal_types, selectedMealTypes) &&
      matchesTagFilter(r.cooking_methods, selectedCookingMethods)
    )
  })

  return (
    <main className="max-w-lg mx-auto px-4 py-4 space-y-3">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search recipes or ingredients…"
        className="w-full px-4 py-2.5 bg-gray-100 rounded-xl text-base focus:outline-none"
      />

      <RecipeTagFilters
        selectedCuisines={selectedCuisines}
        onCuisinesChange={setSelectedCuisines}
        selectedMealTypes={selectedMealTypes}
        onMealTypesChange={setSelectedMealTypes}
        selectedCookingMethods={selectedCookingMethods}
        onCookingMethodsChange={setSelectedCookingMethods}
      />

      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">{emptyIcon}</div>
          <p className="font-medium text-gray-600">{recipes.length === 0 ? emptyMessage : 'No recipes match'}</p>
          {recipes.length === 0 && (
            <Link
              href="/recipes/new"
              className="mt-4 inline-block px-5 py-2.5 bg-green-600 text-white rounded-xl text-sm font-medium"
            >
              Add a recipe
            </Link>
          )}
        </div>
      ) : (
        filtered.map((recipe) => {
          const badge = STATE_BADGE[recipe.state] ?? STATE_BADGE.tried
          return (
            <Link key={recipe.id} href={`/recipes/${recipe.id}`} className="block">
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 active:bg-gray-50">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 text-base truncate">{recipe.title}</h3>
                    {recipe.description && (
                      <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{recipe.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                      <span className="text-xs text-gray-400">{recipe.default_servings} servings</span>
                      {recipe.times_cooked > 0 && (
                        <span className="text-xs text-gray-400">{recipe.times_cooked}× cooked</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          )
        })
      )}
    </main>
  )
}
