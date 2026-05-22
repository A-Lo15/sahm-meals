# Planner Recipe Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to tap a recipe name in the planner to open a pre-filled edit form, choosing whether changes apply to just this week's slot or to the stored library recipe.

**Architecture:** Tapping a recipe title opens `RecipeScopeSheet` (scope picker), then `RecipeEditSheet` (pre-filled form). "This week only" calls `forkSlotRecipe` — which creates an `in_library=false` recipe copy and swaps the slot's `recipe_id` — while "Update library recipe" calls `updateRecipe` to edit in-place. No schema changes required; the custom meals pattern (`in_library=false`) handles the fork.

**Tech Stack:** Next.js 14 App Router, React `useState`/`useTransition`, Supabase admin client, Tailwind CSS, TypeScript.

---

## File Map

| File | Change |
|---|---|
| `lib/types.ts` | Add `RecipeEditInput`; extend `SlotWithRecipe.recipe` with `ingredients` + `instructions` |
| `app/planner/page.tsx` | Add `ingredients, instructions` to the nested recipe Supabase select |
| `app/planner/actions.ts` | Add `forkSlotRecipe`, `updateRecipe`; fix `createCustomMeal` return to include new fields |
| `app/planner/RecipeScopeSheet.tsx` | New — scope picker bottom sheet |
| `app/planner/RecipeEditSheet.tsx` | New — pre-filled edit form bottom sheet |
| `app/planner/PlannerClient.tsx` | Add imports, state, tappable title, `handleEditSave`, sheet rendering; fix optimistic slot shapes |

Tasks must be executed in order — each task's TypeScript changes build on the previous.

---

### Task 1: Update types and planner page query

**Files:**
- Modify: `lib/types.ts`
- Modify: `app/planner/page.tsx`

**Context:** `SlotWithRecipe.recipe` currently only selects `id, title, default_servings, source_image_url, state, in_library`. The edit form needs `ingredients` and `instructions` to pre-fill from planner state. We extend the type and the Supabase query together.

- [ ] **Step 1: Add `RecipeEditInput` and extend `SlotWithRecipe.recipe` in `lib/types.ts`**

Replace the existing `SlotWithRecipe` interface and add `RecipeEditInput` after `CustomMealInput`:

```typescript
export interface CustomMealInput {
  title: string
  servings: number
  ingredients: Ingredient[]
  saveToLibrary: boolean
}

export interface RecipeEditInput {
  title: string
  servings: number
  ingredients: Ingredient[]
  instructions: string | null
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
    ingredients: Ingredient[]
    instructions: string | null
  }
}
```

- [ ] **Step 2: Expand the Supabase nested recipe select in `app/planner/page.tsx`**

Find line 50–51 (the `.select(...)` call for slots) and add `ingredients, instructions` to the nested recipe select:

```typescript
    db
      .from('meal_plan_recipes')
      .select(
        `id, meal_plan_id, recipe_id, day_of_week, servings_override, position,
         recipe:recipes(id, title, default_servings, source_image_url, state, in_library, ingredients, instructions)`
      )
      .eq('meal_plan_id', mealPlanId)
      .order('position'),
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: TypeScript errors in `app/planner/PlannerClient.tsx` about missing `ingredients`/`instructions` fields on optimistic slot shapes (the type now requires them). These will be fixed in Task 5. The build may fail here — that is expected and will be resolved by Task 5. If errors appear only in `PlannerClient.tsx`, proceed.

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts app/planner/page.tsx
git commit -m "feat: extend SlotWithRecipe.recipe with ingredients and instructions"
```

---

### Task 2: Add server actions

**Files:**
- Modify: `app/planner/actions.ts`

**Context:** Two new actions needed. `forkSlotRecipe` creates an `in_library=false` recipe copy with edits applied and swaps the slot's `recipe_id` to point to it. `updateRecipe` edits the original recipe in-place. Also fix `createCustomMeal`'s hardcoded return object to include the new `ingredients`/`instructions` fields now required by the updated `SlotWithRecipe` type.

- [ ] **Step 1: Add `RecipeEditInput` to the import in `app/planner/actions.ts`**

Change line 8 from:
```typescript
import type { CustomMealInput, SlotWithRecipe } from '@/lib/types'
```
to:
```typescript
import type { CustomMealInput, RecipeEditInput, SlotWithRecipe } from '@/lib/types'
```

- [ ] **Step 2: Fix `createCustomMeal` return to include new recipe fields**

In `createCustomMeal` (around line 231), the hardcoded return object's `recipe` block is missing the two new fields. Update it:

