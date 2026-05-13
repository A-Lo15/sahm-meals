# Custom Meals — Design Spec

**Date:** 2026-05-12

## Problem

Users sometimes want to plan a meal that isn't in their recipe library — something written down at home or improvised. Currently the only way to add a meal to the planner is to pick from the library or import a URL. There is no way to enter a one-off meal with ingredients that flow into the shopping list.

## Goal

Allow users to manually enter a custom meal from the planner — with a name, servings, and structured ingredient rows — and have its ingredients aggregated into the shopping list exactly like any library recipe. Users choose at creation time whether to save the meal to their recipe library for future reuse.

---

## Data Model

### `recipes` table — new column

```sql
ALTER TABLE recipes ADD COLUMN in_library boolean NOT NULL DEFAULT true;
```

**Backfill:** All existing recipes get `in_library = true` (the migration sets the default and backfills in one step).

A custom meal entered from the planner is stored as a normal `Recipe` row with `in_library = false` (unless the user toggled "Save to library" ON, in which case `in_library = true`).

Because custom meals are stored as recipes, they link into `meal_plan_recipes` identically to library recipes. The shopping list generator requires **no changes** — it already queries `meal_plan_recipes → recipes → ingredients`.

### `Recipe` type (`lib/types.ts`)

Add `inLibrary: boolean` to the existing `Recipe` interface.

### `CustomMealInput` type (new, `lib/types.ts`)

```typescript
export interface CustomMealInput {
  title: string
  servings: number
  ingredients: Array<{
    name: string
    quantity: number | null
    unit: string
    category: IngredientCategory | ''
  }>
  saveToLibrary: boolean
}
```

---

## Server Actions (`app/planner/actions.ts`)

### New: `createCustomMeal`

```typescript
export async function createCustomMeal(
  mealPlanId: string,
  dayOfWeek: number,
  input: CustomMealInput
): Promise<SlotWithRecipe>
```

1. Insert a new row into `recipes` with `in_library = input.saveToLibrary`, `default_servings = input.servings`, `ingredients = input.ingredients`, `source_url = null`, `description = null`, `instructions = null`, `state = 'saved'`.
2. Insert a `meal_plan_recipes` row linking the new recipe to `mealPlanId` + `dayOfWeek` (same position logic as `addRecipeToDay`).
3. Return the full `SlotWithRecipe` for optimistic UI.

### New: `removeSlotAndRecipe`

```typescript
export async function removeSlotAndRecipe(slotId: string, recipeId: string): Promise<void>
```

Deletes the `meal_plan_recipes` row, then deletes the `recipes` row. Used only for custom meals (`inLibrary: false`) — library recipes use the existing `removeSlot`.

---

## UX — Planner

### "+ Custom" button

Each day card in the planner gains a second add button alongside the existing recipe-picker button:

```
[ + From library ]  [ + Custom ]
```

Tapping "+ Custom" opens `CustomMealSheet` anchored to that day.

### `CustomMealSheet` — new client component (`app/planner/CustomMealSheet.tsx`)

A bottom sheet form with the following fields:

| Field | Type | Required | Default |
|---|---|---|---|
| Meal name | text input | Yes | — |
| Servings | number input | Yes | 4 |
| Ingredient rows | see below | At least 1 | one empty row |
| Save to library toggle | boolean | — | OFF |

**Ingredient rows** — each row has four fields in a single line:

```
[ Qty ] [ Unit ] [ Name _____________ ] [ Category ▾ ]
```

- Qty: number (can be blank for "to taste")
- Unit: free text (oz, cups, cloves, etc.)
- Name: free text (required per row)
- Category: dropdown using the same `IngredientCategory` values as the existing recipe form (`produce`, `dairy`, `meat`, `pantry`, `frozen`, `household`, `other`)

An "+ Add ingredient" link appends a new empty row. Rows with a blank Name are ignored on save.

**Save to library toggle** — displayed at the bottom of the form above the save button:

> **Save to my library** — Reuse this meal in future weeks *(toggle, default OFF)*

**Save button** label: `"Add to [Day name]"`. Disabled until Meal name is non-empty and at least one ingredient row has a Name.

On save: calls `createCustomMeal`, closes the sheet, appends the new slot to local state optimistically.

### Custom meal appearance in planner

Custom meals (`inLibrary: false`) display identically to library recipes in the day card — same row layout with servings adjuster and remove button — except the thumbnail placeholder shows ✏️ instead of 🍽 to signal it's a custom entry.

If `inLibrary: true` (user toggled "Save to library" ON), the meal shows the standard 🍽 placeholder and is indistinguishable from a library recipe in the planner view.

### Removing a custom meal

When the user taps ✕ on a slot:
- If `slot.recipe.inLibrary === false`: calls `removeSlotAndRecipe(slot.id, slot.recipe.id)` — deletes both the slot and the underlying recipe.
- If `slot.recipe.inLibrary === true`: calls the existing `removeSlot(slot.id)` — only removes the slot.

---

## Recipe Library

The recipes list page filters to `in_library = true` only. Custom meals with `inLibrary: false` do not appear in the library.

Recipes saved to library (`inLibrary: true`) via the custom meal form appear in the library immediately and can be edited, favorited, and reused like any other recipe.

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| User enters a custom meal, saves to library, then removes it from the planner | `removeSlot` only (library recipe, recipe row preserved) |
| User regenerates shopping list — custom meal is still in plan | Ingredients included normally (same `meal_plan_recipes → recipes` join) |
| Custom meal with no ingredients saved | Save button is disabled — not possible |
| User wants to "save to library" after creation | Navigate to the recipe detail page (`/recipes/[id]`) and it will be editable; a future feature could add a quick "save to library" action from the planner pill |
| `removeSlotAndRecipe` called but recipe is referenced by another slot | Won't happen in practice — custom meals are created per-slot and never reused. Add a guard in the action to only delete if no other `meal_plan_recipes` rows reference the recipe |

---

## Files Changed

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/004_in_library.sql` | Create | Add `in_library` column, backfill existing rows to `true` |
| `lib/types.ts` | Modify | Add `inLibrary: boolean` to `Recipe`; add `CustomMealInput` type |
| `app/planner/actions.ts` | Modify | Add `createCustomMeal` and `removeSlotAndRecipe` server actions |
| `app/planner/CustomMealSheet.tsx` | Create | Bottom sheet form component |
| `app/planner/PlannerClient.tsx` | Modify | Add "+ Custom" button; wire `CustomMealSheet`; use `removeSlotAndRecipe` for custom slots; show ✏️ for custom meal thumbnail |
| `app/recipes/page.tsx` | Modify | Filter recipe list to `in_library = true` |
