# Cross-Unit Ingredient Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate shopping list ingredients that appear across recipes in mixed unit families (e.g., "1 clove garlic" + "3 tbsp garlic" → one merged line), with AI-suggested conversion factors and remembered unit preferences.

**Architecture:** Three-layer change: (1) `lib/shopping.ts` detects cross-family conflicts during aggregation and resolves known ones inline; (2) `app/shopping/actions.ts` calls Claude Haiku for conversion factors and returns a discriminated union so the client can show a resolution modal; (3) `ShoppingClient.tsx` adds a bottom sheet with dropdowns for the user to confirm units, then calls a new `resolveAndGenerateList` action that saves preferences to `households.preferences.unit_preferences`.

**Tech Stack:** TypeScript, Next.js 14 server actions, Anthropic SDK (`claude-haiku-4-5-20251001`), Supabase (households JSONB column — no migration needed).

---

## File Map

| File | Change |
|---|---|
| `lib/shopping.ts` | Add `ConflictItem`, `UnitPreference`, `UnitPreferences` types; export `formatQty`, `volumeFromCanonical`, `weightFromCanonical`; add `unitPreferences` param and conflict detection + resolution to `buildStoreAssignments`; change return type to `{ assignments, conflicts }` |
| `app/shopping/actions.ts` | Add `ResolvedConflict`, `ResolvedConflictOption`, `GenerateResult` types; add private `fetchConversionSuggestions` helper; add private `computeConflictDisplay` helper; modify `generateShoppingList` to return `GenerateResult`; add `resolveAndGenerateList` server action |
| `app/shopping/ShoppingClient.tsx` | Import new types; add `pendingConflicts` + `conflictSelections` state; update `handleGenerate`; add `handleResolveConflicts`; add conflict bottom sheet JSX |

---

## Task 1: Add conflict types and detection to lib/shopping.ts

**Files:**
- Modify: `lib/shopping.ts`

- [ ] **Step 1: Add new exported types after the existing `ShoppingItem` and `ManualItem` interfaces**

  Open `lib/shopping.ts`. After the `ManualItem` interface (around line 165), add:

  ```ts
  export interface UnitPreference {
    preferredUnit: string            // e.g. "clove" or "tablespoon"
    preferredFamily: 'other' | 'volume' | 'weight'
    factor: number | null            // tbsp per count (volume) or grams per count (weight); null = unknown
  }

  export type UnitPreferences = Record<string, UnitPreference>

  export interface ConflictItem {
    normalizedName: string           // e.g. "garlic"
    displayName: string              // e.g. "Garlic"
    options: [
      { family: 'other'; unit: string; canonicalQty: number },
      { family: 'volume' | 'weight'; unit: string; canonicalQty: number },
    ]
  }
  ```

- [ ] **Step 2: Export the three private formatting utilities**

  Change these three function declarations from `function` to `export function`:

  ```ts
  export function formatQty(n: number): string { ... }
  ```
  ```ts
  export function volumeFromCanonical(tbsp: number): { qty: number; unit: string } { ... }
  ```
  ```ts
  export function weightFromCanonical(grams: number): { qty: number; unit: string } { ... }
  ```

  (Only the `export` keyword is added to each — the function bodies are unchanged.)

- [ ] **Step 3: Update `buildStoreAssignments` signature**

  Change the existing signature from:

  ```ts
  export function buildStoreAssignments(
    slots: RawSlot[],
    storeNames: string[],
    priorRouteMap: Map<string, string>
  ): StoreAssignments {
  ```

  to:

  ```ts
  export function buildStoreAssignments(
    slots: RawSlot[],
    storeNames: string[],
    priorRouteMap: Map<string, string>,
    unitPreferences: UnitPreferences = {}
  ): { assignments: StoreAssignments; conflicts: ConflictItem[] } {
  ```

