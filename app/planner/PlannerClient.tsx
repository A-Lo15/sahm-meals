'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  addRecipeToDay,
  removeSlot,
  removeSlotAndRecipe,
  updateSlotServings,
  importAndAddToDay,
  createCustomMeal,
  forkSlotRecipe,
  updateRecipe,
} from './actions'
import type { SlotWithRecipe, RecipeOption, CustomMealInput, RecipeEditInput } from '@/lib/types'
import type { ParsedRecipe } from '@/lib/parseRecipe'
import ImportReviewModal from './ImportReviewModal'
import CustomMealSheet from './CustomMealSheet'
import RecipeScopeSheet from './RecipeScopeSheet'
import RecipeEditSheet from './RecipeEditSheet'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface Props {
  mealPlanId: string
  weekStart: string
  initialSlots: SlotWithRecipe[]
  recipes: RecipeOption[]
}

interface OptimisticSlot extends SlotWithRecipe {
  optimistic?: boolean
}

export default function PlannerClient({
  mealPlanId,
  weekStart,
  initialSlots,
  recipes,
}: Props) {
  const router = useRouter()
  const [slots, setSlots] = useState<OptimisticSlot[]>(initialSlots)
  const [, startTransition] = useTransition()
  const [pickerDay, setPickerDay] = useState<number | null>(null)
  const [customDay, setCustomDay] = useState<number | null>(null)
  const [editSlot, setEditSlot] = useState<OptimisticSlot | null>(null)
  const [editScope, setEditScope] = useState<'week' | 'library' | null>(null)
  const [search, setSearch] = useState('')
  const [pickerTab, setPickerTab] = useState<'library' | 'all'>('library')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const importingRef = useRef(false)
  const [pendingImport, setPendingImport] = useState<{ recipe: ParsedRecipe; day: number } | null>(null)

  // ── Week navigation ──────────────────────────────────────────────────────────

  function navWeek(delta: number) {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + delta * 7)
    router.push(`/planner?week=${d.toISOString().split('T')[0]}`)
  }

  function formatWeekLabel() {
    const start = new Date(weekStart)
    const end = new Date(weekStart)
    end.setDate(end.getDate() + 6)
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
    return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`
  }

  // ── Slot mutations ───────────────────────────────────────────────────────────

  function handleAdd(recipe: RecipeOption) {
    if (pickerDay === null) return
    const tempId = `temp-${Date.now()}`
    const optimisticSlot: OptimisticSlot = {
      id: tempId,
      meal_plan_id: mealPlanId,
      recipe_id: recipe.id,
      day_of_week: pickerDay,
      servings_override: null,
      position: slots.filter((s) => s.day_of_week === pickerDay).length,
      recipe: {
        id: recipe.id,
        title: recipe.title,
        default_servings: recipe.default_servings,
        source_image_url: recipe.source_image_url,
        state: recipe.state,
        in_library: true,
        ingredients: [],
        instructions: null,
      },
      optimistic: true,
    }
    setSlots((prev) => [...prev, optimisticSlot])
    setPickerDay(null)
    setSearch('')

    startTransition(async () => {
      try {
        const { id } = await addRecipeToDay(mealPlanId, recipe.id, pickerDay!)
        setSlots((prev) =>
          prev.map((s) => (s.id === tempId ? { ...s, id, optimistic: false } : s))
        )
      } catch {
        setSlots((prev) => prev.filter((s) => s.id !== tempId))
      }
    })
  }

  function handleRemove(slot: OptimisticSlot) {
    if (slot.optimistic) return
    setSlots((prev) => prev.filter((s) => s.id !== slot.id))
    if (!slot.recipe.in_library && slot.recipe_id) {
      startTransition(() => removeSlotAndRecipe(slot.id, slot.recipe_id))
    } else {
      startTransition(() => removeSlot(slot.id))
    }
  }

  function handleCustomMeal(dayOfWeek: number, input: CustomMealInput) {
    const tempId = `temp-${Date.now()}`
    const optimisticSlot: OptimisticSlot = {
      id: tempId,
      meal_plan_id: mealPlanId,
      recipe_id: '',
      day_of_week: dayOfWeek,
      servings_override: null,
      position: slots.filter((s) => s.day_of_week === dayOfWeek).length,
      recipe: {
        id: '',
        title: input.title,
        default_servings: input.servings,
        source_image_url: null,
        state: 'saved',
        in_library: input.saveToLibrary,
        ingredients: input.ingredients,
        instructions: null,
      },
      optimistic: true,
    }
    setSlots((prev) => [...prev, optimisticSlot])
    setCustomDay(null)

    startTransition(async () => {
      try {
        const slot = await createCustomMeal(mealPlanId, dayOfWeek, input)
        setSlots((prev) =>
          prev.map((s) =>
            s.id === tempId
              ? {
                  ...s,
                  id: slot.id,
                  recipe_id: slot.recipe_id,
                  recipe: { ...slot.recipe },
                  optimistic: false,
                }
              : s
          )
        )
      } catch {
        setSlots((prev) => prev.filter((s) => s.id !== tempId))
      }
    })
  }

  function handleServingsChange(slotId: string, value: number) {
    setSlots((prev) =>
      prev.map((s) => (s.id === slotId ? { ...s, servings_override: value } : s))
    )
    // Call directly — not inside startTransition, which React can cancel on navigation
    void updateSlotServings(slotId, value)
  }

  function handleEditSave(input: RecipeEditInput) {
    if (!editSlot) return
    const scope = editScope ?? 'week'
    const slot = editSlot
    setEditSlot(null)
    setEditScope(null)

    if (scope === 'week') {
      setSlots((prev) =>
        prev.map((s) =>
          s.id === slot.id
            ? { ...s, recipe: { ...s.recipe, title: input.title, default_servings: input.servings, ingredients: input.ingredients, instructions: input.instructions, in_library: false }, optimistic: true }
            : s
        )
      )
      startTransition(async () => {
        try {
          const updated = await forkSlotRecipe(slot.id, slot.recipe_id, input)
          setSlots((prev) =>
            prev.map((s) => (s.id === slot.id ? { ...updated, optimistic: false } : s))
          )
        } catch {
          setSlots((prev) =>
            prev.map((s) => (s.id === slot.id ? { ...s, recipe: { ...slot.recipe }, optimistic: false } : s))
          )
        }
      })
    } else {
      setSlots((prev) =>
        prev.map((s) =>
          s.id === slot.id
            ? { ...s, recipe: { ...s.recipe, title: input.title, default_servings: input.servings, ingredients: input.ingredients, instructions: input.instructions } }
            : s
        )
      )
      startTransition(async () => {
        try {
          await updateRecipe(slot.recipe_id, input)
        } catch {
          setSlots((prev) =>
            prev.map((s) => (s.id === slot.id ? { ...s, recipe: { ...slot.recipe } } : s))
          )
        }
      })
    }
  }

  async function handleImport() {
    if (pickerDay === null || importingRef.current) return
    importingRef.current = true
    setImporting(true)
    setImportError(null)

    let recipe: ParsedRecipe
    try {
      const res = await fetch('/api/parse-recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: search.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setImportError(data.error ?? 'Failed to import recipe.')
        setImporting(false)
        importingRef.current = false
        return
      }
      const parsed = (data as { recipe?: ParsedRecipe }).recipe
      if (!parsed?.title) {
        setImportError('Failed to import recipe.')
        setImporting(false)
        importingRef.current = false
        return
      }
      recipe = parsed
    } catch {
      setImportError('Network error — check your connection and try again.')
      setImporting(false)
      importingRef.current = false
      return
    }

    // Parse succeeded — show review modal
    const savedPickerDay = pickerDay
    setPickerDay(null)
    setSearch('')
    setImporting(false)
    importingRef.current = false
    setPendingImport({ recipe, day: savedPickerDay })
  }

  function handleConfirmImport(editedRecipe: ParsedRecipe) {
    if (!pendingImport) return
    const { day } = pendingImport
    const tempId = `temp-${Date.now()}`

    const optimisticSlot: OptimisticSlot = {
      id: tempId,
      meal_plan_id: mealPlanId,
      recipe_id: '',
      day_of_week: day,
      servings_override: null,
      position: slots.filter((s) => s.day_of_week === day).length,
      recipe: {
        id: '',
        title: editedRecipe.title,
        default_servings: editedRecipe.default_servings,
        source_image_url: editedRecipe.source_image_url,
        state: 'tried',
        in_library: true,
        ingredients: editedRecipe.ingredients ?? [],
        instructions: editedRecipe.instructions ?? null,
      },
      optimistic: true,
    }

    setSlots((prev) => [...prev, optimisticSlot])
    setPendingImport(null)

    startTransition(async () => {
      try {
        const { recipeId, slotId } = await importAndAddToDay(editedRecipe, mealPlanId, day)
        setSlots((prev) =>
          prev.map((s) =>
            s.id === tempId
              ? {
                  ...s,
                  id: slotId,
                  recipe_id: recipeId,
                  recipe: { ...s.recipe, id: recipeId },
                  optimistic: false,
                }
              : s
          )
        )
      } catch {
        setSlots((prev) => prev.filter((s) => s.id !== tempId))
        setPendingImport({ recipe: editedRecipe, day })
      }
    })
  }

  function handleDismissImport() {
    setPendingImport(null)
  }

  // ── Picker filtering ─────────────────────────────────────────────────────────

  const importMode = search.startsWith('http://') || search.startsWith('https://')

  const filteredRecipes = recipes.filter((r) => {
    const matchesTab =
      pickerTab === 'all' || r.state === 'saved' || r.state === 'favorited'
    const matchesSearch = r.title.toLowerCase().includes(search.toLowerCase())
    return matchesTab && matchesSearch
  })

  // ── Render ───────────────────────────────────────────────────────────────────

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-1">
            <Link href="/" className="text-sm text-gray-500 py-1 pr-3">
              Home
            </Link>
            <div className="flex items-center gap-1">
              <button
                onClick={() => navWeek(-1)}
                className="w-9 h-9 flex items-center justify-center text-gray-500 text-xl"
              >
                ‹
              </button>
              <h1 className="font-bold text-gray-900 text-base">{formatWeekLabel()}</h1>
              <button
                onClick={() => navWeek(1)}
                className="w-9 h-9 flex items-center justify-center text-gray-500 text-xl"
              >
                ›
              </button>
            </div>
            <div className="w-12" />
          </div>
          <div className="text-center">
            <Link
              href={`/shopping?week=${weekStart}`}
              className="text-xs text-green-600 font-medium"
            >
              View shopping list →
            </Link>
          </div>
        </div>
      </header>

      {/* Day cards */}
      <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {DAYS.map((dayName, i) => {
          const dayDate = new Date(weekStart)
          dayDate.setDate(dayDate.getDate() + i)
          dayDate.setHours(0, 0, 0, 0)
          const isToday = dayDate.getTime() === today.getTime()
          const daySlots = slots.filter((s) => s.day_of_week === i)

          return (
            <div
              key={i}
              className="bg-white rounded-2xl border border-gray-200 overflow-hidden"
            >
              {/* Day header */}
              <div
                className={`flex items-center justify-between px-4 py-2.5 ${
                  isToday ? 'bg-green-50' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-semibold ${
                      isToday ? 'text-green-700' : 'text-gray-700'
                    }`}
                  >
                    {dayName}
                  </span>
                  <span className="text-xs text-gray-400">
                    {dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPickerDay(i)}
                    className="px-2 py-1 rounded-lg bg-gray-100 text-gray-500 text-xs font-medium"
                    aria-label={`Add recipe to ${dayName} from library`}
                  >
                    + Library
                  </button>
                  <button
                    onClick={() => setCustomDay(i)}
                    className="px-2 py-1 rounded-lg bg-gray-100 text-gray-500 text-xs font-medium"
                    aria-label={`Add custom meal to ${dayName}`}
                  >
                    + Custom
                  </button>
                </div>
              </div>

              {/* Slots */}
              {daySlots.length > 0 && (
                <div className="divide-y divide-gray-100">
                  {daySlots.map((slot) => {
                    const servings = slot.servings_override ?? slot.recipe.default_servings
                    return (
                      <div
                        key={slot.id}
                        className={`flex items-center gap-3 px-4 py-3 ${
                          slot.optimistic ? 'opacity-60' : ''
                        }`}
                      >
                        {slot.recipe.source_image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={slot.recipe.source_image_url}
                            alt=""
                            className="w-11 h-11 rounded-lg object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-11 h-11 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 text-lg">
                            {slot.recipe.in_library ? '🍽' : '✏️'}
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          <button
                            onClick={() => { if (!slot.optimistic) setEditSlot(slot) }}
                            disabled={!!slot.optimistic}
                            className="text-sm font-medium text-gray-900 truncate text-left w-full underline decoration-dotted decoration-gray-300 underline-offset-2 disabled:no-underline"
                          >
                            {slot.recipe.title}
                          </button>
                          <div className="flex items-center gap-1 mt-0.5">
                            <button
                              onClick={() =>
                                handleServingsChange(slot.id, Math.max(1, servings - 1))
                              }
                              className="w-5 h-5 flex items-center justify-center text-gray-400 text-base leading-none"
                            >
                              −
                            </button>
                            <span className="text-xs text-gray-500 w-16 text-center">
                              {servings} serving{servings !== 1 ? 's' : ''}
                            </span>
                            <button
                              onClick={() => handleServingsChange(slot.id, servings + 1)}
                              className="w-5 h-5 flex items-center justify-center text-gray-400 text-base leading-none"
                            >
                              +
                            </button>
                          </div>
                        </div>

                        <button
                          onClick={() => handleRemove(slot)}
                          className="w-8 h-8 flex items-center justify-center text-gray-300 text-base flex-shrink-0"
                          aria-label="Remove"
                        >
                          ✕
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {daySlots.length === 0 && (
                <div className="px-4 pb-3">
                  <p className="text-xs text-gray-400">No meals planned</p>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {pendingImport !== null && (
        <ImportReviewModal
          recipe={pendingImport.recipe}
          day={pendingImport.day}
          onConfirm={handleConfirmImport}
          onDismiss={handleDismissImport}
        />
      )}
      {customDay !== null && (
        <CustomMealSheet
          dayOfWeek={customDay}
          onClose={() => setCustomDay(null)}
          onSave={(input) => handleCustomMeal(customDay, input)}
        />
      )}
      {editSlot && !editScope && editSlot.recipe.in_library && (
        <RecipeScopeSheet
          recipeName={editSlot.recipe.title}
          onSelectScope={setEditScope}
          onClose={() => setEditSlot(null)}
        />
      )}
      {editSlot && (editScope !== null || !editSlot.recipe.in_library) && (
        <RecipeEditSheet
          scope={editScope ?? 'week'}
          initialValues={{
            title: editSlot.recipe.title,
            servings: editSlot.recipe.default_servings,
            ingredients: editSlot.recipe.ingredients,
            instructions: editSlot.recipe.instructions,
          }}
          dayOfWeek={editSlot.day_of_week}
          onSave={handleEditSave}
          onClose={() => { setEditSlot(null); setEditScope(null) }}
        />
      )}

      {/* Recipe picker bottom sheet */}
      {pickerDay !== null && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => { setPickerDay(null); setSearch(''); setImportError(null); setImporting(false); importingRef.current = false }}
          />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl max-h-[75vh] flex flex-col">
            {/* Sheet handle + title */}
            <div className="flex flex-col items-center pt-3 pb-2 px-4">
              <div className="w-10 h-1 bg-gray-300 rounded-full mb-3" />
              <div className="flex items-center justify-between w-full">
                <h2 className="font-semibold text-gray-900 text-base">
                  Add to {DAYS[pickerDay]}
                </h2>
                <button
                  onClick={() => { setPickerDay(null); setSearch(''); setImportError(null); setImporting(false); importingRef.current = false }}
                  className="text-gray-400 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="px-4 pb-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search recipes or paste recipe URL…"
                autoFocus
                className="w-full px-4 py-2.5 bg-gray-100 rounded-xl text-base focus:outline-none"
              />
            </div>

            {/* Tabs */}
            <div className="flex gap-0 px-4 pb-2">
              {(['library', 'all'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setPickerTab(tab)}
                  className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    pickerTab === tab
                      ? 'bg-green-100 text-green-700'
                      : 'text-gray-500'
                  }`}
                >
                  {tab === 'library' ? 'Library' : 'All Recipes'}
                </button>
              ))}
            </div>

            {/* Recipe list / import */}
            <div className="overflow-y-auto flex-1 px-4 pb-6">
              {importMode ? (
                <div className="space-y-3 pt-2">
                  {importError && (
                    <p className="text-sm text-red-500">{importError}</p>
                  )}
                  <button
                    onClick={handleImport}
                    disabled={importing}
                    className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl text-sm disabled:opacity-50 active:bg-blue-700"
                  >
                    {importing ? 'Importing…' : 'Import Recipe'}
                  </button>
                </div>
              ) : filteredRecipes.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">No recipes found</p>
              ) : (
                <div className="space-y-1">
                  {filteredRecipes.map((recipe) => (
                    <button
                      key={recipe.id}
                      onClick={() => handleAdd(recipe)}
                      className="w-full flex items-center gap-3 py-3 px-3 rounded-xl active:bg-gray-50 text-left"
                    >
                      {recipe.source_image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={recipe.source_image_url}
                          alt=""
                          className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                          🍽
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {recipe.title}
                        </p>
                        <p className="text-xs text-gray-400">
                          {recipe.default_servings} servings
                          {recipe.state === 'favorited' ? ' · ★' : ''}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
