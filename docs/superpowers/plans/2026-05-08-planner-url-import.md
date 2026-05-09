# Planner URL Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a recipe URL to be pasted into the planner's recipe picker to import, save, and add the recipe to a day slot in one action — no Library detour required.

**Architecture:** URL detection is added to the existing search field in `PlannerClient`. When a URL is detected, the recipe list is replaced by an Import button. Tapping it calls the existing `/api/parse-recipe` endpoint, then a new `importAndAddToDay` server action that saves the recipe (state `tried`) and creates the meal plan slot atomically. On success the picker closes and an optimistic slot appears immediately; on parse failure the picker stays open with an inline error.

**Tech Stack:** Next.js 14 App Router, React 18, Supabase (via admin client in server actions), TypeScript

> **Note:** This project has no test framework installed. Verification steps use TypeScript compilation (`npm run build`) and manual browser testing via `npm run dev`.

---

### Task 1: Add `importAndAddToDay` server action

**Files:**
- Modify: `app/planner/actions.ts`

- [ ] **Step 1: Add the import for `ParsedRecipe` at the top of the file**

Open `app/planner/actions.ts`. After the existing imports, add:

```typescript
import type { ParsedRecipe } from '@/lib/parseRecipe'
```

The top of the file should now look like:

```typescript
'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ParsedRecipe } from '@/lib/parseRecipe'
```

- [ ] **Step 2: Add the `importAndAddToDay` server action**

Append this function at the end of `app/planner/actions.ts`:

```typescript
export async function importAndAddToDay(
  parsedRecipe: ParsedRecipe,
  mealPlanId: string,
  dayOfWeek: number
): Promise<{ recipeId: string; slotId: string }> {
  const { db, householdId } = await getContext()

  const { data: recipe, error: recipeError } = await db
    .from('recipes')
    .insert({
      household_id: householdId,
      title: parsedRecipe.title,
      description: parsedRecipe.description ?? null,
      default_servings: parsedRecipe.default_servings,
      source_url: parsedRecipe.source_url || null,
      source_image_url: parsedRecipe.source_image_url ?? null,
      ingredients: parsedRecipe.ingredients,
      instructions: parsedRecipe.instructions ?? null,
      original_parsed_json: parsedRecipe,
      state: 'tried',
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

  if (slotError) throw slotError

  revalidatePath('/planner')
  return { recipeId: recipe.id, slotId: slot.id }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run build
```

Expected: build succeeds with no type errors. (Ignore any pre-existing lint warnings unrelated to this change.)

- [ ] **Step 4: Commit**

```bash
git add app/planner/actions.ts
git commit -m "feat: add importAndAddToDay server action"
```

---

### Task 2: Add URL import flow to `PlannerClient`

**Files:**
- Modify: `app/planner/PlannerClient.tsx`

- [ ] **Step 1: Import `importAndAddToDay` and `ParsedRecipe`**

At the top of `app/planner/PlannerClient.tsx`, update the existing imports:

```typescript
import {
  addRecipeToDay,
  removeSlot,
  updateSlotServings,
  importAndAddToDay,
} from './actions'
import type { SlotWithRecipe, RecipeOption } from '@/lib/types'
import type { ParsedRecipe } from '@/lib/parseRecipe'
```

- [ ] **Step 2: Add `importing` and `importError` state**

Inside the `PlannerClient` component, alongside the existing `useState` declarations, add:

```typescript
const [importing, setImporting] = useState(false)
const [importError, setImportError] = useState<string | null>(null)
```

- [ ] **Step 3: Derive `importMode` from the search value**

Alongside the existing `filteredRecipes` derived value, add:

```typescript
const importMode = search.startsWith('http://') || search.startsWith('https://')
```

- [ ] **Step 4: Add `handleImport` function**

Add this function inside the component, after `handleServingsChange`:

```typescript
async function handleImport() {
  if (pickerDay === null) return
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
      return
    }
    recipe = (data as { recipe: ParsedRecipe }).recipe
  } catch {
    setImportError('Network error — check your connection and try again.')
    setImporting(false)
    return
  }

  // Parse succeeded — close picker and apply optimistic slot
  const tempId = `temp-${Date.now()}`
  const savedPickerDay = pickerDay

  const optimisticSlot: OptimisticSlot = {
    id: tempId,
    meal_plan_id: mealPlanId,
    recipe_id: '',
    day_of_week: savedPickerDay,
    servings_override: null,
    position: slots.filter((s) => s.day_of_week === savedPickerDay).length,
    recipe: {
      id: '',
      title: recipe.title,
      default_servings: recipe.default_servings,
      source_image_url: recipe.source_image_url,
      state: 'tried',
    },
    optimistic: true,
  }

  setSlots((prev) => [...prev, optimisticSlot])
  setPickerDay(null)
  setSearch('')
  setImporting(false)

  startTransition(async () => {
    try {
      const { recipeId, slotId } = await importAndAddToDay(recipe, mealPlanId, savedPickerDay)
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
    }
  })
}
```

- [ ] **Step 5: Update the picker's recipe list section to handle import mode**

Find the `{/* Recipe list */}` section inside the picker bottom sheet — it currently starts at:

```tsx
{/* Recipe list */}
<div className="overflow-y-auto flex-1 px-4 pb-6">
  {filteredRecipes.length === 0 ? (
    <p className="text-center text-sm text-gray-400 py-8">No recipes found</p>
  ) : (
```

Replace the entire recipe list `<div>` (from `{/* Recipe list */}` through its closing `</div>`) with:

```tsx
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
```

- [ ] **Step 6: Clear `importError` when the picker closes**

Find the two places where `setPickerDay(null)` and `setSearch('')` are called together (the backdrop click handler and the Cancel button). Update both to also clear the import error:

```tsx
// Backdrop
onClick={() => { setPickerDay(null); setSearch(''); setImportError(null) }}

// Cancel button
onClick={() => { setPickerDay(null); setSearch(''); setImportError(null) }}
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
npm run build
```

Expected: build succeeds with no type errors.

- [ ] **Step 8: Manual browser test — happy path**

```bash
npm run dev
```

1. Open the planner at `http://localhost:3000/planner`
2. Tap **+** on any day — the picker bottom sheet opens
3. Paste a recipe URL (e.g. from allrecipes.com or any recipe site) into the search field
4. Confirm the recipe list disappears and an **Import Recipe** button appears
5. Tap **Import Recipe** — button shows "Importing…"
6. After 3–15 seconds the picker closes and the recipe title appears as a slot on the day card with 60% opacity (optimistic)
7. After a moment the opacity becomes 100% (server confirmed)
8. Navigate to `/recipes` — confirm the recipe appears in "All Recipes" with state `tried` (not in Library tab)

- [ ] **Step 9: Manual browser test — error path**

1. Open the picker on any day
2. Paste a non-recipe URL (e.g. `https://google.com`) into the search field
3. Tap **Import Recipe**
4. Confirm an inline error message appears and the picker stays open
5. Tap **Cancel** — confirm the error clears and the picker closes

- [ ] **Step 10: Commit**

```bash
git add app/planner/PlannerClient.tsx
git commit -m "feat: add URL import to planner recipe picker"
```