- [ ] **Step 4: Add conflict detection and inline resolution between the aggregation loop and the result-building loop**

  The aggregation loop ends around line 230 (`agg.set(key, ...)`). Directly after the closing brace of the `for (const slot of slots)` loop, before `const result: StoreAssignments = {}`, insert:

  ```ts
  // ── Cross-family conflict detection ─────────────────────────────────────────

  const conflicts: ConflictItem[] = []

  // Group agg keys by normalized ingredient name
  const nameToKeys = new Map<string, string[]>()
  for (const key of Array.from(agg.keys())) {
    const name = key.split('|||')[0]
    if (!nameToKeys.has(name)) nameToKeys.set(name, [])
    nameToKeys.get(name)!.push(key)
  }

  for (const [name, keys] of Array.from(nameToKeys.entries())) {
    if (keys.length <= 1) continue

    const otherKey = keys.find(k => k.endsWith('|||other'))
    const measureKey = keys.find(k => k.endsWith('|||volume') || k.endsWith('|||weight'))
    if (!otherKey || !measureKey) continue

    const otherEntry = agg.get(otherKey)!
    const measureEntry = agg.get(measureKey)!
    const measureFamily = measureKey.endsWith('|||volume') ? 'volume' as const : 'weight' as const

    const pref = unitPreferences[name]

    if (pref?.factor != null) {
      // Resolve inline: convert minority family into preferred family and merge
      if (pref.preferredFamily === 'other') {
        otherEntry.canonical += measureEntry.canonical / pref.factor
        agg.delete(measureKey)
      } else {
        measureEntry.canonical += otherEntry.canonical * pref.factor
        agg.delete(otherKey)
      }
    } else {
      // No stored preference or factor — surface as a conflict for the UI
      conflicts.push({
        normalizedName: name,
        displayName: name.charAt(0).toUpperCase() + name.slice(1),
        options: [
          { family: 'other', unit: otherEntry.unit, canonicalQty: otherEntry.canonical },
          { family: measureFamily, unit: measureEntry.unit, canonicalQty: measureEntry.canonical },
        ],
      })
    }
  }
  ```

- [ ] **Step 5: Update the return statement**

  Find the existing `return result` at the end of `buildStoreAssignments` and change it to:

  ```ts
  return { assignments: result, conflicts }
  ```

- [ ] **Step 6: Verify TypeScript compiles**

  ```bash
  npx tsc --noEmit
  ```

  Expected: errors about the call site in `actions.ts` (return type mismatch and missing arg) — that's expected and will be fixed in Task 2. No errors inside `lib/shopping.ts` itself.

- [ ] **Step 7: Commit**

  ```bash
  git add lib/shopping.ts
  git commit -m "feat: add cross-unit conflict detection to buildStoreAssignments"
  ```

---

## Task 2: Update server actions for conflict-aware list generation

**Files:**
- Modify: `app/shopping/actions.ts`

- [ ] **Step 1: Update imports at the top of `actions.ts`**

  Replace the existing shopping import line:

  ```ts
  import { buildStoreAssignments, type StoreAssignments, type ShoppingItem, type ManualItem } from '@/lib/shopping'
  ```

  with:

  ```ts
  import {
    buildStoreAssignments,
    formatQty,
    volumeFromCanonical,
    weightFromCanonical,
    type StoreAssignments,
    type ShoppingItem,
    type ManualItem,
    type ConflictItem,
    type UnitPreference,
    type UnitPreferences,
  } from '@/lib/shopping'
  import Anthropic from '@anthropic-ai/sdk'
  ```

- [ ] **Step 2: Add the `ResolvedConflict` types and `GenerateResult` discriminated union**

  After the existing `ShoppingListData` interface export, add:

  ```ts
  export interface ResolvedConflictOption {
    family: 'other' | 'volume' | 'weight'
    unit: string
    displayQty: string    // merged total in this unit, e.g. "6 cloves" or "2 tablespoons"
    isSuggested: boolean
  }

  export interface ResolvedConflict {
    normalizedName: string
    displayName: string
    options: [ResolvedConflictOption, ResolvedConflictOption]
  }

  export type GenerateResult =
    | ({ type: 'success' } & ShoppingListData)
    | { type: 'conflicts'; conflicts: ResolvedConflict[]; suggestions: Record<string, number> }
  ```

