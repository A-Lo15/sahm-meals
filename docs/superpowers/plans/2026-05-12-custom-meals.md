# Custom Meals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users enter a one-off meal directly from the planner — with a name, servings, and structured ingredient rows — and optionally save it to their recipe library; ingredients flow into the shopping list exactly like any library recipe.

**Architecture:** A new `in_library boolean` column on `recipes` (default `true`) marks whether a recipe appears in the library. Custom meals entered from the planner are stored as normal `Recipe` rows with `in_library = false` unless the user toggles "Save to library" ON. The shopping list generator needs zero changes — it joins `meal_plan_recipes → recipes` identically. The planner gets a second "+ Custom" button per day that opens a new `CustomMealSheet` bottom-sheet form component. Removing a custom meal slot also deletes its underlying recipe.

**Tech Stack:** Next.js 14 App Router, Supabase admin client, TypeScript, Tailwind CSS

---

### Task 1: Database migration — add `in_library` column

**Files:**
- Create: `supabase/migrations/004_in_library.sql`

This task is manual — the migration must be applied in the Supabase dashboard SQL editor.

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/004_in_library.sql
alter table recipes add column in_library boolean not null default true;
```

Because the column defaults to `true`, the `ALTER TABLE` backfills all existing rows to `true` automatically. No separate UPDATE needed.

- [ ] **Step 2: Apply in Supabase dashboard**

1. Open Supabase → SQL Editor → New query
2. Paste the contents of `supabase/migrations/004_in_library.sql`
3. Click Run
4. Verify: open Table Editor → `recipes` table → confirm `in_library` column exists and all rows show `true`

- [ ] **Step 3: Commit the migration file**

```bash
git add supabase/migrations/004_in_library.sql
git commit -m "feat: add in_library column to recipes"
```

---

### Task 2: Update TypeScript types

**Files:**
- Modify: `lib/types.ts`

This task adds `in_library` to `Recipe` and `SlotWithRecipe.recipe`, and adds `CustomMealInput`.

- [ ] **Step 1: Update `lib/types.ts`**

Replace the entire file with:

```typescript
export type RecipeState = 'tried' | 'saved' | 'favorited'

export type IngredientCategory =
  | 'produce'
  | 'dairy'
  | 'meat'
  | 'pantry'
  | 'frozen'
  | 'household'
  | 'other'
  | ''

export interface Ingredient {
  name: string
  quantity: string
  unit: string
  category: IngredientCategory
  notes: string
}

export interface CustomMealInput {
  title: string
  servings: number
  ingredients: Ingredient[]
  saveToLibrary: boolean
}

export interface MealPlan {
  id: string
  household_id: string
  week_start_date: string
  created_at: string
}

export interface SlotWithRecipe {
  id: string
  meal_plan_id: string
  recipe_id: string
  day_of_week: number
  servings_override: number | null
  position: number
  recipe: {
    id: string
    title: string
    default_servings: number
    source_image_url: string | null
    state: RecipeState
    in_library: boolean
  }
}

export interface RecipeOption {
  id: string
  title: string
  default_servings: number
  source_image_url: string | null
  state: RecipeState
}

export interface Recipe {
  id: string
  household_id: string
  title: string
  description: string | null
  default_servings: number
  source_url: string | null
  source_image_url: string | null
  ingredients: Ingredient[]
  instructions: string | null
  original_parsed_json: Record<string, unknown> | null
  state: RecipeState
  in_library: boolean
  last_cooked_at: string | null
  times_cooked: number
  created_at: string
  updated_at: string
}
```

- [ ] **Step 2: Verify build passes**

```bash
npm run build
```

Expected: Build succeeds. If TypeScript errors appear about `in_library` being used before the migration was applied, ignore — they are type-only and will resolve at runtime once the migration is in place.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add in_library to Recipe/SlotWithRecipe types, add CustomMealInput"
```

---

### Task 3: Update planner page queries

**Files:**
- Modify: `app/planner/page.tsx`

