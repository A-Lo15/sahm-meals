'use client'

import { useState, useTransition, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { generateShoppingList, saveCheckedState, saveManualItems } from './actions'
import { CATEGORY_ORDER, type StoreAssignments, type ShoppingItem, type ManualItem } from '@/lib/shopping'
import type { IngredientCategory } from '@/lib/types'
import { type Store } from '@/lib/stores'

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

const BADGE_COLORS = [
  'bg-green-100 text-green-700',
  'bg-blue-100 text-blue-700',
  'bg-yellow-100 text-yellow-800',
  'bg-purple-100 text-purple-700',
  'bg-pink-100 text-pink-700',
  'bg-orange-100 text-orange-700',
]

const REMOVE_BTN_WIDTH = 64 // px — width of the trailing Remove button

interface Props {
  weekStart: string
  initialListId: string | null
  initialAssignments: StoreAssignments | null
  initialGeneratedAt: string | null
  hasMeals: boolean
  initialManualItems: ManualItem[]
  initialStores: Store[]
}

export default function ShoppingClient({
  weekStart,
  initialListId,
  initialAssignments,
  initialGeneratedAt,
  hasMeals,
  initialManualItems,
  initialStores,
}: Props) {
  const router = useRouter()
  const [listId, setListId] = useState(initialListId)
  const [assignments, setAssignments] = useState<StoreAssignments | null>(initialAssignments)
  const [generatedAt, setGeneratedAt] = useState(initialGeneratedAt)
  const [stores, setStores] = useState<Store[]>(initialStores)
  const [activeTab, setActiveTab] = useState<string>('all')
  const [isPending, startTransition] = useTransition()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [manualItems, setManualItems] = useState<ManualItem[]>(initialManualItems)

  // Add-item bottom sheet state
  const [addSheetOpen, setAddSheetOpen] = useState(false)
  const [newItemName, setNewItemName] = useState('')
  const [newItemQty, setNewItemQty] = useState('')
  const [newItemUnit, setNewItemUnit] = useState('')
  const [newItemStore, setNewItemStore] = useState<string>(initialStores[0]?.name ?? '')

  // Re-route state
  const [rerouteTarget, setRerouteTarget] = useState<{
    item: ShoppingItem
    fromStore: string
  } | null>(null)

  // Swipe-to-remove state
  const [swipeOpenKey, setSwipeOpenKey] = useState<string | null>(null)
  const [pendingUndo, setPendingUndo] = useState<{
    item: ShoppingItem
    store: string
    index: number
    manualItemsSnapshot: ManualItem[] | null
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

  function storeColorClass(storeName: string): string {
    const idx = stores.findIndex(s => s.name === storeName)
    return BADGE_COLORS[idx < 0 ? 0 : idx % BADGE_COLORS.length]!
  }

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
        setManualItems(result.manualItems)
        setStores(result.stores)
        setActiveTab(prev =>
          prev === 'all' || result.stores.some(s => s.name === prev)
            ? prev
            : 'all'
        )
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

  function toggleItem(store: string, index: number) {
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

  function removeItem(store: string, index: number) {
    if (!assignments || !listId) return

    const item = assignments[store][index]

    // Commit any prior pending removal immediately before starting a new one.
    if (pendingUndo && undoTimer.current) {
      clearTimeout(undoTimer.current)
      scheduleSave(listId, assignments)
      if (pendingUndo.manualItemsSnapshot !== null) {
        startTransition(() => saveManualItems(listId, manualItems))
      }
    }

    // If this is a manual item, remove it from manualItems state immediately.
    // The DB write is deferred to the undo timer so undo can restore it.
    let nextManualItems = manualItems
    if (item.manual && item.manualId) {
      nextManualItems = manualItems.filter((mi) => mi.id !== item.manualId)
      setManualItems(nextManualItems)
    }

    const updated: StoreAssignments = {
      ...assignments,
      [store]: assignments[store].filter((_, i) => i !== index),
    }
    setAssignments(updated)
    setSwipeOpenKey(null)
    setPendingUndo({
      item,
      store,
      index,
      manualItemsSnapshot: item.manual ? manualItems : null,
    })

    undoTimer.current = setTimeout(() => {
      scheduleSave(listId, updated)
      if (item.manual) {
        startTransition(() => saveManualItems(listId, nextManualItems))
      }
      setPendingUndo(null)
    }, 4000)
  }

  function undoRemove() {
    if (!pendingUndo || !assignments) return
    if (undoTimer.current) clearTimeout(undoTimer.current)

    const { item, store, index, manualItemsSnapshot } = pendingUndo
    const restored = [...assignments[store]]
    restored.splice(index, 0, item)
    setAssignments({ ...assignments, [store]: restored })

    if (manualItemsSnapshot !== null) {
      setManualItems(manualItemsSnapshot)
    }

    setPendingUndo(null)
  }

  function addManualItem() {
    if (!listId || !assignments || !newItemName.trim()) return

    const id = crypto.randomUUID()
    const newManualItem: ManualItem = {
      id,
      store: newItemStore,
      name: newItemName.trim(),
      quantity: newItemQty.trim(),
      unit: newItemUnit.trim(),
    }
    const newShoppingItem: ShoppingItem = {
      name: newManualItem.name,
      quantity: newManualItem.quantity,
      unit: newManualItem.unit,
      category: 'other',
      checked: false,
      manual: true,
      manualId: id,
    }

    const updatedManualItems = [...manualItems, newManualItem]
    const updatedAssignments: StoreAssignments = {
      ...assignments,
      [newItemStore]: [...(assignments[newItemStore] ?? []), newShoppingItem],
    }

    setManualItems(updatedManualItems)
    setAssignments(updatedAssignments)
    setAddSheetOpen(false)
    setNewItemName('')
    setNewItemQty('')
    setNewItemUnit('')

    startTransition(() => saveManualItems(listId, updatedManualItems))
    scheduleSave(listId, updatedAssignments)
  }

  function rerouteItem(item: ShoppingItem, fromStore: string, toStore: string) {
    if (!assignments || !listId || fromStore === toStore) {
      setRerouteTarget(null)
      return
    }

    // Commit any pending removal before mutating assignments, same as removeItem does.
    if (pendingUndo && undoTimer.current) {
      clearTimeout(undoTimer.current)
      scheduleSave(listId, assignments)
      if (pendingUndo.manualItemsSnapshot !== null) {
        startTransition(() => saveManualItems(listId, manualItems))
      }
      setPendingUndo(null)
    }

    const fromItems = (assignments[fromStore] ?? []).filter(i => i !== item)
    const toItems = [...(assignments[toStore] ?? []), item]
    const updated: StoreAssignments = {
      ...assignments,
      [fromStore]: fromItems,
      [toStore]: toItems,
    }
    setAssignments(updated)
    setRerouteTarget(null)
    scheduleSave(listId, updated)

    if (item.manual && item.manualId) {
      const updatedManualItems = manualItems.map(mi =>
        mi.id === item.manualId ? { ...mi, store: toStore } : mi
      )
      setManualItems(updatedManualItems)
      startTransition(() => saveManualItems(listId, updatedManualItems))
    }
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

  const uncheckedCount = (store: string) =>
    assignments?.[store]?.filter((i) => !i.checked).length ?? 0

  const totalCount = (store: string) => assignments?.[store]?.length ?? 0

  const allTotal = stores.reduce((sum, s) => sum + (assignments?.[s.name]?.length ?? 0), 0)
  const allUnchecked = stores.reduce((sum, s) => sum + (assignments?.[s.name]?.filter(i => !i.checked).length ?? 0), 0)

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
            <div className="flex items-center gap-2">
              <Link
                href="/shopping/stores"
                className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-700 text-sm"
                aria-label="Manage stores"
              >
                ⚙
              </Link>
              {listId && (
                <button
                  onClick={() => setAddSheetOpen(true)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-700 text-xl font-light leading-none"
                  aria-label="Add item"
                >
                  +
                </button>
              )}
              <button
                onClick={handleGenerate}
                disabled={isPending || !hasMeals}
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-xl disabled:opacity-40 active:bg-green-700"
              >
                {isPending ? 'Building…' : assignments ? 'Regenerate' : 'Build List'}
              </button>
            </div>
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
            <div className="max-w-lg mx-auto flex overflow-x-auto">
              {/* All tab */}
              <button
                onClick={() => setActiveTab('all')}
                className={`flex-shrink-0 px-4 py-3 text-xs font-medium transition-colors border-b-2 ${
                  activeTab === 'all'
                    ? 'border-green-600 text-green-700'
                    : 'border-transparent text-gray-500'
                }`}
              >
                <span className="block">All</span>
                {allTotal > 0 && (
                  <span className={`text-xs ${allUnchecked === 0 ? 'text-green-500' : 'text-gray-400'}`}>
                    {allUnchecked === 0 ? '✓' : allTotal}
                  </span>
                )}
              </button>
              {/* Per-store tabs */}
              {stores.map((store) => {
                const remaining = uncheckedCount(store.name)
                const total = totalCount(store.name)
                return (
                  <button
                    key={store.id}
                    onClick={() => setActiveTab(store.name)}
                    className={`flex-shrink-0 px-4 py-3 text-xs font-medium transition-colors border-b-2 ${
                      activeTab === store.name
                        ? 'border-green-600 text-green-700'
                        : 'border-transparent text-gray-500'
                    }`}
                  >
                    <span className="block">{store.abbreviation}</span>
                    {total > 0 && (
                      <span className={`text-xs ${remaining === 0 ? 'text-green-500' : 'text-gray-400'}`}>
                        {remaining === 0 ? '✓' : `${remaining}/${total}`}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* All tab content */}
          {activeTab === 'all' && (
            <div className="max-w-lg mx-auto px-4 py-4">
              {allTotal === 0 ? (
                <p className="text-center text-sm text-gray-400 py-12">Nothing here</p>
              ) : (
                (() => {
                  const allEntries: Array<{ item: ShoppingItem; storeName: string }> = []
                  for (const store of stores) {
                    for (const item of assignments[store.name] ?? []) {
                      allEntries.push({ item, storeName: store.name })
                    }
                  }
                  const groupMap = new Map<string, Array<{ item: ShoppingItem; storeName: string }>>()
                  for (const entry of allEntries) {
                    const cat = entry.item.category || 'other'
                    if (!groupMap.has(cat)) groupMap.set(cat, [])
                    groupMap.get(cat)!.push(entry)
                  }
                  const sortedGroups = Array.from(groupMap.entries()).sort(([a], [b]) => {
                    const ai = CATEGORY_ORDER.indexOf(a as IngredientCategory)
                    const bi = CATEGORY_ORDER.indexOf(b as IngredientCategory)
                    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
                  })
                  return (
                    <div className="space-y-4">
                      {sortedGroups.map(([cat, entries]: [string, Array<{ item: ShoppingItem; storeName: string }>]) => (
                        <div key={cat}>
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                            {CATEGORY_LABELS[cat] ?? cat}
                          </p>
                          <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                            {entries.map(({ item, storeName }) => {
                              const abbr = stores.find(s => s.name === storeName)?.abbreviation ?? storeName
                              return (
                                <div key={`${storeName}-${item.name}`} className="flex items-center gap-3 px-4 py-3.5">
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
                                  <button
                                    onClick={() => setRerouteTarget({ item, fromStore: storeName })}
                                    className={`text-xs font-bold px-2 py-1 rounded-md flex-shrink-0 ${storeColorClass(storeName)}`}
                                  >
                                    {abbr} ›
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
          )}

          {/* Per-store tab content */}
          {activeTab !== 'all' && (
            <div className="max-w-lg mx-auto px-4 py-4">
              {(assignments[activeTab] ?? []).length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-12">Nothing needed here</p>
              ) : (
                (() => {
                  const groups = groupByCategory(assignments[activeTab] ?? [])
                  const globalIdxMap = new Map<ShoppingItem, number>(
                    (assignments[activeTab] ?? []).map((item, i) => [item, i])
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
                              const rowKey = `${activeTab}-${globalIdx}`
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
                                          toggleItem(activeTab, globalIdx)
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
                                    onClick={() => removeItem(activeTab, globalIdx)}
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
          )}
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

      {/* Re-route mini-sheet */}
      {rerouteTarget && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setRerouteTarget(null)}
          />
          <div
            className="relative bg-white rounded-t-2xl px-4 pt-4 space-y-1"
            style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}
          >
            <div className="w-8 h-1 bg-gray-300 rounded-full mx-auto mb-3" />
            <p className="text-sm font-semibold text-gray-900 mb-3">
              {rerouteTarget.item.name} — send to:
            </p>
            {stores.map((store) => (
              <button
                key={store.id}
                onClick={() =>
                  rerouteItem(rerouteTarget.item, rerouteTarget.fromStore, store.name)
                }
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors ${
                  store.name === rerouteTarget.fromStore
                    ? 'bg-green-50'
                    : 'active:bg-gray-50'
                }`}
              >
                <span
                  className={`text-xs font-bold px-2 py-1 rounded-md min-w-[2.5rem] text-center ${storeColorClass(store.name)}`}
                >
                  {store.abbreviation}
                </span>
                <span className="flex-1 text-sm text-gray-800">{store.name}</span>
                {store.name === rerouteTarget.fromStore && (
                  <span className="text-green-600 font-bold text-sm">✓</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Add item bottom sheet */}
      {addSheetOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setAddSheetOpen(false)}
          />
          <div className="relative bg-white rounded-t-2xl px-4 pt-5 space-y-4" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>
            <h2 className="text-base font-semibold text-gray-900 text-center">Add Item</h2>

            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Item name
              </label>
              <input
                type="text"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder="e.g. Granola bars"
                autoFocus
                className="mt-1.5 w-full px-4 py-2.5 bg-gray-100 rounded-xl text-base focus:outline-none"
              />
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Qty
                </label>
                <input
                  type="text"
                  value={newItemQty}
                  onChange={(e) => setNewItemQty(e.target.value)}
                  placeholder="2"
                  className="mt-1.5 w-full px-4 py-2.5 bg-gray-100 rounded-xl text-base focus:outline-none"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Unit
                </label>
                <input
                  type="text"
                  value={newItemUnit}
                  onChange={(e) => setNewItemUnit(e.target.value)}
                  placeholder="bags"
                  className="mt-1.5 w-full px-4 py-2.5 bg-gray-100 rounded-xl text-base focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Store
              </label>
              <div className="flex gap-2 mt-1.5 flex-wrap">
                {stores.map((store) => (
                  <button
                    key={store.id}
                    onClick={() => setNewItemStore(store.name)}
                    className={`px-3 py-2 text-xs font-medium rounded-xl border transition-colors ${
                      newItemStore === store.name
                        ? 'bg-green-600 text-white border-green-600'
                        : 'bg-gray-100 text-gray-600 border-transparent'
                    }`}
                  >
                    {store.abbreviation}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setAddSheetOpen(false)}
                className="flex-1 py-3 bg-gray-100 text-gray-700 font-semibold rounded-xl text-sm active:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={addManualItem}
                disabled={!newItemName.trim()}
                className="flex-1 py-3 bg-green-600 text-white font-semibold rounded-xl text-sm disabled:opacity-40 active:bg-green-700"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
