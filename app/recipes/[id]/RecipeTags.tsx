'use client'

import { useState, useTransition } from 'react'
import { updateRecipeTags } from '../actions'
import { CUISINES, MEAL_TYPES, COOKING_METHODS } from '@/lib/recipeTags'
import TagPill from '../../components/TagPill'

interface Props {
  recipeId: string
  initialCuisines: string[]
  initialMealTypes: string[]
  initialCookingMethods: string[]
}

type Dimension = 'cuisines' | 'mealTypes' | 'cookingMethods'

export default function RecipeTags({
  recipeId,
  initialCuisines,
  initialMealTypes,
  initialCookingMethods,
}: Props) {
  const [cuisines, setCuisines] = useState(initialCuisines)
  const [mealTypes, setMealTypes] = useState(initialMealTypes)
  const [cookingMethods, setCookingMethods] = useState(initialCookingMethods)
  const [, startTransition] = useTransition()

  function persist(next: { cuisines: string[]; meal_types: string[]; cooking_methods: string[] }) {
    startTransition(() => updateRecipeTags(recipeId, next))
  }

  function toggle(dimension: Dimension, value: string) {
    if (dimension === 'cuisines') {
      const next = cuisines.includes(value) ? cuisines.filter((c) => c !== value) : [...cuisines, value]
      setCuisines(next)
      persist({ cuisines: next, meal_types: mealTypes, cooking_methods: cookingMethods })
    } else if (dimension === 'mealTypes') {
      const next = mealTypes.includes(value) ? mealTypes.filter((c) => c !== value) : [...mealTypes, value]
      setMealTypes(next)
      persist({ cuisines, meal_types: next, cooking_methods: cookingMethods })
    } else {
      const next = cookingMethods.includes(value)
        ? cookingMethods.filter((c) => c !== value)
        : [...cookingMethods, value]
      setCookingMethods(next)
      persist({ cuisines, meal_types: mealTypes, cooking_methods: next })
    }
  }

  function renderPillRow(label: string, options: readonly string[], selected: string[], dimension: Dimension) {
    return (
      <div>
        <p className="text-xs text-gray-400 mb-1.5">{label}</p>
        <div className="flex flex-wrap gap-2">
          {options.map((opt) => (
            <TagPill
              key={opt}
              label={opt}
              selected={selected.includes(opt)}
              onClick={() => toggle(dimension, opt)}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <section>
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Tags</h2>
      <div className="space-y-4">
        {renderPillRow('Cuisine', CUISINES, cuisines, 'cuisines')}
        {renderPillRow('Meal Type', MEAL_TYPES, mealTypes, 'mealTypes')}
        {renderPillRow('Cooking Method', COOKING_METHODS, cookingMethods, 'cookingMethods')}
      </div>
    </section>
  )
}