Two changes: (1) add `in_library` to the slot's nested recipe select so `PlannerClient` knows which slots are custom, and (2) filter the recipes list to `in_library = true` so the picker never shows non-library custom meals.

- [ ] **Step 1: Update `app/planner/page.tsx`**

Replace the `Promise.all` block (lines 46–61) with:

```typescript
  const [slotsResult, recipesResult] = await Promise.all([
    db
      .from('meal_plan_recipes')
      .select(
        `id, meal_plan_id, recipe_id, day_of_week, servings_override, position,
         recipe:recipes(id, title, default_servings, source_image_url, state, in_library)`
      )
      .eq('meal_plan_id', mealPlanId)
      .order('position'),

    db
      .from('recipes')
      .select('id, title, default_servings, source_image_url, state')
      .eq('household_id', householdId)
      .eq('in_library', true)
      .order('title'),
  ])
```

- [ ] **Step 2: Verify build passes**

```bash
npm run build
```

Expected: Build succeeds (TypeScript may warn that the nested `recipe` cast includes `in_library`; that's correct).

- [ ] **Step 3: Commit**

```bash
git add app/planner/page.tsx
git commit -m "feat: add in_library to slot query, filter picker to library recipes"
```

---

### Task 4: Add server actions — `createCustomMeal` and `removeSlotAndRecipe`

**Files:**
- Modify: `app/planner/actions.ts`

- [ ] **Step 1: Add imports to `app/planner/actions.ts`**

The file already has `import type { ParsedRecipe } from '@/lib/parseRecipe'`. Add a second import line directly below it:

```typescript
import type { CustomMealInput, SlotWithRecipe } from '@/lib/types'
```

- [ ] **Step 2: Add `createCustomMeal` to `app/planner/actions.ts`**

Append this function after `importAndAddToDay`:

```typescript
export async function createCustomMeal(
  mealPlanId: string,
  dayOfWeek: number,
  input: CustomMealInput
): Promise<SlotWithRecipe> {
  const { db, householdId } = await getContext()

  const { data: plan } = await db
    .from('meal_plans')
    .select('id')
    .eq('id', mealPlanId)
    .eq('household_id', householdId)
    .single()
  if (!plan) throw new Error('Meal plan not found or access denied')

  const { data: recipe, error: recipeError } = await db
    .from('recipes')
    .insert({
      household_id: householdId,
      title: input.title,
      description: null,
      default_servings: input.servings,
      source_url: null,
      source_image_url: null,
      ingredients: input.ingredients,
      instructions: null,
      original_parsed_json: null,
      state: 'saved',
      in_library: input.saveToLibrary,
    })
    .select('id')
    .single()
  if (recipeError) throw recipeError

  const { data: existing } = await db
    .from('meal_plan_recipes')
    .select('position')
    .eq('meal_plan_id', mealPlanId)
    .eq('day_of_week', dayOfWeek)
    .order('position', { ascending: false })
    .limit(1)
    .single()
  const nextPosition = existing ? existing.position + 1 : 0

  const { data: slot, error: slotError } = await db
    .from('meal_plan_recipes')
    .insert({
      meal_plan_id: mealPlanId,
      recipe_id: recipe.id,
      day_of_week: dayOfWeek,
      position: nextPosition,
    })
    .select('id')
    .single()

  if (slotError) {
    await db.from('recipes').delete().eq('id', recipe.id)
    throw slotError
  }

  revalidatePath('/planner')
  return {
    id: slot.id,
    meal_plan_id: mealPlanId,
    recipe_id: recipe.id,
    day_of_week: dayOfWeek,
    servings_override: null,
    position: nextPosition,
    recipe: {
      id: recipe.id,
      title: input.title,
      default_servings: input.servings,
      source_image_url: null,
      state: 'saved',
      in_library: input.saveToLibrary,
    },
  }
}
```

- [ ] **Step 3: Add `removeSlotAndRecipe` to `app/planner/actions.ts`**

Append this function immediately after `createCustomMeal`:

```typescript
export async function removeSlotAndRecipe(slotId: string, recipeId: string): Promise<void> {
  const { db } = await getContext()

  const { data: otherSlots } = await db
    .from('meal_plan_recipes')
    .select('id')
    .eq('recipe_id', recipeId)
    .neq('id', slotId)

  await db.from('meal_plan_recipes').delete().eq('id', slotId)

  if (!otherSlots || otherSlots.length === 0) {
    await db.from('recipes').delete().eq('id', recipeId)
  }

  revalidatePath('/planner')
}
```

- [ ] **Step 4: Verify build passes**

```bash
npm run build
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add app/planner/actions.ts
git commit -m "feat: add createCustomMeal and removeSlotAndRecipe server actions"
```

---

### Task 5: Create `CustomMealSheet` component

**Files:**
- Create: `app/planner/CustomMealSheet.tsx`

This is a bottom-sheet form component. It is a pure form: all it does is collect user input and call `onSave(input)`. The server action is called from `PlannerClient` (Task 6), matching the existing pattern for `handleAdd` and `handleConfirmImport`.

- [ ] **Step 1: Create `app/planner/CustomMealSheet.tsx`**

```typescript
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
```

- [ ] **Step 2: Verify build passes**

```bash
npm run build
```

Expected: Build succeeds. The component isn't wired up yet so no behavior change.

- [ ] **Step 3: Commit**

```bash
git add app/planner/CustomMealSheet.tsx
git commit -m "feat: add CustomMealSheet bottom-sheet form component"
```

---

### Task 6: Update `PlannerClient` — wire custom meals

**Files:**
- Modify: `app/planner/PlannerClient.tsx`

This task makes five changes:
1. Import `CustomMealSheet`, `createCustomMeal`, `removeSlotAndRecipe`, `CustomMealInput`
2. Add `customDay` state
3. Add `handleCustomMeal` function
4. Change `handleRemove(slotId)` → `handleRemove(slot)` to support `removeSlotAndRecipe`
5. Update the day header buttons and slot thumbnail rendering

- [ ] **Step 1: Update imports at top of `app/planner/PlannerClient.tsx`**

Replace:
```typescript
import {
  addRecipeToDay,
  removeSlot,
  updateSlotServings,
  importAndAddToDay,
} from './actions'
import type { SlotWithRecipe, RecipeOption } from '@/lib/types'
```

With:
```typescript
import {
  addRecipeToDay,
  removeSlot,
  removeSlotAndRecipe,
  updateSlotServings,
  importAndAddToDay,
  createCustomMeal,
} from './actions'
import type { SlotWithRecipe, RecipeOption, CustomMealInput } from '@/lib/types'
import CustomMealSheet from './CustomMealSheet'
```

- [ ] **Step 2: Add `customDay` state after the existing `pickerDay` state declaration**

Find:
```typescript
  const [pickerDay, setPickerDay] = useState<number | null>(null)
```

Add immediately after it:
```typescript
  const [customDay, setCustomDay] = useState<number | null>(null)
```

- [ ] **Step 3: Add `handleCustomMeal` function after `handleRemove`**

Find:
```typescript
  function handleRemove(slotId: string) {
    setSlots((prev) => prev.filter((s) => s.id !== slotId))
    startTransition(() => removeSlot(slotId))
  }
```

Replace the entire `handleRemove` function with:
```typescript
  function handleRemove(slot: OptimisticSlot) {
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
```

- [ ] **Step 4: Update the day header button — replace the single "+" with two buttons**

Find (inside the day card's header div, the single add button):
```tsx
                <button
                  onClick={() => setPickerDay(i)}
                  className="w-7 h-7 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 text-lg leading-none"
                  aria-label={`Add recipe to ${dayName}`}
                >
                  +
                </button>
```

Replace with:
```tsx
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
```

- [ ] **Step 5: Update slot thumbnail — show ✏️ for custom meals**

Find:
```tsx
                        {slot.recipe.source_image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={slot.recipe.source_image_url}
                            alt=""
                            className="w-11 h-11 rounded-lg object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-11 h-11 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 text-lg">
                            🍽
                          </div>
                        )}
```

Replace with:
```tsx
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
```

- [ ] **Step 6: Update the remove button call site**

Find:
```tsx
                          onClick={() => handleRemove(slot.id)}
```

Replace with:
```tsx
                          onClick={() => handleRemove(slot)}
```

- [ ] **Step 7: Add `CustomMealSheet` rendering**

Find the closing of the `ImportReviewModal` conditional render:
```tsx
      {pendingImport !== null && (
        <ImportReviewModal
          recipe={pendingImport.recipe}
          day={pendingImport.day}
          onConfirm={handleConfirmImport}
          onDismiss={handleDismissImport}
        />
      )}
```

Add immediately after it:
```tsx
      {customDay !== null && (
        <CustomMealSheet
          dayOfWeek={customDay}
          onClose={() => setCustomDay(null)}
          onSave={(input) => handleCustomMeal(customDay, input)}
        />
      )}
```

- [ ] **Step 8: Verify build passes**

```bash
npm run build
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add app/planner/PlannerClient.tsx
git commit -m "feat: wire CustomMealSheet and custom meal handling into PlannerClient"
```

---

### Task 7: Filter recipe library to `in_library = true`

**Files:**
- Modify: `app/recipes/page.tsx`

The library tab currently filters by `state in ('saved', 'favorited')`. The history tab shows all recipes with no state filter. Both need `in_library = true` added so custom planner meals don't pollute the recipe browsing screens.

The "this-week" tab intentionally does NOT get this filter — if a custom meal is planned this week, it should appear there.

- [ ] **Step 1: Update the library tab query in `app/recipes/page.tsx`**

Find:
```typescript
    } else {
      const { data } = await db
        .from('recipes')
        .select('*')
        .eq('household_id', householdId)
        .in('state', ['saved', 'favorited'])
        .order('updated_at', { ascending: false })
      recipes = (data as Recipe[]) ?? []
    }
```

Replace with:
```typescript
    } else {
      const { data } = await db
        .from('recipes')
        .select('*')
        .eq('household_id', householdId)
        .eq('in_library', true)
        .in('state', ['saved', 'favorited'])
        .order('updated_at', { ascending: false })
      recipes = (data as Recipe[]) ?? []
    }
```

- [ ] **Step 2: Update the history tab query in `app/recipes/page.tsx`**

Find:
```typescript
    } else if (tab === 'history') {
      const { data } = await db
        .from('recipes')
        .select('*')
        .eq('household_id', householdId)
        .order('updated_at', { ascending: false })
      recipes = (data as Recipe[]) ?? []
```

Replace with:
```typescript
    } else if (tab === 'history') {
      const { data } = await db
        .from('recipes')
        .select('*')
        .eq('household_id', householdId)
        .eq('in_library', true)
        .order('updated_at', { ascending: false })
      recipes = (data as Recipe[]) ?? []
```

- [ ] **Step 3: Verify build passes**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/recipes/page.tsx
git commit -m "feat: filter recipe library and history to in_library = true"
```

---

## Verification Checklist

After all tasks are complete, manually test the following in the running app (`npm run dev`):

- [ ] Planner shows "+ Library" and "+ Custom" buttons on each day
- [ ] Tapping "+ Custom" opens the custom meal sheet for that day
- [ ] Form: can enter name, servings, ingredient rows; "+ Add ingredient" appends a row
- [ ] Save button is disabled until name and at least one ingredient name are filled
- [ ] Saving with "Save to library" OFF: meal appears in planner with ✏️ icon; does NOT appear in recipe library or history
- [ ] Saving with "Save to library" ON: meal appears in planner with 🍽 icon; DOES appear in recipe library
- [ ] Custom meal ingredients appear in the shopping list when shopping list is generated
- [ ] Removing a custom meal (✏️) from the planner removes both the slot and the recipe from the DB
- [ ] Removing a library-saved custom meal (🍽) from the planner removes only the slot, not the recipe
- [ ] Recipe picker ("+  Library" sheet) does not show non-library custom meals
