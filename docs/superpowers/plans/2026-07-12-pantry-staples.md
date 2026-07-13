# Pantry Staples Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users mark shopping list items as "always on hand" so pantry staples stop cluttering the list, while remaining accessible in a collapsed "I have these" section.

**Architecture:** A `pantry_staples text[]` column on `households` stores normalized ingredient names. Two fire-and-forget server actions handle writes. `ShoppingClient` receives the staples list at page load, maintains it in local state, and splits each store's items into visible/suppressed at render time — no changes to `buildStoreAssignments`.

**Tech Stack:** Next.js 14 server actions, Supabase Postgres array column, React `useState`/`useTransition`.

---

## File Map

| File | Change |
|------|--------|
| `supabase/migrations/006_pantry_staples.sql` | Create — DB migration |
| `lib/shopping.ts` | Modify — export `normalizeName` |
| `app/shopping/actions.ts` | Modify — add `addPantryStaple`, `removePantryStaple`; update `ShoppingListData` + all functions that fetch/return it |
| `app/shopping/page.tsx` | Modify — pass `initialStaples` prop to `ShoppingClient` |
| `app/shopping/ShoppingClient.tsx` | Modify — new prop + state, filtering, mark/unmark buttons, "I have these" sections |

---

### Task 1: DB migration + export normalizeName

**Files:**
- Create: `supabase/migrations/006_pantry_staples.sql`
- Modify: `lib/shopping.ts`

**Context:** `normalizeName` in `lib/shopping.ts` is currently an unexported private function (around line 88). It needs to be exported so server actions and `ShoppingClient` can share the same normalization logic. The Supabase migration adds `pantry_staples text[]` to the `households` table.

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/006_pantry_staples.sql
alter table households
  add column if not exists pantry_staples text[] not null default '{}';
