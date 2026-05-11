'use client'

import { useState, useTransition, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { generateShoppingList, saveCheckedState } from './actions'
import { STORES, type StoreAssignments, type StoreName, type ShoppingItem } from '@/lib/shopping'

const CATEGORY_LABELS: Record<string, string> = {
  produce: 'Produce',
  meat: 'Meat & Seafood',
  dairy: 'Dairy & Eggs',
  pantry: 'Pantry',
  frozen: 'Frozen',
  household: 'Household',
  other: 'Other',
  '': 'Other',
}

const REMOVE_BTN_WIDTH = 64 // px — width of the trailing Remove button

interface Props {
  weekStart: string
  initialListId: string | null
  initialAssignments: StoreAssignments | null
  initialGeneratedAt: string | null
  hasMeals: boolean
}

export default function ShoppingClient({
  weekStart,
  initialListId,
  initialAssignments,
  initialGeneratedAt,
  hasMeals,
}: Props) {
  const router = useRouter()
  const [listId, setListId] = useState(initialListId)
  const [assignments, setAssignments] = useState<StoreAssignments | null>(initialAssignments)
  const [generatedAt, setGeneratedAt] = useState(initialGeneratedAt)
  const [activeStore, setActiveStore] = useState<StoreName>('Whole Foods')
  const [isPending, startTransition] = useTransition()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Swipe-to-remove state
  const [swipeOpenKey, setSwipeOpenKey] = useState<string | null>(null)
  const [pendingUndo, setPendingUndo] = useState<{
    item: ShoppingItem
    store: StoreName
    index: number
  } | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Touch gesture refs — mutated imperatively to avoid re-renders during drag
  const touchStartX = useRef<number>(0)
  const isDragging = useRef<boolean>(false)
  const dragKey = useRef<string | null>(null)
  const dragRowRef = useRef<HTMLDivElement | null>(null)

  // Cleanup on unmount — prevents writing to detached DOM nodes after navigation
  useEffect(() => {
    return () => {
      isDragging.current = false
      dragKey.current = null
      dragRowRef.current = null
      if (undoTimer.current) clearTimeout(undoTimer.current)
    }
  }, [])

  function formatWeekLabel() {
    const start = new Date(weekStart)
    const end = new Date(weekStart)
    end.setDate(end.getDate() + 6)
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
    return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`
  }

  function handleGenerate() {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setPendingUndo(null)
    setSwipeOpenKey(null)
    startTransition(async () => {
      const result = await generateShoppingList(weekStart)
      if (result) {
        setListId(result.id)
        setAssignments(result.storeAssignments)
        setGeneratedAt(result.generatedAt)
      }
    })
  }

  const scheduleSave = useCallback(
    (id: string, updated: StoreAssignments) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        startTransition(() => saveCheckedState(id, updated))
      }, 600)
    },
    []
  )

  function toggleItem(store: StoreName, index: number) {
    if (!assignments || !listId) return
    const updated: StoreAssignments = {
      ...assignments,
      [store]: assignments[store].map((item, i) =>
        i === index ? { ...item, checked: !item.checked } : item
      ),
    }
    setAssignments(updated)
    scheduleSave(listId, updated)
  }

  function removeItem(store: StoreName, index: number) {
    if (!assignments || !listId) return

    const item = assignments[store][index]

    // Commit any prior pending removal immediately before starting a new one.
    // `assignments` at this point already reflects the prior removal (setAssignments
    // was called synchronously for it).
    if (pendingUndo && undoTimer.current) {
      clearTimeout(undoTimer.current)
      scheduleSave(listId, assignments)
    }

    const updated: StoreAssignments = {
      ...assignments,
      [store]: assignments[store].filter((_, i) => i !== index),
    }
    setAssignments(updated)
    setSwipeOpenKey(null)
    setPendingUndo({ item, store, index })

    undoTimer.current = setTimeout(() => {
      scheduleSave(listId, updated)
      setPendingUndo(null)
    }, 4000)
  }

  function undoRemove() {
    if (!pendingUndo || !assignments) return
    if (undoTimer.current) clearTimeout(undoTimer.current)

    const { item, store, index } = pendingUndo
    const restored = [...assignments[store]]
    restored.splice(index, 0, item)
    setAssignments({ ...assignments, [store]: restored })
    setPendingUndo(null)
  }

  // Group items by category for display
  function groupByCategory(items: ShoppingItem[]) {
    const groups = new Map<string, ShoppingItem[]>()
    for (const item of items) {
      const cat = item.category || 'other'
      if (!groups.has(cat)) groups.set(cat, [])
      groups.get(cat)!.push(item)
    }
    return groups
  }

  const uncheckedCount = (store: StoreName) =>
    assignments?.[store].filter((i) => !i.checked).length ?? 0

  const totalCount = (store: StoreName) => assignments?.[store].length ?? 0

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between">
            <button
              onClick={() => { router.refresh(); router.push(`/planner?week=${weekStart}`) }}
              className="text-sm text-gray-500 py-1 pr-3"
            >
              ← Week
            </button>
            <div className="text-center">
              <h1 className="font-bold text-gray-900 text-base">Shopping List</h1>
              <p className="text-xs text-gray-400">{formatWeekLabel()}</p>
            </div>
            <button
              onClick={handleGenerate}
              disabled={isPending || !hasMeals}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-xl disabled:opacity-40 active:bg-green-700"
            >
              {isPending ? 'Building…' : assignments ? 'Regenerate' : 'Build List'}
            </button>
          </div>
          {generatedAt && (
            <p className="text-xs text-gray-400 mt-1">
              Generated {new Date(generatedAt).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
              })}
            </p>
          )}
        </div>
      </header>

      {/* No meals state */}
      {!hasMeals && (
        <div className="max-w-lg mx-auto px-4 py-16 text-center">
          <p className="text-4xl mb-4">🗓</p>
          <p className="text-gray-600 font-medium">No meals planned this week</p>
          <p className="text-sm text-gray-400 mt-1">Add meals in the planner first</p>
          <button
            onClick={() => router.push('/planner')}
            className="mt-4 px-5 py-2.5 bg-green-600 text-white text-sm font-medium rounded-xl"
          >
            Go to Planner
          </button>
        </div>
      )}

      {/* No list yet */}
      {hasMeals && !assignments && (
        <div className="max-w-lg mx-auto px-4 py-16 text-center">
          <p className="text-4xl mb-4">🛒</p>
          <p className="text-gray-600 font-medium">Ready to build your list</p>
          <p className="text-sm text-gray-400 mt-1">
            Tap &ldquo;Build List&rdquo; to aggregate ingredients from this week&apos;s meals
          </p>
          <button
            onClick={() => { router.refresh(); router.push(`/planner?week=${weekStart}`) }}
            className="inline-block mt-4 text-sm text-green-600 font-medium"
          >
            ← Back to week view
          </button>
        </div>
      )}

      {/* List */}
      {assignments && (
        <>
          {/* Store tabs */}
          <div className="sticky top-[73px] z-10 bg-white border-b border-gray-200">
            <div className="max-w-lg mx-auto flex">
              {STORES.map((store) => {
                const remaining = uncheckedCount(store)
                const total = totalCount(store)
                return (
                  <button
                    key={store}
                    onClick={() => setActiveStore(store)}
                    className={`flex-1 py-3 text-xs font-medium transition-colors border-b-2 ${
                      activeStore === store
                        ? 'border-green-600 text-green-700'
                        : 'border-transparent text-gray-500'
                    }`}
                  >
                    <span className="block truncate px-1">{store}</span>
                    {total > 0 && (
                      <span className={`text-xs ${remaining === 0 ? 'text-green-500' : 'text-gray-400'}`}>
                        {remaining === 0 ? '✓ done' : `${remaining}/${total}`}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Items */}
          <div className="max-w-lg mx-auto px-4 py-4">
            {assignments[activeStore].length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-12">Nothing needed here</p>
            ) : (
              (() => {
                const groups = groupByCategory(assignments[activeStore])
                const globalIdxMap = new Map<ShoppingItem, number>(
                  assignments[activeStore].map((item, i) => [item, i])
                )
                return (
                  <div className="space-y-4">
                    {Array.from(groups.entries()).map(([cat, items]) => (
                      <div key={cat}>
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                          {CATEGORY_LABELS[cat] ?? cat}
                        </p>
                        <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                          {items.map((item, idx) => {
                            const globalIdx = globalIdxMap.get(item) ?? 0
                            const rowKey = `${activeStore}-${globalIdx}`
                            const isOpen = swipeOpenKey === rowKey

                            return (
                              <div key={idx} className="relative overflow-hidden">
                                {/* Sliding row content */}
                                <div
                                  style={{
                                    transform: isOpen ? `translateX(-${REMOVE_BTN_WIDTH}px)` : 'translateX(0)',
                                    transition: 'transform 0.2s ease',
                                  }}
                                  onTouchStart={(e) => {
                                    // Snap any currently-open row closed before starting a new drag
                                    if (swipeOpenKey !== null && swipeOpenKey !== rowKey) {
                                      setSwipeOpenKey(null)
                                    }
                                    touchStartX.current = e.touches[0].clientX
                                    isDragging.current = true
                                    dragKey.current = rowKey
                                    dragRowRef.current = e.currentTarget as HTMLDivElement
                                    const el = e.currentTarget as HTMLDivElement
                                    requestAnimationFrame(() => {
                                      if (isDragging.current && dragKey.current === rowKey) {
                                        el.style.transition = 'none'
                                      }
                                    })
                                  }}
                                  onTouchMove={(e) => {
                                    if (!isDragging.current || dragKey.current !== rowKey) return
                                    const deltaX = e.touches[0].clientX - touchStartX.current
                                    if (deltaX >= 0) return
                                    const clamped = Math.max(-REMOVE_BTN_WIDTH, deltaX)
                                    if (dragRowRef.current) {
                                      dragRowRef.current.style.transform = `translateX(${clamped}px)`
                                    }
                                  }}
                                  onTouchEnd={(e) => {
                                    if (!isDragging.current || dragKey.current !== rowKey) return
                                    const deltaX = e.changedTouches[0].clientX - touchStartX.current
                                    isDragging.current = false
                                    dragKey.current = null

                                    if (dragRowRef.current) {
                                      dragRowRef.current.style.transition = 'transform 0.2s ease'
                                    }
                                    dragRowRef.current = null

                                    if (deltaX < -40) {
                                      setSwipeOpenKey(rowKey)
                                    } else {
                                      // Snap back — if this row was already open, keep it open
                                      if (!isOpen) {
                                        const el = e.currentTarget as HTMLDivElement
                                        el.style.transform = 'translateX(0)'
                                      }
                                    }
                                  }}
                                  onTouchCancel={() => {
                                    if (!isDragging.current || dragKey.current !== rowKey) return
                                    isDragging.current = false
                                    dragKey.current = null
                                    if (dragRowRef.current) {
                                      dragRowRef.current.style.transition = 'transform 0.2s ease'
                                      dragRowRef.current.style.transform = isOpen ? `translateX(-${REMOVE_BTN_WIDTH}px)` : 'translateX(0)'
                                    }
                                    dragRowRef.current = null
                                  }}
                                >
                                  <button
                                    onClick={() => {
                                      if (isOpen) {
                                        setSwipeOpenKey(null)
                                      } else {
                                        toggleItem(activeStore, globalIdx)
                                      }
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-gray-50 text-left"
                                  >
                                    <span
                                      className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center text-xs ${
                                        item.checked
                                          ? 'bg-green-500 border-green-500 text-white'
                                          : 'border-gray-300'
                                      }`}
                                    >
                                      {item.checked ? '✓' : ''}
                                    </span>
                                    <span
                                      className={`flex-1 text-sm ${
                                        item.checked ? 'line-through text-gray-400' : 'text-gray-800'
                                      }`}
                                    >
                                      {item.name}
                                    </span>
                                    {(item.quantity || item.unit) && (
                                      <span className={`text-sm flex-shrink-0 ${item.checked ? 'text-gray-300' : 'text-gray-500'}`}>
                                        {[item.quantity, item.unit].filter(Boolean).join(' ')}
                                      </span>
                                    )}
                                  </button>
                                </div>

                                {/* Remove button — revealed when content slides left */}
                                <button
                                  onClick={() => removeItem(activeStore, globalIdx)}
                                  className="absolute right-0 top-0 bottom-0 flex items-center justify-center bg-red-500 text-white text-xs font-bold"
                                  style={{ width: REMOVE_BTN_WIDTH }}
                                  aria-label={`Remove ${item.name}`}
                                  tabIndex={isOpen ? 0 : -1}
                                >
                                  Remove
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()
            )}
          </div>
        </>
      )}

      {/* Undo toast */}
      {pendingUndo && (
        <div className="fixed left-4 right-4 z-50 flex items-center justify-between bg-gray-900 text-white px-4 py-3 rounded-2xl shadow-lg" style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <span className="text-sm">{pendingUndo.item.name} removed</span>
          <button
            onClick={undoRemove}
            className="text-sm font-semibold text-green-400 ml-4"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  )
}
