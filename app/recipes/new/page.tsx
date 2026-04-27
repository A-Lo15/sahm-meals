'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createRecipe } from '../actions'
import type { Ingredient, IngredientCategory } from '@/lib/types'

const CATEGORIES: { value: IngredientCategory; label: string }[] = [
  { value: '', label: 'Category' },
  { value: 'produce', label: 'Produce' },
  { value: 'dairy', label: 'Dairy' },
  { value: 'meat', label: 'Meat' },
  { value: 'pantry', label: 'Pantry' },
  { value: 'frozen', label: 'Frozen' },
  { value: 'household', label: 'Household' },
  { value: 'other', label: 'Other' },
]

const BLANK: Ingredient = { name: '', quantity: '', unit: '', category: '', notes: '' }

export default function NewRecipePage() {
  const router = useRouter()
  const [ingredients, setIngredients] = useState<Ingredient[]>([{ ...BLANK }])
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function addIngredient() {
    setIngredients((prev) => [...prev, { ...BLANK }])
  }

  function removeIngredient(i: number) {
    setIngredients((prev) => prev.filter((_, idx) => idx !== i))
  }

  function updateIngredient(i: number, field: keyof Ingredient, value: string) {
    setIngredients((prev) => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: value }
      return next
    })
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const filled = ingredients.filter((ing) => ing.name.trim())
    if (filled.length === 0) {
      setError('Add at least one ingredient.')
      return
    }

    const formData = new FormData(e.currentTarget)
    formData.set('ingredients', JSON.stringify(filled))

    startTransition(async () => {
      try {
        const { id } = await createRecipe(formData)
        router.push(`/recipes/${id}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.')
      }
    })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <Link href="/recipes" className="text-gray-500 py-1 pr-3">
            Cancel
          </Link>
          <h1 className="font-bold text-gray-900">New Recipe</h1>
          <button
            form="recipe-form"
            type="submit"
            disabled={isPending}
            className="text-green-600 font-semibold py-1 pl-3 disabled:opacity-40"
          >
            {isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>

      <form
        id="recipe-form"
        onSubmit={handleSubmit}
        className="max-w-lg mx-auto px-4 py-6 space-y-6 pb-16"
      >
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Basic info */}
        <div className="space-y-4">
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              id="title"
              name="title"
              type="text"
              required
              placeholder="e.g. Chicken Tikka Masala"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
              Description{' '}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="description"
              name="description"
              rows={2}
              placeholder="Quick summary or notes"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
            />
          </div>

          <div className="flex gap-4 items-end">
            <div>
              <label
                htmlFor="default_servings"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Servings
              </label>
              <input
                id="default_servings"
                name="default_servings"
                type="number"
                min="1"
                max="99"
                defaultValue={4}
                className="w-24 px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="source_url" className="block text-sm font-medium text-gray-700 mb-1">
              Source URL{' '}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              id="source_url"
              name="source_url"
              type="url"
              placeholder="https://..."
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
        </div>

        {/* Ingredients */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-800">Ingredients</h2>
            <button
              type="button"
              onClick={addIngredient}
              className="text-green-600 text-sm font-medium py-1 pl-2"
            >
              + Add
            </button>
          </div>

          <div className="space-y-3">
            {ingredients.map((ing, i) => (
              <div
                key={i}
                className="bg-white border border-gray-200 rounded-xl p-3 space-y-2"
              >
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={ing.name}
                    onChange={(e) => updateIngredient(i, 'name', e.target.value)}
                    placeholder="Ingredient name"
                    className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  <button
                    type="button"
                    onClick={() => removeIngredient(i)}
                    disabled={ingredients.length === 1}
                    className="w-10 h-10 flex items-center justify-center text-gray-300 disabled:opacity-20 text-lg"
                    aria-label="Remove ingredient"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={ing.quantity}
                    onChange={(e) => updateIngredient(i, 'quantity', e.target.value)}
                    placeholder="Qty"
                    className="w-16 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  <input
                    type="text"
                    value={ing.unit}
                    onChange={(e) => updateIngredient(i, 'unit', e.target.value)}
                    placeholder="Unit"
                    className="w-20 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  <select
                    value={ing.category}
                    onChange={(e) => updateIngredient(i, 'category', e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white text-gray-600"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Instructions */}
        <div>
          <label
            htmlFor="instructions"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Instructions{' '}
            <span className="text-gray-400 font-normal">(one step per line)</span>
          </label>
          <textarea
            id="instructions"
            name="instructions"
            rows={7}
            placeholder="1. Preheat oven to 375°F&#10;2. Mix dry ingredients..."
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
          />
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="w-full py-4 bg-green-600 text-white font-semibold rounded-xl text-base disabled:opacity-50 active:bg-green-700"
        >
          {isPending ? 'Saving…' : 'Save Recipe'}
        </button>
      </form>
    </div>
  )
}
