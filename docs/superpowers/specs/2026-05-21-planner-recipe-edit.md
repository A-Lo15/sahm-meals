# Planner Recipe Edit — Design Spec

**Date:** 2026-05-21

## Problem

When a user imports a recipe into the weekly planner and later wants to make a change (different quantity, swapped ingredient, etc.), there is no in-context edit path. They must remove the recipe and re-import it, making edits on the second pass.

## Goal

Allow users to tap a recipe name in the planner day card to open a pre-filled edit form. Before editing, the user chooses whether the changes apply only to this week's slot or to the stored library recipe.

---

## UX Flow

### 1. Trigger

Each recipe slot's title in the day card gains a dotted underline to signal it is tappable. Tapping the title opens `RecipeScopeSheet` anchored to that slot.

Custom meal slots (`in_library: false`) that have already been forked skip the scope picker and go directly to `RecipeEditSheet` (they have no library version to update).

### 2. Scope Picker (`RecipeScopeSheet`)

A bottom sheet with two choices:

| Button | Label | Sub-label |
|---|---|---|
| Primary | Edit this week's copy | Only changes this week. Your library recipe stays as-is. |
| Secondary | Update library recipe | Updates the saved recipe everywhere it's used. |

Tapping either option closes the scope picker and opens `RecipeEditSheet` with the chosen scope.

### 3. Edit Form (`RecipeEditSheet`)

A pre-filled bottom sheet form matching the visual style of `CustomMealSheet`:

| Field | Type | Pre-filled from |
|---|---|---|
| Meal name | text input | `slot.recipe.title` |
| Servings | number input | `slot.recipe.default_servings` |
| Ingredient rows | qty / unit / name / category | `slot.recipe.ingredients` |
| Instructions | textarea (optional) | `slot.recipe.instructions` |

The "+ Add ingredient" link appends an empty row. Rows with a blank name are ignored on save.

**Save button** label: `"Save changes"`. Disabled until meal name is non-empty and at least one ingredient row has a name.

**Cancel** link dismisses the sheet without saving.

### 4. After Save

- **"This week only"**: slot switches to `in_library: false`, gains ✏️ icon and dashed border (same treatment as custom meals). The library recipe is unchanged.
- **"Update library recipe"**: slot continues to show 🍽 icon with solid border. The library recipe is updated everywhere it appears.

---

## Data Model

No schema changes required.

**"This week only"** reuses the existing custom meals pattern:
1. Insert a new `recipes` row — copy of the original with edits applied, `in_library = false`.
2. Update the `meal_plan_recipes` row: set `recipe_id` to the new copy's id.
3. The original recipe row is untouched.

**"Update library recipe"**:
1. Update the original `recipes` row in-place with the edited fields.
2. No slot changes needed.

---

## Types (`lib/types.ts`)

```typescript
export interface RecipeEditInput {
  title: string
  servings: number
  ingredients: Ingredient[]
  instructions: string | null
}
```

`SlotWithRecipe.recipe` must be extended to include `ingredients` and `instructions` so the edit form can pre-fill from planner state without a separate fetch:

```typescript
// In SlotWithRecipe.recipe (nested type):
ingredients: Ingredient[]
instructions: string | null
```

The planner page query (`app/planner/page.tsx`) must also select these fields in the `recipe:recipes(...)` nested select.

---

## Server Actions (`app/planner/actions.ts`)

### `forkSlotRecipe`

```typescript
export async function forkSlotRecipe(
  slotId: string,
  recipeId: string,
  input: RecipeEditInput
): Promise<SlotWithRecipe>
```

1. Verify the original recipe belongs to the caller's household.
2. Insert a new `recipes` row with `in_library = false`, `source_url = null`, `state = 'saved'`, and fields from `input`.
3. Update `meal_plan_recipes` row: set `recipe_id` = new recipe id.
4. If the slot update fails, delete the orphaned recipe copy.
5. Query and return the full `SlotWithRecipe` for the updated slot.
6. `revalidatePath('/planner')`.

### `updateRecipe`

```typescript
export async function updateRecipe(
  recipeId: string,
  input: RecipeEditInput
): Promise<void>
```

1. Verify the recipe belongs to the caller's household.
2. Update `recipes` row with fields from `input`.
3. `revalidatePath('/planner')`.
4. `revalidatePath('/recipes')`.

---

## Components

### `RecipeScopeSheet` (`app/planner/RecipeScopeSheet.tsx`)

**Props:**
```typescript
interface Props {
  recipeName: string
  onSelectScope: (scope: 'week' | 'library') => void
  onClose: () => void
}
```

Renders two scope buttons and a cancel option. No state of its own.

### `RecipeEditSheet` (`app/planner/RecipeEditSheet.tsx`)

