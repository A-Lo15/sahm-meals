'use client'

import { useState } from 'react'
import type { IngredientCategory, CustomMealInput } from '@/lib/types'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const CATEGORIES: IngredientCategory[] = [
  'produce', 'dairy', 'meat', 'pantry', 'frozen', 'household', 'other',
]

interface IngredientRow {
  qty: string
  unit: string
  name: string
  category: IngredientCategory | ''
}

interface Props {
  dayOfWeek: number
  onClose: () => void
  onSave: (input: CustomMealInput) => void
}

export default function CustomMealSheet({ dayOfWeek, onClose, onSave }: Props) {
  const [title, setTitle] = useState('')
  const [servings, setServings] = useState(4)
  const [saveToLibrary, setSaveToLibrary] = useState(false)
  const [rows, setRows] = useState<IngredientRow[]>([
    { qty: '', unit: '', name: '', category: '' },
  ])

  function addRow() {
    setRows((prev) => [...prev, { qty: '', unit: '', name: '', category: '' }])
  }

  function updateRow(index: number, field: keyof IngredientRow, value: string) {
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
      saveToLibrary,
    })
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl max-h-[85vh] flex flex-col">
        {/* Handle + title */}
        <div className="flex flex-col items-center pt-3 pb-2 px-4 flex-shrink-0">
          <div className="w-10 h-1 bg-gray-300 rounded-full mb-3" />
          <div className="flex items-center justify-between w-full">
            <h2 className="font-semibold text-gray-900 text-base">
              Custom meal — {DAYS[dayOfWeek]}
            </h2>
            <button onClick={onClose} className="text-gray-400 text-sm">
              Cancel
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-4 pb-6">
          {/* Meal name */}
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 mt-2">
            Meal name
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Mom's Pasta"
            autoFocus
            className="w-full px-3 py-2.5 bg-gray-100 rounded-xl text-sm focus:outline-none mb-4"
          />

          {/* Servings */}
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Servings
          </label>
          <input
            type="number"
            min={1}
            value={servings}
            onChange={(e) => setServings(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-20 px-3 py-2.5 bg-gray-100 rounded-xl text-sm focus:outline-none mb-4"
          />

          {/* Ingredients */}
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
              <div key={i} className="flex gap-1">
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
                  onChange={(e) =>
                    updateRow(i, 'category', e.target.value as IngredientCategory | '')
                  }
                  className="w-20 px-1 py-2 bg-gray-100 rounded-lg text-xs focus:outline-none"
                >
                  <option value="">—</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <button onClick={addRow} className="text-sm text-green-600 font-medium py-1">
            + Add ingredient
          </button>

          {/* Save to library toggle */}
          <div className="flex items-center justify-between py-4 border-t border-gray-100 mt-4">
            <div>
              <p className="text-sm font-medium text-gray-900">Save to my library</p>
              <p className="text-xs text-gray-400">Reuse this meal in future weeks</p>
            </div>
            <button
              onClick={() => setSaveToLibrary((v) => !v)}
              className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${
                saveToLibrary ? 'bg-green-500' : 'bg-gray-200'
              }`}
              role="switch"
              aria-checked={saveToLibrary}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  saveToLibrary ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="w-full py-3 bg-green-600 text-white font-semibold rounded-xl text-sm disabled:opacity-40 active:bg-green-700"
          >
            Add to {DAYS[dayOfWeek]}
          </button>
        </div>
      </div>
    </>
  )
}