```typescript
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
      ingredients: input.ingredients,
      instructions: null,
    },
  }
```

- [ ] **Step 3: Add `forkSlotRecipe` action at the end of `app/planner/actions.ts`**

```typescript
export async function forkSlotRecipe(
  slotId: string,
  recipeId: string,
  input: RecipeEditInput
): Promise<SlotWithRecipe> {
  const { db, householdId } = await getContext()

  const { data: original } = await db
    .from('recipes')
    .select('source_image_url')
    .eq('id', recipeId)
    .eq('household_id', householdId)
    .single()
  if (!original) throw new Error('Recipe not found or access denied')

  const { data: copy, error: copyError } = await db
    .from('recipes')
    .insert({
      household_id: householdId,
      title: input.title,
      description: null,
      default_servings: input.servings,
      source_url: null,
      source_image_url: original.source_image_url,
      ingredients: input.ingredients,
      instructions: input.instructions,
      original_parsed_json: null,
      state: 'saved',
      in_library: false,
    })
    .select('id')
    .single()
  if (copyError) throw copyError

  const { error: slotError } = await db
    .from('meal_plan_recipes')
    .update({ recipe_id: copy.id })
    .eq('id', slotId)

  if (slotError) {
    const { error: deleteError } = await db.from('recipes').delete().eq('id', copy.id)
    if (deleteError) console.error('Failed to clean up orphaned recipe copy', copy.id, deleteError)
    throw slotError
  }

  const { data: slot, error: fetchError } = await db
    .from('meal_plan_recipes')
    .select(
      `id, meal_plan_id, recipe_id, day_of_week, servings_override, position,
       recipe:recipes(id, title, default_servings, source_image_url, state, in_library, ingredients, instructions)`
    )
    .eq('id', slotId)
    .single()
  if (fetchError) throw fetchError

  revalidatePath('/planner')
  return slot as unknown as SlotWithRecipe
}
```

- [ ] **Step 4: Add `updateRecipe` action at the end of `app/planner/actions.ts`**

```typescript
export async function updateRecipe(
  recipeId: string,
  input: RecipeEditInput
): Promise<void> {
  const { db, householdId } = await getContext()

  const { error } = await db
    .from('recipes')
    .update({
      title: input.title,
      default_servings: input.servings,
      ingredients: input.ingredients,
      instructions: input.instructions,
    })
    .eq('id', recipeId)
    .eq('household_id', householdId)

  if (error) throw error

  revalidatePath('/planner')
  revalidatePath('/recipes')
}
```

- [ ] **Step 5: Commit**

```bash
git add app/planner/actions.ts
git commit -m "feat: add forkSlotRecipe and updateRecipe server actions"
```

---

### Task 3: Create `RecipeScopeSheet` component

**Files:**
- Create: `app/planner/RecipeScopeSheet.tsx`

**Context:** A minimal bottom sheet that presents two choices — "Edit this week's copy" or "Update library recipe" — before the edit form opens. Follows the same sheet pattern as `CustomMealSheet` (fixed overlay + rounded-top container).

- [ ] **Step 1: Create `app/planner/RecipeScopeSheet.tsx`**

```typescript
'use client'

interface Props {
  recipeName: string
  onSelectScope: (scope: 'week' | 'library') => void
  onClose: () => void
}

export default function RecipeScopeSheet({ recipeName, onSelectScope, onClose }: Props) {
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl">
        <div className="flex flex-col items-center pt-3 pb-2 px-4">
          <div className="w-10 h-1 bg-gray-300 rounded-full mb-3" />
          <div className="flex items-center justify-between w-full">
            <h2 className="font-semibold text-gray-900 text-base truncate">
              Edit {recipeName}
            </h2>
            <button onClick={onClose} className="text-gray-400 text-sm ml-3 flex-shrink-0">
              Cancel
            </button>
          </div>
        </div>
        <div className="px-4 pb-10 space-y-3">
          <button
            onClick={() => onSelectScope('week')}
            className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 active:bg-gray-100"
          >
            <p className="text-sm font-semibold text-gray-900">Edit this week&apos;s copy</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Only changes this week. Your library recipe stays as-is.
            </p>
          </button>
          <button
            onClick={() => onSelectScope('library')}
            className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 active:bg-gray-100"
          >
            <p className="text-sm font-semibold text-gray-900">Update library recipe</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Updates the saved recipe everywhere it&apos;s used.
            </p>
          </button>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: Build still fails on `PlannerClient.tsx` (optimistic slot shapes), but `RecipeScopeSheet.tsx` itself compiles cleanly — no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add app/planner/RecipeScopeSheet.tsx
git commit -m "feat: add RecipeScopeSheet scope picker component"
```

