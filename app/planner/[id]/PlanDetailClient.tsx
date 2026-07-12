'use client'

import { useState, useTransition, useRef } from 'react'
import Link from 'next/link'
import {
  addRecipeToDate,
  removeSlot,
  removeSlotAndRecipe,
  updateSlotServings,
  importAndAddToDate,
  createCustomMeal,
  forkSlotRecipe,
  updateRecipe,
} from '../actions'
import type { SlotWithRecipe, RecipeOption, CustomMealInput, RecipeEditInput } from '@/lib/types'
import type { ParsedRecipe } from '@/lib/parseRecipe'
import ImportReviewModal from '../ImportReviewModal'
import CustomMealSheet from '../CustomMealSheet'
import RecipeScopeSheet from '../RecipeScopeSheet'
import RecipeEditSheet from '../RecipeEditSheet'

interface Props {
  mealPlanId: string
  startDate: string
  endDate: string
  initialSlots: SlotWithRecipe[]
  recipes: RecipeOption[]
}

interface OptimisticSlot extends SlotWithRecipe {
  optimistic?: boolean
}

function getPlanDates(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  const current = new Date(startDate + 'T12:00:00')
  const end = new Date(endDate + 'T12:00:00')
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0])
    current.setDate(current.getDate() + 1)
  }
  return dates
}

function formatDayHeader(dateStr: string): { dayName: string; monthDay: string } {
  const d = new Date(dateStr + 'T12:00:00')
  return {
    dayName: d.toLocaleDateString('en-US', { weekday: 'short' }),
    monthDay: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }
}

