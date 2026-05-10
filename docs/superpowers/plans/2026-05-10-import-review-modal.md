# Import Review Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a recipe URL is parsed from the planner picker, show a full-screen review screen where the user can edit the title, serving count, and ingredient list (name, quantity, unit, add/remove rows) before the recipe is saved and added to the day.

**Architecture:** A new `ImportReviewModal` component owns all editing state and fires `onConfirm(editedRecipe)` or `onDismiss()` callbacks. `PlannerClient` gains a `pendingImport` state; when a parse succeeds, instead of immediately calling `importAndAddToDay`, it sets `pendingImport` and renders the modal. The existing `importAndAddToDay` server action is unchanged — it receives whatever recipe data the modal produces.

**Tech Stack:** TypeScript, Next.js 14 App Router, React 18. No test framework — verification is `npm run build` and manual browser testing.

---

### Task 1: Create `ImportReviewModal` component

**Files:**
- Create: `app/planner/ImportReviewModal.tsx`

- [ ] **Step 1: Create the component file**

Create `app/planner/ImportReviewModal.tsx` with the following content:

```typescript
'use client'

import { useState } from 'react'
import type { ParsedRecipe } from '@/lib/parseRecipe'
import type { Ingredient } from '@/lib/types'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface ImportReviewModalProps {
  recipe: ParsedRecipe
  day: number
  onConfirm: (edited: ParsedRecipe) => void
  onDismiss: () => void
}

export default function ImportReviewModal({
  recipe,
  day,
  onConfirm,
  onDismiss,
}: ImportReviewModalProps) {
  const [title, setTitle] = useState(recipe.title)
  const [servings, setServings] = useState(recipe.default_servings)
  const [ingredients, setIngredients] = useState<Ingredient[]>(() =>
    recipe.ingredients.map((i) => ({ ...i }))
  )

  function updateIngredient(
    index: number,
    field: 'name' | 'quantity' | 'unit',
    value: string
  ) {
    setIngredients((prev) =>
      prev.map((ing, i) => (i === index ? { ...ing, [field]: value } : ing))
    )
  }

  function removeIngredient(index: number) {
    setIngredients((prev) => prev.filter((_, i) => i !== index))
  }

  function addIngredient() {
    setIngredients((prev) => [
      ...prev,
      { name: '', quantity: '', unit: '', category: 'other', notes: '' },
    ])
  }

  function handleConfirm() {
    const cleaned = ingredients.filter((i) => i.name.trim() !== '')
    onConfirm({
      ...recipe,
      title: title.trim(),
      default_servings: servings,
      ingredients: cleaned,
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200">
        <button
          onClick={onDismiss}
          className="w-8 h-8 flex items-center justify-center text-gray-400"
          aria-label="Close"
        >
          ✕
        </button>
        <h2 className="font-semibold text-gray-900 text-base">Review Recipe</h2>
        <div className="w-8" />
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-6">
        {/* Title */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1.5 w-full px-4 py-2.5 bg-gray-100 rounded-xl text-base focus:outline-none"
          />
        </div>

        {/* Servings */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Servings
          </label>
          <div className="flex items-center gap-4 mt-1.5">
            <button
              onClick={() => setServings((s) => Math.max(1, s - 1))}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-600 text-xl leading-none"
              aria-label="Decrease servings"
            >
              −
            </button>
            <span className="text-base font-medium text-gray-900 w-6 text-center">
              {servings}
            </span>
            <button
              onClick={() => setServings((s) => s + 1)}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-600 text-xl leading-none"
              aria-label="Increase servings"
            >
              +
            </button>
          </div>
        </div>

        {/* Ingredients */}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Ingredients
          </label>
          <div className="mt-2 space-y-2">
            {ingredients.map((ing, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={ing.quantity}
                  onChange={(e) => updateIngredient(i, 'quantity', e.target.value)}
                  placeholder="Qty"
                  className="w-14 px-2 py-2 bg-gray-100 rounded-lg text-sm focus:outline-none text-center"
                />
                <input
                  type="text"
                  value={ing.unit}
                  onChange={(e) => updateIngredient(i, 'unit', e.target.value)}
                  placeholder="Unit"
                  className="w-16 px-2 py-2 bg-gray-100 rounded-lg text-sm focus:outline-none text-center"
                />
                <input
                  type="text"
                  value={ing.name}
                  onChange={(e) => updateIngredient(i, 'name', e.target.value)}
                  placeholder="Ingredient"
                  className="flex-1 px-2 py-2 bg-gray-100 rounded-lg text-sm focus:outline-none"
                />
                <button
                  onClick={() => removeIngredient(i)}
                  className="w-6 text-gray-300 text-sm flex-shrink-0"
                  aria-label="Remove ingredient"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={addIngredient}
            className="mt-3 text-sm text-blue-600 font-medium"
          >
            + Add ingredient
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-gray-200 flex gap-3">
        <button
          onClick={() => onConfirm(recipe)}
          className="flex-1 py-3 bg-gray-100 text-gray-700 font-semibold rounded-xl text-sm active:bg-gray-200"
        >
          Import as-is
        </button>
        <button
          onClick={handleConfirm}
          disabled={!title.trim()}
          className="flex-1 py-3 bg-green-600 text-white font-semibold rounded-xl text-sm disabled:opacity-50 active:bg-green-700"
        >
          Add to {DAYS[day]}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```

Expected: build succeeds with no type errors. `ImportReviewModal` is not yet used anywhere, so there may be a "module declared but not used" note — that is fine and expected.

- [ ] **Step 3: Commit**