---

### Task 4: Create `RecipeEditSheet` component

**Files:**
- Create: `app/planner/RecipeEditSheet.tsx`

**Context:** Pre-filled edit form. Mirrors `CustomMealSheet`'s ingredient-row pattern (stable UUID keys, category dropdown) but initializes from `initialValues` instead of empty state. Adds an optional instructions textarea. The sheet title reflects the chosen scope.

- [ ] **Step 1: Create `app/planner/RecipeEditSheet.tsx`**

```typescript
'use client'

import { useState } from 'react'
import type { IngredientCategory, Ingredient, RecipeEditInput } from '@/lib/types'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
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
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: Still fails on `PlannerClient.tsx` only (missing fields on optimistic slot shapes). `RecipeEditSheet.tsx` compiles cleanly.

- [ ] **Step 3: Commit**

```bash
git add app/planner/RecipeEditSheet.tsx
git commit -m "feat: add RecipeEditSheet pre-filled edit form component"
```

---

### Task 5: Wire everything into `PlannerClient`

**Files:**
- Modify: `app/planner/PlannerClient.tsx`

**Context:** Six changes to make: (1) new imports, (2) new `editSlot`/`editScope` state, (3) fix optimistic slot shapes to include the new `ingredients`/`instructions` fields, (4) make recipe title tappable, (5) add `handleEditSave`, (6) render the two new sheets. Apply them all in one pass since they're in one file.

- [ ] **Step 1: Update imports at the top of `PlannerClient.tsx`**

Change the existing import block to add the three new action imports, the new type, and the two new components:

```typescript
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
```

- [ ] **Step 2: Add `editSlot` and `editScope` state**

After the existing `const [customDay, setCustomDay] = useState<number | null>(null)` line, add:

```typescript
  const [editSlot, setEditSlot] = useState<OptimisticSlot | null>(null)
  const [editScope, setEditScope] = useState<'week' | 'library' | null>(null)
```

- [ ] **Step 3: Fix optimistic slot shapes to include `ingredients` and `instructions`**

Three places need updating. The `recipe` object in each optimistic slot must now include the two new fields.

In `handleAdd` (around line 78):
```typescript
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
```

In `handleCustomMeal` (around line 122):
```typescript
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
```

In `handleConfirmImport` (around line 224):
```typescript
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
```

- [ ] **Step 4: Add `handleEditSave` function**

Add this after `handleServingsChange`:

```typescript
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
            ? { ...s, recipe: { ...s.recipe, ...input, in_library: false } }
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
            prev.map((s) => (s.id === slot.id ? { ...s, recipe: { ...slot.recipe } } : s))
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
```

- [ ] **Step 5: Make the recipe title tappable**

In the slot render block (around line 392), replace the existing `<p>` title element:

```tsx
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {slot.recipe.title}
                          </p>
```

with:

```tsx
                          <button
                            onClick={() => { if (!slot.optimistic) setEditSlot(slot) }}
                            disabled={!!slot.optimistic}
                            className="text-sm font-medium text-gray-900 truncate text-left w-full underline decoration-dotted decoration-gray-300 underline-offset-2 disabled:no-underline"
                          >
                            {slot.recipe.title}
                          </button>
```

- [ ] **Step 6: Render the two new sheets**

After the `{customDay !== null && <CustomMealSheet ... />}` block (around line 447), add:

```tsx
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
```

- [ ] **Step 7: Verify build passes cleanly**

```bash
npm run build
```

Expected: Clean build, zero TypeScript errors, all routes compile.

- [ ] **Step 8: Manual smoke test**

Start the dev server (`npm run dev`) and verify:
1. Recipe name in a day card has a dotted underline
2. Tapping a library recipe name opens the scope picker with two buttons
3. Choosing "Edit this week's copy" opens the pre-filled edit form with correct title, servings, and ingredients
4. Editing and saving shows the ✏️ icon on the slot
5. Choosing "Update library recipe" opens the edit form; saving does not change the slot's icon
6. Tapping a custom/forked slot (✏️) skips the scope picker and opens the edit form directly
7. Tapping during an optimistic in-flight slot does nothing

- [ ] **Step 9: Commit**

```bash
git add app/planner/PlannerClient.tsx
git commit -m "feat: wire recipe edit flow into planner — tappable titles, scope picker, edit form"
```