**Props:**
```typescript
interface Props {
  scope: 'week' | 'library'
  initialValues: RecipeEditInput
  dayName: string
  onSave: (input: RecipeEditInput) => void
  onClose: () => void
}
```

- Ingredient rows use stable IDs (`crypto.randomUUID()`) as keys, same as `CustomMealSheet`.
- `IngredientRow.category` typed as `IngredientCategory` (already includes `''`).
- `canSave = title.trim() !== '' && rows.some(r => r.name.trim() !== '')`.
- Filters empty-name rows before calling `onSave`.
- Sheet title: `"Edit — this week only"` or `"Edit — library recipe"` based on scope.

---

## `PlannerClient` Changes (`app/planner/PlannerClient.tsx`)

### New state

```typescript
const [editSlot, setEditSlot] = useState<OptimisticSlot | null>(null)
const [editScope, setEditScope] = useState<'week' | 'library' | null>(null)
```

### Tappable recipe title

```tsx
<button
  onClick={() => { if (!slot.optimistic) setEditSlot(slot) }}
  className="recipe-title-button"
>
  {slot.recipe.title}
</button>
```

Optimistic slots are not tappable (no real recipe to edit yet).

### Scope picker skip for custom meals

When `editSlot` is set and `editSlot.recipe.in_library === false`, skip `RecipeScopeSheet` and open `RecipeEditSheet` directly with `scope = 'week'`.

### `handleEditSave`

```typescript
async function handleEditSave(input: RecipeEditInput) {
  if (!editSlot || !editScope) return
  const scope = editScope
  const slot = editSlot
  setEditSlot(null)
  setEditScope(null)

  if (scope === 'week') {
    // optimistic: update slot in state with new title + in_library=false
    setSlots(prev => prev.map(s =>
      s.id === slot.id
        ? { ...s, recipe: { ...s.recipe, ...input, in_library: false } }
        : s
    ))
    startTransition(async () => {
      const updated = await forkSlotRecipe(slot.id, slot.recipe_id, input)
      setSlots(prev => prev.map(s => s.id === slot.id ? { ...updated, optimistic: false } : s))
    })
  } else {
    // optimistic: update slot in state with new title, keep in_library
    setSlots(prev => prev.map(s =>
      s.id === slot.id
        ? { ...s, recipe: { ...s.recipe, ...input } }
        : s
    ))
    startTransition(() => updateRecipe(slot.recipe_id, input))
  }
}
```

### Sheet rendering

```tsx
{editSlot && !editScope && editSlot.recipe.in_library && (
  <RecipeScopeSheet
    recipeName={editSlot.recipe.title}
    onSelectScope={setEditScope}
    onClose={() => setEditSlot(null)}
  />
)}

{editSlot && (editScope || !editSlot.recipe.in_library) && (
  <RecipeEditSheet
    scope={editScope ?? 'week'}
    initialValues={{
      title: editSlot.recipe.title,
      servings: editSlot.recipe.default_servings,
      ingredients: editSlot.recipe.ingredients,
      instructions: editSlot.recipe.instructions ?? null,
    }}
    dayName={DAY_NAMES[editSlot.day_of_week]}
    onSave={handleEditSave}
    onClose={() => { setEditSlot(null); setEditScope(null) }}
  />
)}
```

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| User taps title on an in-flight optimistic slot | Button is disabled (`slot.optimistic` check) — no edit possible until slot resolves |
| User edits a slot that already has `in_library: false` (custom meal or prior fork) | Scope picker skipped, opens edit form directly with `scope = 'week'` |
| `forkSlotRecipe` fails after recipe insert but before slot update | Compensating delete removes orphaned recipe copy |
| User edits a library recipe used in multiple weeks | All slots pointing to that recipe show the updated data after revalidation |
| User edits this week's copy, then wants to restore original | Navigate to `/recipes/[id]` — existing "Reset to original" action available (future: could add quick reset from planner) |

---

## Files Changed

| File | Action | Purpose |
|---|---|---|
| `lib/types.ts` | Modify | Add `RecipeEditInput` type; add `ingredients` and `instructions` to `SlotWithRecipe.recipe` |
| `app/planner/page.tsx` | Modify | Add `ingredients, instructions` to the nested recipe select in the slots query |
| `app/planner/actions.ts` | Modify | Add `forkSlotRecipe` and `updateRecipe` server actions |
| `app/planner/RecipeScopeSheet.tsx` | Create | Scope picker bottom sheet |
| `app/planner/RecipeEditSheet.tsx` | Create | Pre-filled recipe edit form |
| `app/planner/PlannerClient.tsx` | Modify | Tappable title, edit state, sheet rendering, `handleEditSave` |
