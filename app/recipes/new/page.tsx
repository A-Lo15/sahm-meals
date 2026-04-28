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

interface FormState {
  title: string
  description: string
  default_servings: string
  source_url: string
  source_image_url: string
  instructions: string
}

export default function NewRecipePage() {
  const router = useRouter()

  // ── form state (controlled so URL import can pre-fill) ──
  const [form, setForm] = useState<FormState>({
    title: '',
    description: '',
    default_servings: '4',
    source_url: '',
    source_image_url: '',
    instructions: '',
  })
  const [ingredients, setIngredients] = useState<Ingredient[]>([{ ...BLANK }])
  const [isImport, setIsImport] = useState(false)
  const [originalParsedJson, setOriginalParsedJson] = useState<string | null>(null)

  // ── URL import state ──
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importSource, setImportSource] = useState<'json-ld' | 'claude' | null>(null)

  // ── save state ──
  const [isPending, startTransition] = useTransition()
  const [saveError, setSaveError] = useState<string | null>(null)

  function setField(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  // ── ingredient helpers ──
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

  // ── URL import ──
  async function handleImport() {
    if (!importUrl.trim()) return
    setImporting(true)
    setImportError(null)
    setImportSource(null)

    try {
      const res = await fetch('/api/parse-recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importUrl.trim() }),
      })
      const data = await res.json()

      if (!res.ok) {
        setImportError(data.error ?? 'Failed to import recipe.')
        return
      }

      const { recipe, source } = data
      setForm({
        title: recipe.title ?? '',
        description: recipe.description ?? '',
        default_servings: String(recipe.default_servings ?? 4),
        source_url: recipe.source_url ?? importUrl,
        source_image_url: recipe.source_image_url ?? '',
        instructions: recipe.instructions ?? '',
      })
      setIngredients(
        recipe.ingredients?.length > 0 ? recipe.ingredients : [{ ...BLANK }]
      )
      setIsImport(true)
      setImportSource(source)
      setOriginalParsedJson(JSON.stringify(recipe))
    } catch {
      setImportError('Network error — check your connection and try again.')
    } finally {
      setImporting(false)
    }
  }

  // ── form submit ──
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaveError(null)

    const filled = ingredients.filter((ing) => ing.name.trim())
    if (filled.length === 0) {
      setSaveError('Add at least one ingredient.')
      return
    }

    const fd = new FormData()
    fd.set('title', form.title)
    fd.set('description', form.description)
    fd.set('default_servings', form.default_servings)
    fd.set('source_url', form.source_url)
    fd.set('source_image_url', form.source_image_url)
    fd.set('instructions', form.instructions)
    fd.set('ingredients', JSON.stringify(filled))
    fd.set('is_import', isImport ? 'true' : 'false')
    if (originalParsedJson) fd.set('original_parsed_json', originalParsedJson)

    startTransition(async () => {
      try {
        const { id } = await createRecipe(fd)
        router.push(`/recipes/${id}`)
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Something went wrong.')
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
          <h1 className="font-bold text-gray-900">
            {isImport ? 'Review Import' : 'New Recipe'}
          </h1>
          <button
            onClick={handleSubmit as unknown as React.MouseEventHandler}
            disabled={isPending || !form.title.trim()}
            className="text-green-600 font-semibold py-1 pl-3 disabled:opacity-40"
          >
            {isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="max-w-lg mx-auto px-4 py-5 space-y-6 pb-16">
        {saveError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            {saveError}
          </div>
        )}

        {/* URL Import */}
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 space-y-2">
          <p className="text-sm font-semibold text-blue-800">Import from URL</p>
          <div className="flex gap-2">
            <input
              type="url"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleImport())}
              placeholder="Paste recipe URL…"
              className="flex-1 px-3 py-2.5 border border-blue-200 rounded-xl text-base bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              type="button"
              onClick={handleImport}
              disabled={importing || !importUrl.trim()}
              className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-50 active:bg-blue-700 whitespace-nowrap"
            >
              {importing ? 'Importing…' : 'Import'}
            </button>
          </div>
          {importError && (
            <p className="text-sm text-red-600">{importError}</p>
          )}
          {importSource && (
            <p className="text-xs text-blue-600">
              {importSource === 'json-ld'
                ? '✓ Parsed from structured recipe data'
                : '✓ Parsed via AI — review carefully'}
            </p>
          )}
        </div>

        {/* Basic info */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
              required
              placeholder="e.g. Chicken Tikka Masala"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description{' '}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              rows={2}
              placeholder="Quick summary or notes"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Servings
            </label>
            <input
              type="number"
              value={form.default_servings}
              onChange={(e) => setField('default_servings', e.target.value)}
              min="1"
              max="99"
              className="w-24 px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Source URL{' '}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="url"
              value={form.source_url}
              onChange={(e) => setField('source_url', e.target.value)}
              placeholder="https://…"
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
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
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
                    aria-label="Remove"
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
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Instructions{' '}
            <span className="text-gray-400 font-normal">(one step per line)</span>
          </label>
          <textarea
            value={form.instructions}
            onChange={(e) => setField('instructions', e.target.value)}
            rows={7}
            placeholder={'Preheat oven to 375°F\nMix dry ingredients…'}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
          />
        </div>

        <button
          type="submit"
          disabled={isPending || !form.title.trim()}
          className="w-full py-4 bg-green-600 text-white font-semibold rounded-xl text-base disabled:opacity-50 active:bg-green-700"
        >
          {isPending ? 'Saving…' : isImport ? 'Save Recipe' : 'Save Recipe'}
        </button>
      </form>
    </div>
  )
}
