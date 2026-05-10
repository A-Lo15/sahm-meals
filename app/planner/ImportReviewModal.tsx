'use client'

import { useState } from 'react'
import { detectCategory } from '@/lib/parseRecipe'
import type { ParsedRecipe } from '@/lib/parseRecipe'
import type { Ingredient } from '@/lib/types'

type IngredientWithKey = Ingredient & { _key: string }

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface ImportReviewModalProps {
  recipe: ParsedRecipe
  day: number
  onConfirm: (edited: ParsedRecipe) => void
  onDismiss: () => void
}

export default function ImportReviewModal({
  recipe,
  day,
  onConfirm,
  onDismiss,
}: ImportReviewModalProps) {
  const [title, setTitle] = useState(recipe.title)
  const [servings, setServings] = useState(recipe.default_servings)
  const [ingredients, setIngredients] = useState<IngredientWithKey[]>(() =>
    recipe.ingredients.map((i) => ({ ...i, _key: crypto.randomUUID() }))
  )

  function updateIngredient(
    index: number,
    field: 'name' | 'quantity' | 'unit',
    value: string
  ) {
    setIngredients((prev) =>
      prev.map((ing, i) => (i === index ? { ...ing, [field]: value } : ing))
    )
  }

  function removeIngredient(index: number) {
    setIngredients((prev) => prev.filter((_, i) => i !== index))
  }

  function addIngredient() {
    setIngredients((prev) => [
      ...prev,
      { name: '', quantity: '', unit: '', category: 'other', notes: '', _key: crypto.randomUUID() },
    ])
  }

  function handleConfirm() {
    const cleaned = ingredients
      .filter((i) => i.name.trim() !== '')
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      .map(({ _key, ...ing }) => ({ ...ing, category: detectCategory(ing.name) }))
    onConfirm({
      ...recipe,
      title: title.trim(),
      default_servings: servings,
      ingredients: cleaned,
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200">
        <button
          onClick={onDismiss}
          className="w-8 h-8 flex items-center justify-center text-gray-400"
          aria-label="Close"
        >
          ✕
        </button>
        <h2 className="font-semibold text-gray-900 text-base">Review Recipe</h2>
        <div className="w-8" />
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-6">
        {/* Title */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1.5 w-full px-4 py-2.5 bg-gray-100 rounded-xl text-base focus:outline-none"
          />
        </div>

        {/* Servings */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Servings
          </label>
          <div className="flex items-center gap-4 mt-1.5">
            <button
              onClick={() => setServings((s) => Math.max(1, s - 1))}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-600 text-xl leading-none"
              aria-label="Decrease servings"
            >
              −
            </button>
            <span className="text-base font-medium text-gray-900 w-6 text-center">
              {servings}
            </span>
            <button
              onClick={() => setServings((s) => s + 1)}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-600 text-xl leading-none"
              aria-label="Increase servings"
            >
              +
            </button>
          </div>
        </div>

        {/* Ingredients */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Ingredients
          </label>
          <div className="mt-2 space-y-2">
            {ingredients.map((ing, i) => (
              <div key={ing._key} className="flex items-center gap-2">
                <input
                  type="text"
                  value={ing.quantity}
                  onChange={(e) => updateIngredient(i, 'quantity', e.target.value)}
                  placeholder="Qty"
                  className="w-14 px-2 py-2 bg-gray-100 rounded-lg text-sm focus:outline-none text-center"
                />
                <input
                  type="text"
                  value={ing.unit}
                  onChange={(e) => updateIngredient(i, 'unit', e.target.value)}
                  placeholder="Unit"
                  className="w-16 px-2 py-2 bg-gray-100 rounded-lg text-sm focus:outline-none text-center"
                />
                <input
                  type="text"
                  value={ing.name}
                  onChange={(e) => updateIngredient(i, 'name', e.target.value)}
                  placeholder="Ingredient"
                  className="flex-1 px-2 py-2 bg-gray-100 rounded-lg text-sm focus:outline-none"
                />
                <button
                  onClick={() => removeIngredient(i)}
                  className="w-6 text-gray-300 text-sm flex-shrink-0"
                  aria-label="Remove ingredient"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={addIngredient}
            className="mt-3 text-sm text-blue-600 font-medium"
          >
            + Add ingredient
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-gray-200 flex gap-3">
        <button
          onClick={() => onConfirm(recipe)}
          disabled={!recipe.title?.trim()}
          className="flex-1 py-3 bg-gray-100 text-gray-700 font-semibold rounded-xl text-sm active:bg-gray-200 disabled:opacity-50"
        >
          Import original
        </button>
        <button
          onClick={handleConfirm}
          disabled={!title.trim()}
          className="flex-1 py-3 bg-green-600 text-white font-semibold rounded-xl text-sm disabled:opacity-50 active:bg-green-700"
        >
          Add to {DAYS[day]}
        </button>
      </div>
    </div>
  )
}