```

- [ ] **Step 2: Export normalizeName in lib/shopping.ts**

Find the line (around line 88):
```typescript
function normalizeName(raw: string): string {
```

Change it to:
```typescript
export function normalizeName(raw: string): string {
```

No other changes to `lib/shopping.ts`.

- [ ] **Step 3: Type-check**

Run:
```bash
cd /Users/austin.louthan/Projects/meal-planner && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/006_pantry_staples.sql lib/shopping.ts
git commit -m "feat: add pantry_staples column to households, export normalizeName"
```

---

### Task 2: Server actions

**Files:**
- Modify: `app/shopping/actions.ts`

**Context:** This task adds two new exported server actions and threads `pantryStaples: string[]` through the existing data flow. Key points:
- `ShoppingListData` (exported interface around line 161) gets a new `pantryStaples: string[]` field.
- `_buildAndSaveList` (private helper, around line 187) gets a new `pantryStaples: string[]` parameter and includes it in its return.
- `generateShoppingList` already fetches `households.preferences` — extend that select to also fetch `pantry_staples`, then pass it to `_buildAndSaveList`.
- `resolveAndGenerateList` does the same.
- `loadShoppingList` currently does not fetch households — add a query for `pantry_staples`.
- `normalizeName` must be imported from `@/lib/shopping` (it was just exported in Task 1).

- [ ] **Step 1: Add normalizeName to the import from @/lib/shopping**

Current import (around line 8):
```typescript
import {
  buildStoreAssignments,
  formatQty,
  volumeFromCanonical,
  weightFromCanonical,
  type StoreAssignments,
  type ShoppingItem,
  type ManualItem,
  type ConflictItem,
  type UnitPreferences,
} from '@/lib/shopping'
```

Replace with:
```typescript
import {
  normalizeName,
  buildStoreAssignments,
  formatQty,
  volumeFromCanonical,
  weightFromCanonical,
  type StoreAssignments,
  type ShoppingItem,
  type ManualItem,
  type ConflictItem,
  type UnitPreferences,
} from '@/lib/shopping'
```

- [ ] **Step 2: Add pantryStaples to ShoppingListData**

Current interface (around line 161):
```typescript
export interface ShoppingListData {
  id: string
  storeAssignments: StoreAssignments
  generatedAt: string
  mealPlanId: string
  manualItems: ManualItem[]
  stores: Store[]
}
```

Replace with:
```typescript
export interface ShoppingListData {
  id: string
  storeAssignments: StoreAssignments
  generatedAt: string
  mealPlanId: string
  manualItems: ManualItem[]
  stores: Store[]
  pantryStaples: string[]
}
```

- [ ] **Step 3: Update _buildAndSaveList signature and return**

Current signature (around line 187):
```typescript
async function _buildAndSaveList(
  db: ReturnType<typeof createAdminClient>,
  householdId: string,
  mealPlanId: string,
  unitPreferences: UnitPreferences
): Promise<ShoppingListData | null> {
```

Replace with:
```typescript
async function _buildAndSaveList(
  db: ReturnType<typeof createAdminClient>,
  householdId: string,
  mealPlanId: string,
  unitPreferences: UnitPreferences,
  pantryStaples: string[]
): Promise<ShoppingListData | null> {
```

At the end of `_buildAndSaveList`, find the return statement (around line 279):
```typescript
  return {
    id: saved.id,
    storeAssignments,
    generatedAt: saved.generated_at,
    mealPlanId,
    manualItems,
    stores,
  }
```

Replace with:
```typescript
  return {
    id: saved.id,
    storeAssignments,
    generatedAt: saved.generated_at,
    mealPlanId,
    manualItems,
    stores,
    pantryStaples,
  }
```

- [ ] **Step 4: Update generateShoppingList to fetch pantry_staples and pass it**

In `generateShoppingList` (around line 289), find the household fetch:
```typescript
  const { data: household } = await db
    .from('households')
    .select('preferences')
    .eq('id', householdId)
    .single()
```

Replace with:
```typescript
  const { data: household } = await db
    .from('households')
    .select('preferences, pantry_staples')
    .eq('id', householdId)
    .single()

  const pantryStaples: string[] = (household?.pantry_staples as string[] | null) ?? []
```

Then find the final `_buildAndSaveList` call in `generateShoppingList` (around line 353):
```typescript
  const result = await _buildAndSaveList(db, householdId, mealPlanId, unitPreferences)
```

Replace with:
```typescript
  const result = await _buildAndSaveList(db, householdId, mealPlanId, unitPreferences, pantryStaples)
```

- [ ] **Step 5: Update resolveAndGenerateList to fetch pantry_staples and pass it**

In `resolveAndGenerateList` (around line 358), find the household fetch:
```typescript
  const { data: household } = await db
    .from('households')
    .select('preferences')
    .eq('id', householdId)
    .single()
```

Replace with:
```typescript
  const { data: household } = await db
    .from('households')
    .select('preferences, pantry_staples')
    .eq('id', householdId)
    .single()

  const pantryStaples: string[] = (household?.pantry_staples as string[] | null) ?? []
```

Then find the `_buildAndSaveList` call at the bottom of `resolveAndGenerateList` (around line 382):
```typescript
  return _buildAndSaveList(db, householdId, mealPlanId, mergedUnitPrefs)
```

Replace with:
```typescript
  return _buildAndSaveList(db, householdId, mealPlanId, mergedUnitPrefs, pantryStaples)
```

- [ ] **Step 6: Update loadShoppingList to fetch and return pantry_staples**

In `loadShoppingList` (around line 385), after the line `const stores = await loadStores(db, householdId)`, add:

```typescript
  const { data: household } = await db
    .from('households')
    .select('pantry_staples')
    .eq('id', householdId)
    .single()
  const pantryStaples: string[] = (household?.pantry_staples as string[] | null) ?? []
```

Then find the return statement at the bottom of `loadShoppingList` (around line 436):
```typescript
  return {
    id: list.id,
    storeAssignments,
    generatedAt: list.generated_at,
    mealPlanId,
    manualItems,
    stores,
  }
```

Replace with:
```typescript
  return {
    id: list.id,
    storeAssignments,
    generatedAt: list.generated_at,
    mealPlanId,
    manualItems,
    stores,
    pantryStaples,
  }
```

- [ ] **Step 7: Add addPantryStaple and removePantryStaple at the bottom of the file**

The Supabase JS client doesn't support Postgres `array_append`/`array_remove` directly as update values, so both actions fetch the current array and write back the modified version. Add these two functions at the end of `app/shopping/actions.ts`:

```typescript
export async function addPantryStaple(rawName: string): Promise<void> {
  const { db, householdId } = await getContext()
  const normalized = normalizeName(rawName)

  const { data } = await db
    .from('households')
    .select('pantry_staples')
    .eq('id', householdId)
    .single()

  const current: string[] = (data?.pantry_staples as string[] | null) ?? []
  if (current.includes(normalized)) return

  await db
    .from('households')
    .update({ pantry_staples: [...current, normalized] })
    .eq('id', householdId)
}

export async function removePantryStaple(rawName: string): Promise<void> {
  const { db, householdId } = await getContext()
  const normalized = normalizeName(rawName)

  const { data } = await db
    .from('households')
    .select('pantry_staples')
    .eq('id', householdId)
    .single()

  const current: string[] = (data?.pantry_staples as string[] | null) ?? []

  await db
    .from('households')
    .update({ pantry_staples: current.filter(s => s !== normalized) })
    .eq('id', householdId)
}
```

- [ ] **Step 8: Type-check**

Run:
```bash
cd /Users/austin.louthan/Projects/meal-planner && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add app/shopping/actions.ts
git commit -m "feat: add addPantryStaple, removePantryStaple actions; thread pantryStaples through ShoppingListData"
```

---

### Task 3: ShoppingClient — prop, state, and per-store tab UI

**Files:**
- Modify: `app/shopping/page.tsx`
- Modify: `app/shopping/ShoppingClient.tsx`

**Context:** This task wires up the new `initialStaples` prop, adds the two state values, and updates the per-store tab (the `activeTab !== 'all'` branch, around line 554) to:
1. Split items into `visible` and `suppressed`.
2. Restructure item rows to separate the checkbox-tap area from a new ⌂ staple button on the right.
3. Update badge count functions to exclude suppressed items.
4. Render a collapsible "I have these" section below visible category groups.

The All tab is handled in Task 4.

**Important:** Items remain in the `assignments` state — they are only excluded from `visible` at render time. This preserves `toggleItem`/`scheduleSave` for suppressed items that get checked while expanded.

- [ ] **Step 1: Update page.tsx to pass initialStaples**

In `app/shopping/page.tsx`, find the `<ShoppingClient ... />` JSX (around line 52):
```tsx
  return (
    <ShoppingClient
      mealPlanId={mealPlanId}
      initialListId={existing?.id ?? null}
      initialAssignments={existing?.storeAssignments ?? null}
      initialGeneratedAt={existing?.generatedAt ?? null}
      hasMeals={hasMeals}
      initialManualItems={existing?.manualItems ?? []}
      initialStores={existing?.stores ?? []}
    />
  )
```

Replace with:
```tsx
  return (
    <ShoppingClient
      mealPlanId={mealPlanId}
      initialListId={existing?.id ?? null}
      initialAssignments={existing?.storeAssignments ?? null}
      initialGeneratedAt={existing?.generatedAt ?? null}
      hasMeals={hasMeals}
      initialManualItems={existing?.manualItems ?? []}
      initialStores={existing?.stores ?? []}
      initialStaples={existing?.pantryStaples ?? []}
    />
  )
```

- [ ] **Step 2: Add normalizeName to ShoppingClient's import from @/lib/shopping**

Find the import (around line 7):
```typescript
import { CATEGORY_ORDER, type StoreAssignments, type ShoppingItem, type ManualItem, type UnitPreferences } from '@/lib/shopping'
```

Replace with:
```typescript
import { normalizeName, CATEGORY_ORDER, type StoreAssignments, type ShoppingItem, type ManualItem, type UnitPreferences } from '@/lib/shopping'
```

- [ ] **Step 3: Add addPantryStaple and removePantryStaple to the actions import**

Find the actions import (around line 6):
```typescript
import { generateShoppingList, saveCheckedState, saveManualItems, resolveAndGenerateList, type ResolvedConflict, type GenerateResult } from './actions'
```

Replace with:
```typescript
import { generateShoppingList, saveCheckedState, saveManualItems, resolveAndGenerateList, addPantryStaple, removePantryStaple, type ResolvedConflict, type GenerateResult } from './actions'
```

- [ ] **Step 4: Add initialStaples to Props interface**

Find the Props interface (around line 33):
```typescript
interface Props {
  mealPlanId: string
  initialListId: string | null
  initialAssignments: StoreAssignments | null
  initialGeneratedAt: string | null
  hasMeals: boolean
  initialManualItems: ManualItem[]
  initialStores: Store[]
}
```

Replace with:
```typescript
interface Props {
  mealPlanId: string
  initialListId: string | null
  initialAssignments: StoreAssignments | null
  initialGeneratedAt: string | null
  hasMeals: boolean
  initialManualItems: ManualItem[]
  initialStores: Store[]
  initialStaples: string[]
}
```

- [ ] **Step 5: Destructure initialStaples in the component**

Find the function signature (around line 43):
```typescript
export default function ShoppingClient({
  mealPlanId,
  initialListId,
  initialAssignments,
  initialGeneratedAt,
  hasMeals,
  initialManualItems,
  initialStores,
}: Props) {
```

Replace with:
```typescript
export default function ShoppingClient({
  mealPlanId,
  initialListId,
  initialAssignments,
  initialGeneratedAt,
  hasMeals,
  initialManualItems,
  initialStores,
  initialStaples,
}: Props) {
```

- [ ] **Step 6: Add staples and staplesExpanded state after the existing state declarations**

After the line `const [manualItems, setManualItems] = useState<ManualItem[]>(initialManualItems)` (around line 66), add:

```typescript
  const [staples, setStaples] = useState<Set<string>>(() => new Set(initialStaples))
  const [staplesExpanded, setStaplesExpanded] = useState(false)
```

- [ ] **Step 7: Add handleMarkStaple and handleUnmarkStaple after the existing helper functions**

After the `storeColorClass` function (around line 107), add:

```typescript
  function handleMarkStaple(rawName: string) {
    const normalized = normalizeName(rawName)
    setStaples(prev => new Set([...prev, normalized]))
    startTransition(() => addPantryStaple(rawName))
  }

  function handleUnmarkStaple(rawName: string) {
    const normalized = normalizeName(rawName)
    setStaples(prev => {
      const next = new Set(prev)
      next.delete(normalized)
      return next
    })
    startTransition(() => removePantryStaple(rawName))
  }
```

- [ ] **Step 8: Update badge count functions to exclude suppressed items**

Find the badge count functions (around line 347):
```typescript
  const uncheckedCount = (store: string) =>
    assignments?.[store]?.filter((i) => !i.checked).length ?? 0

  const totalCount = (store: string) => assignments?.[store]?.length ?? 0
```

Replace with:
```typescript
  const uncheckedCount = (store: string) =>
    assignments?.[store]?.filter((i) => !i.checked && !staples.has(normalizeName(i.name))).length ?? 0

  const totalCount = (store: string) =>
    assignments?.[store]?.filter(i => !staples.has(normalizeName(i.name))).length ?? 0
```

- [ ] **Step 9: Replace the per-store tab item rendering with split visible/suppressed + new row structure + "I have these" section**

The per-store tab content is the `activeTab !== 'all'` branch (around line 554). Find this entire block:

```tsx
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
```

Replace with:

```tsx
          {/* Per-store tab content */}
          {activeTab !== 'all' && (
            <div className="max-w-lg mx-auto px-4 py-4">
              {(assignments[activeTab] ?? []).length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-12">Nothing needed here</p>
              ) : (
                (() => {
                  const allItems = assignments[activeTab] ?? []
                  const globalIdxMap = new Map<ShoppingItem, number>(
                    allItems.map((item, i) => [item, i])
                  )
                  const visible = allItems.filter(item => !staples.has(normalizeName(item.name)))
                  const suppressed = allItems.filter(item => staples.has(normalizeName(item.name)))
                  const groups = groupByCategory(visible)

                  return (
                    <div className="space-y-4">
                      {visible.length === 0 && suppressed.length === 0 && (
                        <p className="text-center text-sm text-gray-400 py-12">Nothing needed here</p>
                      )}
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
                                    <div className="flex items-center">
                                      <button
                                        onClick={() => {
                                          if (isOpen) {
                                            setSwipeOpenKey(null)
                                          } else {
                                            toggleItem(activeTab, globalIdx)
                                          }
                                        }}
                                        className="flex-1 flex items-center gap-3 pl-4 pr-2 py-3.5 active:bg-gray-50 text-left"
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
                                      <button
                                        onClick={() => handleMarkStaple(item.name)}
                                        className="pr-4 pl-2 py-3.5 text-gray-300 active:text-gray-500 flex-shrink-0 text-base leading-none"
                                        aria-label={`Mark ${item.name} as pantry staple`}
                                      >
                                        ⌂
                                      </button>
                                    </div>
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

                      {/* I have these — collapsible suppressed section */}
                      {suppressed.length > 0 && (
                        <div>
                          <button
                            onClick={() => setStaplesExpanded(e => !e)}
                            className="w-full flex items-center justify-between px-1 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide"
                          >
                            <span>I have these ({suppressed.length})</span>
                            <span>{staplesExpanded ? '▾' : '▸'}</span>
                          </button>
                          {staplesExpanded && (
                            <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100 overflow-hidden mt-1">
                              {suppressed.map((item) => {
                                const globalIdx = globalIdxMap.get(item) ?? 0
                                return (
                                  <div key={item.name} className="flex items-center gap-3 px-4 py-3.5">
                                    <button
                                      onClick={() => toggleItem(activeTab, globalIdx)}
                                      className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center text-xs ${
                                        item.checked
                                          ? 'bg-green-500 border-green-500 text-white'
                                          : 'border-gray-200'
                                      }`}
                                    >
                                      {item.checked ? '✓' : ''}
                                    </button>
                                    <span className="flex-1 text-sm text-gray-400">{item.name}</span>
                                    {(item.quantity || item.unit) && (
                                      <span className="text-sm text-gray-300 flex-shrink-0">
                                        {[item.quantity, item.unit].filter(Boolean).join(' ')}
                                      </span>
                                    )}
                                    <button
                                      onClick={() => handleUnmarkStaple(item.name)}
                                      className="text-xs text-gray-400 px-2 py-1 rounded-lg bg-gray-100 flex-shrink-0 active:bg-gray-200"
                                    >
                                      Unmark
                                    </button>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })()
              )}
            </div>
          )}
```

- [ ] **Step 10: Type-check**

Run:
```bash
cd /Users/austin.louthan/Projects/meal-planner && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add app/shopping/page.tsx app/shopping/ShoppingClient.tsx
git commit -m "feat: add pantry staples state and per-store tab UI to ShoppingClient"
```

---

### Task 4: ShoppingClient — All tab staples support

**Files:**
- Modify: `app/shopping/ShoppingClient.tsx`

**Context:** The All tab (the `activeTab === 'all'` branch, around line 487) needs three changes:
1. Update `allTotal` and `allUnchecked` to exclude suppressed items.
2. Add a ⌂ staple button to each visible item row.
3. Add a "I have these" collapsible section at the bottom of the All tab, below all category groups.

The All tab does not have swipe-to-remove or checkboxes — items only have a re-route store badge. The suppressed All tab items show an "Unmark" button but no store badge (they can be re-routed after unmarking).

- [ ] **Step 1: Update allTotal and allUnchecked to exclude suppressed items**

Find (around line 352):
```typescript
  const allTotal = stores.reduce((sum, s) => sum + (assignments?.[s.name]?.length ?? 0), 0)
  const allUnchecked = stores.reduce((sum, s) => sum + (assignments?.[s.name]?.filter(i => !i.checked).length ?? 0), 0)
```

Replace with:
```typescript
  const allTotal = stores.reduce((sum, s) => sum + (assignments?.[s.name]?.filter(i => !staples.has(normalizeName(i.name))).length ?? 0), 0)
  const allUnchecked = stores.reduce((sum, s) => sum + (assignments?.[s.name]?.filter(i => !i.checked && !staples.has(normalizeName(i.name))).length ?? 0), 0)
```

- [ ] **Step 2: Replace the All tab content with split visible/suppressed rendering**

Find the All tab content block (around line 487):

```tsx
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
```

Replace with:

```tsx
          {/* All tab content */}
          {activeTab === 'all' && (
            <div className="max-w-lg mx-auto px-4 py-4">
              {allTotal === 0 && staples.size === 0 ? (
                <p className="text-center text-sm text-gray-400 py-12">Nothing here</p>
              ) : (
                (() => {
                  const allEntries: Array<{ item: ShoppingItem; storeName: string }> = []
                  for (const store of stores) {
                    for (const item of assignments[store.name] ?? []) {
                      allEntries.push({ item, storeName: store.name })
                    }
                  }
                  const visibleEntries = allEntries.filter(({ item }) => !staples.has(normalizeName(item.name)))
                  const suppressedEntries = allEntries.filter(({ item }) => staples.has(normalizeName(item.name)))

                  const groupMap = new Map<string, Array<{ item: ShoppingItem; storeName: string }>>()
                  for (const entry of visibleEntries) {
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
                                    onClick={() => handleMarkStaple(item.name)}
                                    className="text-gray-300 active:text-gray-500 flex-shrink-0 text-base leading-none"
                                    aria-label={`Mark ${item.name} as pantry staple`}
                                  >
                                    ⌂
                                  </button>
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

                      {/* I have these — collapsible suppressed section */}
                      {suppressedEntries.length > 0 && (
                        <div>
                          <button
                            onClick={() => setStaplesExpanded(e => !e)}
                            className="w-full flex items-center justify-between px-1 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide"
                          >
                            <span>I have these ({suppressedEntries.length})</span>
                            <span>{staplesExpanded ? '▾' : '▸'}</span>
                          </button>
                          {staplesExpanded && (
                            <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100 overflow-hidden mt-1">
                              {suppressedEntries.map(({ item, storeName }) => {
                                const abbr = stores.find(s => s.name === storeName)?.abbreviation ?? storeName
                                return (
                                  <div key={`${storeName}-${item.name}`} className="flex items-center gap-3 px-4 py-3.5">
                                    <span className="flex-1 text-sm text-gray-400">{item.name}</span>
                                    {(item.quantity || item.unit) && (
                                      <span className="text-sm text-gray-300 flex-shrink-0">
                                        {[item.quantity, item.unit].filter(Boolean).join(' ')}
                                      </span>
                                    )}
                                    <button
                                      onClick={() => handleUnmarkStaple(item.name)}
                                      className="text-xs text-gray-400 px-2 py-1 rounded-lg bg-gray-100 flex-shrink-0 active:bg-gray-200"
                                    >
                                      Unmark
                                    </button>
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
                          )}
                        </div>
                      )}
                    </div>
                  )
                })()
              )}
            </div>
          )}
```

- [ ] **Step 3: Type-check**

Run:
```bash
cd /Users/austin.louthan/Projects/meal-planner && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Run the migration in Supabase**

Open the Supabase SQL editor for this project and run:

```sql
alter table households
  add column if not exists pantry_staples text[] not null default '{}';
```

Confirm it succeeds with no errors.

- [ ] **Step 5: Smoke-test the feature**

Run `npm run dev`, open a shopping list that has items. Verify:
1. A ⌂ button appears to the right of each item name in a per-store tab and the All tab.
2. Tapping ⌂ immediately moves the item below a new "I have these (1)" row.
3. Expanding "I have these" shows the item dimmed with an "Unmark" button.
4. Tapping "Unmark" moves it back to the visible list.
5. Refreshing the page keeps the item suppressed (persisted to DB).
6. Tab badge counts no longer include suppressed items.

- [ ] **Step 6: Commit**

```bash
git add app/shopping/ShoppingClient.tsx
git commit -m "feat: add staples support to All tab and update badge counts"
```

- [ ] **Step 7: Push**

```bash
git push
```