- [ ] **Step 3: Add the private `fetchConversionSuggestions` helper**

  After the `loadStores` helper function, add:

  ```ts
  async function fetchConversionSuggestions(
    conflicts: ConflictItem[]
  ): Promise<Record<string, number>> {
    if (conflicts.length === 0) return {}

    const lines = conflicts.map(c => {
      const measureOpt = c.options[1]
      const measureUnit = measureOpt.family === 'volume' ? 'tablespoons' : 'grams'
      return `- ${c.displayName}: 1 ${c.options[0].unit} = ? ${measureUnit}`
    })

    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: `You are a cooking measurement expert. For each ingredient, give the conversion factor as a positive decimal number.
  Return ONLY valid JSON, no markdown. Format: {"ingredient_name": number}

  ${lines.join('\n')}`,
        }],
      })

      const block = response.content[0]
      if (block.type !== 'text') return {}

      const jsonMatch = block.text.match(/\{[\s\S]+\}/)
      if (!jsonMatch) return {}

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
      const result: Record<string, number> = {}
      for (const [key, val] of Object.entries(parsed)) {
        if (typeof val !== 'number' || val <= 0) continue
        const match = conflicts.find(
          c =>
            c.displayName.toLowerCase() === key.toLowerCase() ||
            c.normalizedName === key.toLowerCase()
        )
        if (match) result[match.normalizedName] = val
      }
      return result
    } catch {
      return {}
    }
  }
  ```

- [ ] **Step 4: Add the private `computeConflictDisplay` helper**

  Directly after `fetchConversionSuggestions`, add:

  ```ts
  function computeConflictDisplay(
    conflict: ConflictItem,
    factor: number | undefined
  ): ResolvedConflict {
    const [otherOpt, measureOpt] = conflict.options

    if (factor) {
      // Compute merged totals for both unit choices
      const totalCount = otherOpt.canonicalQty + measureOpt.canonicalQty / factor
      const totalMeasure = otherOpt.canonicalQty * factor + measureOpt.canonicalQty

      const countDisplay = `${formatQty(totalCount)} ${otherOpt.unit}`

      let measureDisplay: string
      if (measureOpt.family === 'volume') {
        const { qty, unit } = volumeFromCanonical(totalMeasure)
        measureDisplay = `${formatQty(qty)} ${unit}`
      } else {
        const { qty, unit } = weightFromCanonical(totalMeasure)
        measureDisplay = `${formatQty(qty)} ${unit}`
      }

      return {
        normalizedName: conflict.normalizedName,
        displayName: conflict.displayName,
        options: [
          { family: 'other', unit: otherOpt.unit, displayQty: countDisplay, isSuggested: true },
          { family: measureOpt.family, unit: measureOpt.unit, displayQty: measureDisplay, isSuggested: false },
        ],
      }
    }

    // No factor from Claude — show raw unmerged quantities, no suggestion
    let measureDisplay: string
    if (measureOpt.family === 'volume') {
      const { qty, unit } = volumeFromCanonical(measureOpt.canonicalQty)
      measureDisplay = `${formatQty(qty)} ${unit}`
    } else {
      const { qty, unit } = weightFromCanonical(measureOpt.canonicalQty)
      measureDisplay = `${formatQty(qty)} ${unit}`
    }

    return {
      normalizedName: conflict.normalizedName,
      displayName: conflict.displayName,
      options: [
        {
          family: 'other',
          unit: otherOpt.unit,
          displayQty: `${formatQty(otherOpt.canonicalQty)} ${otherOpt.unit}`,
          isSuggested: false,
        },
        { family: measureOpt.family, unit: measureOpt.unit, displayQty: measureDisplay, isSuggested: false },
      ],
    }
  }
  ```

