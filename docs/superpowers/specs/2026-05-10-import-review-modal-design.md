# Import Review Modal — Design Spec

**Date:** 2026-05-10

## Problem

When importing a recipe URL directly from the planner, the parsed ingredient list is saved verbatim with no opportunity to adjust quantities, swap ingredients, or remove items before the recipe is added to the week. Users have to navigate to the recipe detail view after the fact to make corrections.

## Goal

After a URL is parsed successfully, show a full-screen review screen where the user can edit the recipe title, serving count, and the full ingredient list (quantities, units, names, and add/remove rows) before the recipe is saved and added to the day.

## UX Flow

1. User pastes a URL into the planner picker search field — "Import Recipe" button appears (existing behavior).
2. User taps "Import Recipe" → button shows "Importing…" (existing behavior).
3. Parse succeeds → picker closes → `ImportReviewModal` slides up full-screen.
4. Modal shows:
   - Editable recipe title (text input, pre-filled from parse)
   - Editable serving count (numeric stepper or input, pre-filled from parse)
   - Scrollable ingredient list: each row has qty / unit / name fields inline and a × delete button
   - "+ Add ingredient" button below the list that appends a blank row
5. Footer:
   - **"Import as-is"** (left) — adds with the original parsed data, no edits applied
   - **"Add to [Day]"** (right, primary, disabled until title is non-empty) — adds with whatever edits were made
6. × button and backdrop tap → `onDismiss` — import abandoned, nothing saved, no slot added.
7. Either confirm path → modal closes, optimistic slot appears on the day card, `importAndAddToDay` fires in the background with the appropriate recipe data.
8. Parse failure path is unchanged — inline error in the picker, review modal never opens.

## Architecture

### Files changed

**New: `app/planner/ImportReviewModal.tsx`**

Client component. Owns all editing state. No server actions called here — it only manages local form state and fires callbacks.

Props:
```typescript
interface ImportReviewModalProps {
  recipe: ParsedRecipe
  day: number
  onConfirm: (edited: ParsedRecipe) => void
  onDismiss: () => void
}
```

On mount, initializes three pieces of local state from props:
- `title: string` ← `recipe.title`
- `servings: number` ← `recipe.default_servings`
- `ingredients: Ingredient[]` ← deep copy of `recipe.ingredients`

"Add to [Day]" calls `onConfirm({ ...recipe, title, default_servings: servings, ingredients })` after stripping blank rows (rows where `name.trim() === ''`).

"Import as-is" calls `onConfirm(recipe)` (the original prop, untouched).

× and backdrop call `onDismiss`.

The modal is rendered as `position: fixed; inset: 0; z-index: 60` — full viewport, slides up from the bottom with a CSS translate animation.

**Modify: `app/planner/PlannerClient.tsx`**

- Add state: `pendingImport: { recipe: ParsedRecipe; day: number } | null` (initialized `null`).
- In `handleImport`, after a successful parse response, instead of immediately calling `importAndAddToDay`, call `setPendingImport({ recipe: parsed, day: savedPickerDay })` and close the picker (`setPickerDay(null)`, `setSearch('')`, `setImporting(false)`, `importingRef.current = false`).
- Add `handleConfirmImport(editedRecipe: ParsedRecipe)`:
  1. Read `pendingImport.day` for the target day.
  2. Apply an optimistic slot (same pattern as today's `handleImport` post-parse block).
  3. `setPendingImport(null)`.
  4. `startTransition(() => importAndAddToDay(editedRecipe, mealPlanId, day))`.
- Add `handleDismissImport()`: `setPendingImport(null)` only — no slot added, nothing saved.
- Render `<ImportReviewModal>` when `pendingImport !== null`, passing `recipe`, `day`, `onConfirm={handleConfirmImport}`, `onDismiss={handleDismissImport}`.

**`app/planner/actions.ts`** — no changes. `importAndAddToDay` already accepts `ParsedRecipe` and saves whatever is passed.

## Data Flow

```
Parse succeeds
  → setPendingImport({ recipe, day })
  → ImportReviewModal mounts with local copy of ingredients

User edits + taps "Add to [Day]"
  → onConfirm(editedRecipe)
  → handleConfirmImport:
      → apply optimistic slot
      → setPendingImport(null)           ← modal unmounts
      → importAndAddToDay(editedRecipe)  ← in startTransition

User taps "Import as-is"
  → onConfirm(originalRecipe)           ← same path, no edits applied

User taps × or backdrop
  → onDismiss → setPendingImport(null)  ← modal unmounts, nothing saved
```

## Edge Cases

| Scenario | Behavior |
|---|---|
| User adds a row but leaves name blank | Row is stripped before `onConfirm` is called — not saved |
| Title cleared | "Add to [Day]" button disabled until title is non-empty |
| Backdrop / × during edit | `onDismiss` fires — no recipe saved, no optimistic slot added |
| `importAndAddToDay` fails after confirm | Optimistic slot rolled back (same behavior as today) |
| Parse fails | Unchanged — inline error in picker, modal never opens |
