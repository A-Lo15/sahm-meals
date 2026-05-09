# Planner URL Import — Design Spec

**Date:** 2026-05-08

## Problem

Adding a new recipe to the weekly meal plan requires two separate flows: first navigate to the Library to import the recipe URL, then return to the planner and pick it. This back-and-forth is friction when the user discovers a new recipe while building their weekly plan.

## Goal

Allow a recipe URL to be imported directly from the planner's recipe picker, saving it to the recipe library and adding it to the selected day in one action.

## UX Flow

1. User taps **+** on a day card — the recipe picker bottom sheet opens.
2. User pastes a URL (starting with `http://` or `https://`) into the existing search field.
3. The recipe list is replaced by an **Import** button (no extra tabs or separate input fields).
4. User taps **Import** — button shows "Importing…" and is disabled.
5. On success: picker closes, the recipe slot appears on the day card immediately (optimistic update).
6. On failure: an inline error message appears inside the picker; it stays open so the user can retry or cancel.

## Decisions

- **Entry point:** Smart URL detection on the existing search field (no new UI chrome).
- **Post-import behavior:** Recipe is added to the day immediately; no confirmation step.
- **Recipe state:** Imported recipes are saved with `state: 'tried'` — they appear in "All Recipes" but not in "Library" until the user explicitly saves or favorites them.
- **Duplicates:** No duplicate detection. If the user imports a URL for a recipe already in their library, a second copy is created. Acceptable given the existing library has no deduplication either.

## Architecture

### Files changed

**`app/planner/PlannerClient.tsx`**
- Derive `importMode: boolean` from the search value (`search.startsWith('http')`).
- When `importMode` is true, render an Import button in place of the filtered recipe list.
- Add `handleImport()` async function:
  1. POST to `/api/parse-recipe` with the URL.
  2. On parse success, call new server action `importAndAddToDay` with the parsed recipe, `mealPlanId`, and `pickerDay`.
  3. Apply the same optimistic slot update used by `handleAdd`, then close the picker.
  4. On any failure, surface the error inline and leave the picker open.

**`app/planner/actions.ts`**
- Add server action `importAndAddToDay(parsedRecipe: ParsedRecipe, mealPlanId: string, dayOfWeek: number)` where `ParsedRecipe` is a new type defined in `lib/types.ts` with fields: `title: string`, `description?: string`, `default_servings: number`, `source_url?: string`, `source_image_url?: string`, `ingredients: Ingredient[]`, `instructions?: string`. This matches the shape returned by `/api/parse-recipe`.
  1. Insert the recipe into `recipes` with `state: 'tried'`, `household_id` from auth context, and all parsed fields (title, description, default_servings, source_url, source_image_url, ingredients, instructions, original_parsed_json).
  2. Insert the slot into `meal_plan_recipes` (same logic as existing `addRecipeToDay`).
  3. Return `{ recipeId, slotId }` so the client can resolve the optimistic slot.

### Files unchanged

- `app/api/parse-recipe/route.ts` — reused as-is
- `lib/parseRecipe.ts` — reused as-is
- `app/recipes/actions.ts` — reused as-is

## Data Flow

```
User pastes URL
  → PlannerClient detects URL pattern → shows Import button
  → User taps Import
  → POST /api/parse-recipe (existing route)
  → importAndAddToDay server action (new)
      → INSERT recipes (state: 'tried')
      → INSERT meal_plan_recipes
      → return { recipeId, slotId }
  → Client resolves optimistic slot, closes picker
```

## Error Handling

| Failure point | Behavior |
|---|---|
| Parse fails (bad URL, blocked site, AI fallback fails) | Show API error message inline; picker stays open |
| Save/slot fails (DB error) | Show generic error inline; picker stays open; nothing was persisted |
| Network error | Show generic error inline; picker stays open |