- [ ] **Step 5: Add a shared private helper `_buildAndSaveList` to avoid duplicating list-generation logic**

  Add this function before `generateShoppingList`:

  ```ts
  async function _buildAndSaveList(
    db: ReturnType<typeof createAdminClient>,
    householdId: string,
    weekStart: string,
    unitPreferences: UnitPreferences
  ): Promise<ShoppingListData | null> {
    const stores = await loadStores(db, householdId)

    const { data: plan } = await db
      .from('meal_plans')
      .select('id')
      .eq('household_id', householdId)
      .eq('week_start_date', weekStart)
      .single()

    if (!plan) return null

    const { data: slots } = await db
      .from('meal_plan_recipes')
      .select(`servings_override, recipe:recipes(default_servings, ingredients)`)
      .eq('meal_plan_id', plan.id)

    const { data: existingList } = await db
      .from('shopping_lists')
      .select('manual_overrides, store_assignments')
      .eq('meal_plan_id', plan.id)
      .single()

    const priorRouteMap = new Map<string, string>()
    if (existingList?.store_assignments) {
      const prior = existingList.store_assignments as StoreAssignments
      for (const [storeName, items] of Object.entries(prior)) {
        for (const item of (items as ShoppingItem[])) {
          if (!item.manual && !priorRouteMap.has(item.name.toLowerCase())) {
            priorRouteMap.set(item.name.toLowerCase(), storeName)
          }
        }
      }
    }

    const { assignments: storeAssignments } = buildStoreAssignments(
      (slots ?? []) as unknown as Parameters<typeof buildStoreAssignments>[0],
      stores.map(s => s.name),
      priorRouteMap,
      unitPreferences
    )

    const manualItems: ManualItem[] =
      (existingList?.manual_overrides as { added?: ManualItem[] } | null)?.added ?? []

    const priorAssignments = (existingList?.store_assignments ?? {}) as StoreAssignments
    const priorCheckedMap = new Map<string, boolean>()
    for (const storeName of Object.keys(priorAssignments)) {
      for (const item of priorAssignments[storeName] ?? []) {
        if (item.manualId) priorCheckedMap.set(item.manualId, item.checked)
      }
    }

    for (const mi of manualItems) {
      const shoppingItem: ShoppingItem = {
        name: mi.name,
        quantity: mi.quantity,
        unit: mi.unit,
        category: 'other',
        checked: priorCheckedMap.get(mi.id) ?? false,
        manual: true,
        manualId: mi.id,
      }
      storeAssignments[mi.store] = [
        ...(storeAssignments[mi.store] ?? []),
        shoppingItem,
      ]
    }

    const now = new Date().toISOString()
    const { data: saved, error } = await db
      .from('shopping_lists')
      .upsert(
        {
          meal_plan_id: plan.id,
          store_assignments: storeAssignments,
          generated_at: now,
        },
        { onConflict: 'meal_plan_id' }
      )
      .select('id, generated_at')
      .single()

    if (error) throw error

    return {
      id: saved.id,
      storeAssignments,
      generatedAt: saved.generated_at,
      mealPlanId: plan.id,
      manualItems,
      stores,
    }
  }
  ```

- [ ] **Step 6: Replace the body of `generateShoppingList` with conflict-aware logic**

  Replace the entire existing `generateShoppingList` function with:

  ```ts
  export async function generateShoppingList(weekStart: string): Promise<GenerateResult | null> {
    const { db, householdId } = await getContext()

    // Load stored unit preferences
    const { data: household } = await db
      .from('households')
      .select('preferences')
      .eq('id', householdId)
      .single()

    const storedPrefs = (household?.preferences as Record<string, unknown>) ?? {}
    const unitPreferences: UnitPreferences =
      (storedPrefs.unit_preferences as UnitPreferences) ?? {}

    // Get meal plan + slots to detect conflicts
    const stores = await loadStores(db, householdId)

    const { data: plan } = await db
      .from('meal_plans')
      .select('id')
      .eq('household_id', householdId)
      .eq('week_start_date', weekStart)
      .single()

    if (!plan) return null

    const { data: slots } = await db
      .from('meal_plan_recipes')
      .select(`servings_override, recipe:recipes(default_servings, ingredients)`)
      .eq('meal_plan_id', plan.id)

    const { data: existingList } = await db
      .from('shopping_lists')
      .select('manual_overrides, store_assignments')
      .eq('meal_plan_id', plan.id)
      .single()

    const priorRouteMap = new Map<string, string>()
    if (existingList?.store_assignments) {
      const prior = existingList.store_assignments as StoreAssignments
      for (const [storeName, items] of Object.entries(prior)) {
        for (const item of (items as ShoppingItem[])) {
          if (!item.manual && !priorRouteMap.has(item.name.toLowerCase())) {
            priorRouteMap.set(item.name.toLowerCase(), storeName)
          }
        }
      }
    }

    const { conflicts } = buildStoreAssignments(
      (slots ?? []) as unknown as Parameters<typeof buildStoreAssignments>[0],
      stores.map(s => s.name),
      priorRouteMap,
      unitPreferences
    )

    if (conflicts.length > 0) {
      const suggestions = await fetchConversionSuggestions(conflicts)
      const resolvedConflicts = conflicts.map(c =>
        computeConflictDisplay(c, suggestions[c.normalizedName])
      )
      return { type: 'conflicts', conflicts: resolvedConflicts, suggestions }
    }

    const result = await _buildAndSaveList(db, householdId, weekStart, unitPreferences)
    if (!result) return null
    return { type: 'success', ...result }
  }
  ```

