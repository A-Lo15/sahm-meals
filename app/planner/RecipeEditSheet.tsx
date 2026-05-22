'use client'

import { useState } from 'react'
import type { IngredientCategory, Ingredient, RecipeEditInput } from '@/lib/types'

const CATEGORIES: IngredientCategory[] = [
  'produce', 'dairy', 'meat', 'pantry', 'frozen', 'household', 'other',
]

interface IngredientRow {
  id: string
  qty: string
  unit: string
  name: string
  category: IngredientCategory
}

interface Props {
  scope: 'week' | 'library'
  initialValues: RecipeEditInput
  dayOfWeek: number
  onSave: (input: RecipeEditInput) => void
  onClose: () => void
}

function toRow(ing: Ingredient): IngredientRow {
  return {
    id: crypto.randomUUID(),
    qty: ing.quantity,
    unit: ing.unit,
    name: ing.name,
    category: ing.category,
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function RecipeEditSheet({ scope, initialValues, dayOfWeek, onSave, onClose }: Props) {
  const [title, setTitle] = useState(initialValues.title)
  const [servings, setServings] = useState(initialValues.servings)
  const [instructions, setInstructions] = useState(initialValues.instructions ?? '')
  const [rows, setRows] = useState<IngredientRow[]>(
    initialValues.ingredients.length > 0
      ? initialValues.ingredients.map(toRow)
      : [{ id: crypto.randomUUID(), qty: '', unit: '', name: '', category: '' }]
  )

  function addRow() {
    setRows((prev) => [...prev, { id: crypto.randomUUID(), qty: '', unit: '', name: '', category: '' }])
  }

  function updateRow(index: number, field: keyof Omit<IngredientRow, 'id'>, value: string) {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [field]: value } : r))
    )
  }

  const canSave = title.trim() !== '' && rows.some((r) => r.name.trim() !== '')

  function handleSave() {
    if (!canSave) return
    onSave({
      title: title.trim(),
      servings,
      ingredients: rows
        .filter((r) => r.name.trim() !== '')
        .map((r) => ({
          name: r.name.trim(),
          quantity: r.qty.trim(),
          unit: r.unit.trim(),
          category: r.category,
          notes: '',
        })),
      instructions: instructions.trim() || null,
    })
  }

  const scopeLabel = scope === 'week' ? 'this week only' : 'library recipe'

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex flex-col items-center pt-3 pb-2 px-4 flex-shrink-0">
          <div className="w-10 h-1 bg-gray-300 rounded-full mb-3" />
          <div className="flex items-center justify-between w-full">
            <h2 className="font-semibold text-gray-900 text-base">
              Edit — {scopeLabel}
            </h2>
            <button onClick={onClose} className="text-gray-400 text-sm">
              Cancel
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-4 pb-6">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 mt-2">
            Meal name
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            className="w-full px-3 py-2.5 bg-gray-100 rounded-xl text-sm focus:outline-none mb-4"
          />

          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Servings
          </label>
          <input
            type="number"
            min={1}
            value={servings}
            onChange={(e) => setServings(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="w-20 px-3 py-2.5 bg-gray-100 rounded-xl text-sm focus:outline-none mb-4"
          />

          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Ingredients
          </label>
          <div className="flex gap-1 mb-1 px-0.5">
            <span className="text-xs text-gray-400 w-14">Qty</span>
            <span className="text-xs text-gray-400 w-16">Unit</span>
            <span className="text-xs text-gray-400 flex-1">Name</span>
            <span className="text-xs text-gray-400 w-20">Category</span>
          </div>
          <div className="space-y-1.5 mb-2">
            {rows.map((row, i) => (
              <div key={row.id} className="flex gap-1">
                <input
                  type="text"
                  value={row.qty}
                  onChange={(e) => updateRow(i, 'qty', e.target.value)}
                  placeholder="2"
                  className="w-14 px-2 py-2 bg-gray-100 rounded-lg text-sm focus:outline-none"
                />
                <input
                  type="text"
                  value={row.unit}
                  onChange={(e) => updateRow(i, 'unit', e.target.value)}
                  placeholder="cups"
                  className="w-16 px-2 py-2 bg-gray-100 rounded-lg text-sm focus:outline-none"
                />
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => updateRow(i, 'name', e.target.value)}
                  placeholder="flour"
                  className="flex-1 px-2 py-2 bg-gray-100 rounded-lg text-sm focus:outline-none"
                />
                <select
                  value={row.category}
                  onChange={(e) => updateRow(i, 'category', e.target.value as IngredientCategory)}
                  className="w-20 px-1 py-2 bg-gray-100 rounded-lg text-xs focus:outline-none"
                >
                  <option value="">—</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <button onClick={addRow} className="text-sm text-green-600 font-medium py-1 mb-4">
            + Add ingredient
          </button>

          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Instructions{' '}
            <span className="text-gray-400 normal-case font-normal">(optional)</span>
          </label>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={4}
            placeholder="Step 1: ..."
            className="w-full px-3 py-2.5 bg-gray-100 rounded-xl text-sm focus:outline-none resize-none mb-4"
          />

          <button
            onClick={handleSave}
            disabled={!canSave}
            className="w-full py-3 bg-green-600 text-white font-semibold rounded-xl text-sm disabled:opacity-40 active:bg-green-700"
          >
            Save changes
          </button>
        </div>
      </div>
    </>
  )
}