```bash
git add app/planner/ImportReviewModal.tsx
git commit -m "feat: add ImportReviewModal component for pre-save ingredient editing"
```

---

### Task 2: Wire `ImportReviewModal` into `PlannerClient`

**Files:**
- Modify: `app/planner/PlannerClient.tsx`

Context on the current file: `PlannerClient.tsx` is the main planner client component at `app/planner/PlannerClient.tsx`. The current `handleImport` function (lines 110–192) fetches `/api/parse-recipe`, and on success immediately applies an optimistic slot and calls `importAndAddToDay`. This task replaces the post-parse success block with a `setPendingImport` call and adds `handleConfirmImport` / `handleDismissImport` to handle the modal callbacks.

- [ ] **Step 1: Add the `ImportReviewModal` import**

At the top of `app/planner/PlannerClient.tsx`, add one import after the existing local imports:

```typescript
import ImportReviewModal from './ImportReviewModal'
```

The full imports block should now look like:

```typescript
import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  addRecipeToDay,
  removeSlot,
  updateSlotServings,
  importAndAddToDay,
} from './actions'
import type { SlotWithRecipe, RecipeOption } from '@/lib/types'
import type { ParsedRecipe } from '@/lib/parseRecipe'
import ImportReviewModal from './ImportReviewModal'
```

- [ ] **Step 2: Add `pendingImport` state**

Inside the `PlannerClient` component, alongside the existing `useState` declarations (after `importingRef`), add:

```typescript
const [pendingImport, setPendingImport] = useState<{ recipe: ParsedRecipe; day: number } | null>(null)
```

The state declarations block should now look like:

```typescript
const [slots, setSlots] = useState<OptimisticSlot[]>(initialSlots)
const [, startTransition] = useTransition()
const [pickerDay, setPickerDay] = useState<number | null>(null)
const [search, setSearch] = useState('')
const [pickerTab, setPickerTab] = useState<'library' | 'all'>('library')
const [importing, setImporting] = useState(false)
const [importError, setImportError] = useState<string | null>(null)
const importingRef = useRef(false)
const [pendingImport, setPendingImport] = useState<{ recipe: ParsedRecipe; day: number } | null>(null)
```

- [ ] **Step 3: Replace the post-parse block in `handleImport`**

Find the comment `// Parse succeeded — close picker and apply optimistic slot` in `handleImport` (currently around line 145). Replace everything from that comment to the end of the function with:

```typescript
    // Parse succeeded — show review modal
    const savedPickerDay = pickerDay
    setPickerDay(null)
    setSearch('')
    setImporting(false)
    importingRef.current = false
    setPendingImport({ recipe, day: savedPickerDay })
  }
```

The complete `handleImport` function should now read:

```typescript
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
```

- [ ] **Step 4: Add `handleConfirmImport` and `handleDismissImport`**

Directly after `handleImport` (and before the `// ── Picker filtering` comment), add these two functions:

```typescript
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
      }
    })
  }

  function handleDismissImport() {
    setPendingImport(null)
  }
```

- [ ] **Step 5: Render `<ImportReviewModal>` in the JSX**

At the very end of the returned JSX, just before the closing `</div>` of the outer `min-h-screen` container, add:

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

The end of the component's return statement should now look like:

```tsx
      {/* Recipe picker bottom sheet */}
      {pickerDay !== null && (
        <>
          ...existing picker JSX...
        </>
      )}

      {pendingImport !== null && (
        <ImportReviewModal
          recipe={pendingImport.recipe}
          day={pendingImport.day}
          onConfirm={handleConfirmImport}
          onDismiss={handleDismissImport}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npm run build
```

Expected: build succeeds with no type errors or warnings.

- [ ] **Step 7: Manual browser test — edit path**

```bash
npm run dev
```

1. Open `http://localhost:3000/planner`
2. Tap **+** on any day — picker opens
3. Paste a recipe URL (e.g. from allrecipes.com) into the search field
4. Tap **Import Recipe** — button shows "Importing…" and picker closes when parse finishes
5. Confirm the full-screen **Review Recipe** screen slides up
6. Edit the recipe title — confirm the input is responsive
7. Tap **−** and **+** on servings — confirm count changes
8. Change a quantity on one ingredient row
9. Tap **✕** on one ingredient row — confirm row disappears
10. Tap **+ Add ingredient** — confirm a blank row appears at the bottom; fill in a name
11. Tap **Add to [Day]** — confirm modal closes, recipe slot appears on the day card with edited title
12. Navigate to `/recipes` and open the recipe — confirm the edited title, serving count, and ingredient list are saved correctly

- [ ] **Step 8: Manual browser test — "Import as-is" path**

1. Open the picker, paste a URL, tap **Import Recipe**
2. On the review screen, make some edits to ingredients
3. Tap **Import as-is** — confirm modal closes and slot appears; navigate to `/recipes` and confirm the saved recipe has the original unedited ingredient list

- [ ] **Step 9: Manual browser test — dismiss path**

1. Open the picker, paste a URL, tap **Import Recipe**
2. On the review screen, tap **✕** (top-left close button)
3. Confirm modal closes, no slot was added to the day, and no recipe appears in `/recipes`

- [ ] **Step 10: Manual browser test — disabled state**

1. Open review screen for any recipe
2. Clear the title input completely
3. Confirm **Add to [Day]** button becomes visually disabled and cannot be tapped

- [ ] **Step 11: Commit**

```bash
git add app/planner/PlannerClient.tsx
git commit -m "feat: wire ImportReviewModal into planner — review before save on URL import"
```