- [ ] **Step 7: Add `resolveAndGenerateList` server action**

  After `generateShoppingList`, add:

  ```ts
  export async function resolveAndGenerateList(
    weekStart: string,
    newPreferences: UnitPreferences
  ): Promise<ShoppingListData | null> {
    const { db, householdId } = await getContext()

    // Merge new preferences into existing stored preferences
    const { data: household } = await db
      .from('households')
      .select('preferences')
      .eq('id', householdId)
      .single()

    const currentPrefs = (household?.preferences as Record<string, unknown>) ?? {}
    const currentUnitPrefs = (currentPrefs.unit_preferences as UnitPreferences) ?? {}
    const mergedUnitPrefs: UnitPreferences = { ...currentUnitPrefs, ...newPreferences }

    // Best-effort preference save — non-fatal if it fails
    await db
      .from('households')
      .update({ preferences: { ...currentPrefs, unit_preferences: mergedUnitPrefs } })
      .eq('id', householdId)

    return _buildAndSaveList(db, householdId, weekStart, mergedUnitPrefs)
  }
  ```

- [ ] **Step 8: Verify TypeScript compiles**

  ```bash
  npx tsc --noEmit
  ```

  Expected: errors only in `ShoppingClient.tsx` (still consuming the old `generateShoppingList` return type). No errors in `actions.ts` or `lib/shopping.ts`.

- [ ] **Step 9: Commit**

  ```bash
  git add app/shopping/actions.ts lib/shopping.ts
  git commit -m "feat: add AI-powered conflict detection and resolution to shopping list generation"
  ```

---

## Task 3: Add conflict resolution UI to ShoppingClient.tsx

**Files:**
- Modify: `app/shopping/ShoppingClient.tsx`

- [ ] **Step 1: Update imports**

  At the top of `ShoppingClient.tsx`, replace:

  ```ts
  import { generateShoppingList, saveCheckedState, saveManualItems } from './actions'
  import { CATEGORY_ORDER, type StoreAssignments, type ShoppingItem, type ManualItem } from '@/lib/shopping'
  ```

  with:

  ```ts
  import { generateShoppingList, saveCheckedState, saveManualItems, resolveAndGenerateList, type ResolvedConflict, type GenerateResult } from './actions'
  import { CATEGORY_ORDER, type StoreAssignments, type ShoppingItem, type ManualItem, type UnitPreferences } from '@/lib/shopping'
  ```

- [ ] **Step 2: Add conflict state**

  In the component body, after the existing `const [stores, setStores] = useState` line, add:

  ```ts
  const [pendingConflicts, setPendingConflicts] = useState<{
    conflicts: ResolvedConflict[]
    suggestions: Record<string, number>
  } | null>(null)
  const [conflictSelections, setConflictSelections] = useState<Record<string, string>>({})
  ```

- [ ] **Step 3: Update `handleGenerate` to handle the discriminated union**

  Replace the existing `handleGenerate` function:

  ```ts
  function handleGenerate() {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setPendingUndo(null)
    setSwipeOpenKey(null)
    startTransition(async () => {
      const result: GenerateResult | null = await generateShoppingList(weekStart)
      if (!result) return

      if (result.type === 'conflicts') {
        // Pre-select suggested options
        const preSelections: Record<string, string> = {}
        for (const conflict of result.conflicts) {
          const suggested = conflict.options.find(o => o.isSuggested)
          if (suggested) preSelections[conflict.normalizedName] = suggested.unit
        }
        setConflictSelections(preSelections)
        setPendingConflicts({ conflicts: result.conflicts, suggestions: result.suggestions })
        return
      }

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
    })
  }
  ```

- [ ] **Step 4: Add `handleResolveConflicts`**

  After `handleGenerate`, add:

  ```ts
  function handleResolveConflicts() {
    if (!pendingConflicts) return

    const newPreferences: UnitPreferences = {}
    for (const conflict of pendingConflicts.conflicts) {
      const selectedUnit = conflictSelections[conflict.normalizedName]
      if (!selectedUnit) continue
      const selectedOption = conflict.options.find(o => o.unit === selectedUnit)
      if (!selectedOption) continue
      newPreferences[conflict.normalizedName] = {
        preferredUnit: selectedUnit,
        preferredFamily: selectedOption.family,
        factor: pendingConflicts.suggestions[conflict.normalizedName] ?? null,
      }
    }

    setPendingConflicts(null)
    setConflictSelections({})

    startTransition(async () => {
      const result = await resolveAndGenerateList(weekStart, newPreferences)
      if (!result) return
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
    })
  }
  ```