function formatPlanRange(startDate: string, endDate: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  const start = new Date(startDate + 'T12:00:00')
  const end = new Date(endDate + 'T12:00:00')
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`
}

export default function PlanDetailClient({
  mealPlanId,
  startDate,
  endDate,
  initialSlots,
  recipes,
}: Props) {
  const [slots, setSlots] = useState<OptimisticSlot[]>(initialSlots)
  const [, startTransition] = useTransition()
  const [pickerDate, setPickerDate] = useState<string | null>(null)
  const [customDate, setCustomDate] = useState<string | null>(null)
  const [editSlot, setEditSlot] = useState<OptimisticSlot | null>(null)
  const [editScope, setEditScope] = useState<'week' | 'library' | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [pickerTab, setPickerTab] = useState<'library' | 'all'>('library')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const importingRef = useRef(false)
  const [pendingImport, setPendingImport] = useState<{ recipe: ParsedRecipe; planDate: string } | null>(null)

  const planDates = getPlanDates(startDate, endDate)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  function handleAdd(recipe: RecipeOption) {
    if (!pickerDate) return
    const date = pickerDate
    const tempId = `temp-${Date.now()}`
    const optimisticSlot: OptimisticSlot = {
      id: tempId,
      meal_plan_id: mealPlanId,
      recipe_id: recipe.id,
      plan_date: date,
      servings_override: null,
      position: slots.filter((s) => s.plan_date === date).length,
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
    setPickerDate(null)
    setSearch('')

    startTransition(async () => {
      try {
        const { id } = await addRecipeToDate(mealPlanId, recipe.id, date)
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

  function handleCustomMeal(planDate: string, input: CustomMealInput) {
    const tempId = `temp-${Date.now()}`
    const optimisticSlot: OptimisticSlot = {
      id: tempId,
      meal_plan_id: mealPlanId,
      recipe_id: '',
      plan_date: planDate,
      servings_override: null,
      position: slots.filter((s) => s.plan_date === planDate).length,
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
    setCustomDate(null)

    startTransition(async () => {
      try {
        const slot = await createCustomMeal(mealPlanId, planDate, input)
        setSlots((prev) =>
          prev.map((s) =>
            s.id === tempId
              ? { ...s, id: slot.id, recipe_id: slot.recipe_id, recipe: { ...slot.recipe }, optimistic: false }
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
            ? {
                ...s,
                recipe: {
                  ...s.recipe,
                  title: input.title,
                  default_servings: input.servings,
                  ingredients: input.ingredients,
                  instructions: input.instructions,
                  in_library: false,
                },
                optimistic: true,
              }
            : s
        )
      )
      startTransition(async () => {
        try {
          if (slot.recipe.in_library) {
            const updated = await forkSlotRecipe(slot.id, slot.recipe_id, input)
            setSlots((prev) =>
              prev.map((s) => (s.id === slot.id ? { ...updated, optimistic: false } : s))
            )
          } else {
            await updateRecipe(slot.recipe_id, input)
            setSlots((prev) =>
              prev.map((s) => (s.id === slot.id ? { ...s, optimistic: false } : s))
            )
          }
        } catch {
          setSlots((prev) =>
            prev.map((s) =>
              s.id === slot.id ? { ...s, recipe: { ...slot.recipe }, optimistic: false } : s
            )
          )
          setSaveError('Failed to save changes. Please try again.')
        }
      })
    } else {
      setSlots((prev) =>
        prev.map((s) =>
          s.id === slot.id
            ? {
                ...s,
                recipe: {
                  ...s.recipe,
                  title: input.title,
                  default_servings: input.servings,
                  ingredients: input.ingredients,
                  instructions: input.instructions,
                },
                optimistic: true,
              }
            : s
        )
      )
      startTransition(async () => {
        try {
          await updateRecipe(slot.recipe_id, input)
          setSlots((prev) =>
            prev.map((s) => (s.id === slot.id ? { ...s, optimistic: false } : s))
          )
        } catch {
          setSlots((prev) =>
            prev.map((s) =>
              s.id === slot.id ? { ...s, recipe: { ...slot.recipe }, optimistic: false } : s
            )
          )
          setSaveError('Failed to save changes. Please try again.')
        }
      })
    }
  }

  async function handleImport() {
    if (!pickerDate || importingRef.current) return
    importingRef.current = true
    setImporting(true)
    setImportError(null)

    let recipe: ParsedRecipe
    const savedPickerDate = pickerDate

    try {
      const res = await fetch('/api/parse-recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: search.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setImportError((data as { error?: string }).error ?? 'Failed to import recipe.')
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

    setPickerDate(null)
    setSearch('')
    setImporting(false)
    importingRef.current = false
    setPendingImport({ recipe, planDate: savedPickerDate })
  }

  function handleConfirmImport(editedRecipe: ParsedRecipe) {
    if (!pendingImport) return
    const { planDate } = pendingImport
    const tempId = `temp-${Date.now()}`

    const optimisticSlot: OptimisticSlot = {
      id: tempId,
      meal_plan_id: mealPlanId,
      recipe_id: '',
      plan_date: planDate,
      servings_override: null,
      position: slots.filter((s) => s.plan_date === planDate).length,
      recipe: {
        id: '',
        title: editedRecipe.title,
        default_servings: editedRecipe.default_servings,
        source_image_url: editedRecipe.source_image_url ?? null,
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
        const { recipeId, slotId } = await importAndAddToDate(editedRecipe, mealPlanId, planDate)
        setSlots((prev) =>
          prev.map((s) =>
            s.id === tempId
              ? { ...s, id: slotId, recipe_id: recipeId, recipe: { ...s.recipe, id: recipeId }, optimistic: false }
              : s
          )
        )
      } catch {
        setSlots((prev) => prev.filter((s) => s.id !== tempId))
        setPendingImport({ recipe: editedRecipe, planDate })
      }
    })
  }

  function handleDismissImport() {
    setPendingImport(null)
  }

  function closePickerSheet() {
    setPickerDate(null)
    setSearch('')
    setImportError(null)
    setImporting(false)
    importingRef.current = false
  }

  const importMode = search.startsWith('http://') || search.startsWith('https://')

  const filteredRecipes = recipes.filter((r) => {
    const matchesTab = pickerTab === 'all' || r.state === 'saved' || r.state === 'favorited'
    const matchesSearch = r.title.toLowerCase().includes(search.toLowerCase())
    return matchesTab && matchesSearch
  })

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-1">
            <Link href="/planner" className="text-sm text-gray-500 py-1 pr-3">
              ← Plans
            </Link>
            <h1 className="font-bold text-gray-900 text-base">
              {formatPlanRange(startDate, endDate)}
            </h1>
            <div className="w-14" />
          </div>
          <div className="text-center">
            <Link
              href={`/shopping?plan=${mealPlanId}`}
              className="text-xs text-green-600 font-medium"
            >
              View shopping list →
            </Link>
          </div>
        </div>
      </header>

      {/* Day cards */}
      <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {planDates.map((dateStr) => {
          const { dayName, monthDay } = formatDayHeader(dateStr)
          const dayDate = new Date(dateStr + 'T12:00:00')
          dayDate.setHours(0, 0, 0, 0)
          const isToday = dayDate.getTime() === today.getTime()
          const daySlots = slots.filter((s) => s.plan_date === dateStr)

          return (
            <div
              key={dateStr}
              className="bg-white rounded-2xl border border-gray-200 overflow-hidden"
            >
              <div
                className={`flex items-center justify-between px-4 py-2.5 ${isToday ? 'bg-green-50' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold ${isToday ? 'text-green-700' : 'text-gray-700'}`}>
                    {dayName}
                  </span>
                  <span className="text-xs text-gray-400">{monthDay}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPickerDate(dateStr)}
                    className="px-2 py-1 rounded-lg bg-gray-100 text-gray-500 text-xs font-medium"
                  >
                    + Library
                  </button>
                  <button
                    onClick={() => setCustomDate(dateStr)}
                    className="px-2 py-1 rounded-lg bg-gray-100 text-gray-500 text-xs font-medium"
                  >
                    + Custom
                  </button>
                </div>
              </div>

              {daySlots.length > 0 ? (
                <div className="divide-y divide-gray-100">
                  {daySlots.map((slot) => {
                    const servings = slot.servings_override ?? slot.recipe.default_servings
                    return (
                      <div
                        key={slot.id}
                        className={`flex items-center gap-3 px-4 py-3 ${slot.optimistic ? 'opacity-60' : ''}`}
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
                              onClick={() => handleServingsChange(slot.id, Math.max(1, servings - 1))}
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
                        >
                          ✕
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="px-4 pb-3">
                  <p className="text-xs text-gray-400">No meals planned</p>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Error toast */}
      {saveError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2.5 rounded-xl shadow-md flex items-center gap-3 max-w-sm w-full mx-4">
          <span className="flex-1">{saveError}</span>
          <button onClick={() => setSaveError(null)} className="text-red-400 text-base leading-none flex-shrink-0">✕</button>
        </div>
      )}

      {/* Modals */}
      {pendingImport !== null && (
        <ImportReviewModal
          recipe={pendingImport.recipe}
          // @ts-expect-error Task 6 will rename this prop from `day` to `planDate`
          planDate={pendingImport.planDate}
          onConfirm={handleConfirmImport}
          onDismiss={handleDismissImport}
        />
      )}
      {customDate !== null && (
        <CustomMealSheet
          // @ts-expect-error Task 6 will rename this prop from `dayOfWeek` to `planDate`
          planDate={customDate}
          onClose={() => setCustomDate(null)}
          onSave={(input) => handleCustomMeal(customDate, input)}
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
          onSave={handleEditSave}
          onClose={() => { setEditSlot(null); setEditScope(null) }}
        />
      )}

      {/* Recipe picker bottom sheet */}
      {pickerDate !== null && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={closePickerSheet} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl max-h-[75vh] flex flex-col">
            <div className="flex flex-col items-center pt-3 pb-2 px-4 flex-shrink-0">
              <div className="w-10 h-1 bg-gray-300 rounded-full mb-3" />
              <div className="flex items-center justify-between w-full">
                {(() => {
                  const { dayName, monthDay } = formatDayHeader(pickerDate)
                  return (
                    <h2 className="font-semibold text-gray-900 text-base">
                      Add to {dayName} {monthDay}
                    </h2>
                  )
                })()}
                <button onClick={closePickerSheet} className="text-gray-400 text-sm">Cancel</button>
              </div>
            </div>

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

            <div className="flex gap-0 px-4 pb-2">
              {(['library', 'all'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setPickerTab(tab)}
                  className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    pickerTab === tab ? 'bg-green-100 text-green-700' : 'text-gray-500'
                  }`}
                >
                  {tab === 'library' ? 'Library' : 'All Recipes'}
                </button>
              ))}
            </div>

            <div className="overflow-y-auto flex-1 px-4 pb-6">
              {importMode ? (
                <div className="space-y-3 pt-2">
                  {importError && <p className="text-sm text-red-500">{importError}</p>}
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
                        <img src={recipe.source_image_url} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">🍽</div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{recipe.title}</p>
                        <p className="text-xs text-gray-400">
                          {recipe.default_servings} servings{recipe.state === 'favorited' ? ' · ★' : ''}
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