- [ ] **Step 5: Add the conflict resolution bottom sheet to the JSX**

  In the `return (...)` block, just before the closing `</div>` of the main container (the very last `</div>` before the component closes), add:

  ```tsx
  {/* Conflict resolution bottom sheet */}
  {pendingConflicts && (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl flex flex-col max-h-[70vh]">
        <div className="flex flex-col items-center pt-3 pb-3 px-4 border-b border-gray-100">
          <div className="w-10 h-1 bg-gray-300 rounded-full mb-3" />
          <h2 className="font-semibold text-gray-900 text-base">Review consolidated ingredients</h2>
          <p className="text-xs text-gray-500 mt-1 text-center">
            These ingredients appear in mixed units. Your choice will be remembered.
          </p>
        </div>
        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-3">
          {pendingConflicts.conflicts.map(conflict => (
            <div key={conflict.normalizedName} className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-gray-900">{conflict.displayName}</span>
              <select
                value={conflictSelections[conflict.normalizedName] ?? ''}
                onChange={e =>
                  setConflictSelections(prev => ({
                    ...prev,
                    [conflict.normalizedName]: e.target.value,
                  }))
                }
                className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900 bg-white"
              >
                {!conflictSelections[conflict.normalizedName] && (
                  <option value="" disabled>Choose unit…</option>
                )}
                {conflict.options.map(opt => (
                  <option key={opt.unit} value={opt.unit}>
                    {opt.displayQty}{opt.isSuggested ? ' (suggested)' : ''}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div className="px-4 pb-6 pt-3">
          <button
            onClick={handleResolveConflicts}
            disabled={
              isPending ||
              pendingConflicts.conflicts.some(c => !conflictSelections[c.normalizedName])
            }
            className="w-full py-3 bg-green-600 text-white font-semibold rounded-xl text-sm disabled:opacity-40 active:bg-green-700"
          >
            {isPending ? 'Building…' : 'Generate List'}
          </button>
        </div>
      </div>
    </>
  )}
  ```

- [ ] **Step 6: Verify the build passes**

  ```bash
  npx tsc --noEmit && npm run build
  ```

  Expected: successful build with no type errors.

- [ ] **Step 7: Commit**

  ```bash
  git add app/shopping/ShoppingClient.tsx
  git commit -m "feat: add conflict resolution UI to shopping list generation"
  ```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Cross-family conflict detection (other vs volume/weight) | Task 1, Step 4 |
| Known preferences resolved inline without surfacing | Task 1, Step 4 |
| Single batched Claude Haiku call for conversion factors | Task 2, Step 3 |
| `generateShoppingList` returns discriminated union | Task 2, Step 6 |
| Conflict resolution bottom sheet with dropdowns | Task 3, Step 5 |
| AI suggestion pre-selected in dropdown | Task 3, Step 3 |
| Generate List button disabled until all selections made | Task 3, Step 5 |
| `resolveAndGenerateList` merges + saves preferences to `households.preferences.unit_preferences` | Task 2, Step 7 |
| Happy path (no conflicts / all resolved) = single round-trip, no API call | Task 2, Step 6 (early return path) |
| Claude error → dropdowns with no pre-selection, user picks manually | Task 2, Step 4 (`isSuggested: false` when no factor) |
| Household preferences write failure → non-fatal, list still generated | Task 2, Step 7 (no `await` error check) |

**Placeholder scan:** None found. All steps have complete code.

**Type consistency check:**
- `ConflictItem.options` is a tuple `[other, measure]` — `computeConflictDisplay` in Task 2 Step 4 accesses `conflict.options[0]` and `conflict.options[1]` consistently.
- `UnitPreference.factor` is `number | null` — `buildStoreAssignments` checks `pref?.factor != null` before using it.
- `GenerateResult` union uses `type: 'success'` and `type: 'conflicts'` — both branches are handled in `handleGenerate` (Task 3 Step 3).
- `resolveAndGenerateList` returns `ShoppingListData | null` (not `GenerateResult`) — `handleResolveConflicts` (Task 3 Step 4) reads from it directly without a `type` discriminant check. ✓
