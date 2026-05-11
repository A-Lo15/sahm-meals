# Shopping List Manual Items — Design Spec

**Date:** 2026-05-10

## Problem

The shopping list only contains ingredients aggregated from the week's meal plan recipes. Users have no way to add one-off items — snacks, household extras, or anything that doesn't map to a full recipe — without checking them off on a separate list.

## Goal

Allow the user to add manual (one-off) items to any given week's shopping list. Manual items persist through list regeneration, check off and swipe-to-remove identically to recipe items, and are scoped to the week they were added (not a standing/recurring list).

## UX Flow

1. A small "+" button appears in the shopping list header, to the left of the Regenerate button. It is hidden when no list has been built yet.
2. Tapping "+" opens a bottom sheet with four fields:
   - **Name** (text input, required)
   - **Quantity** (text input, optional)
   - **Unit** (text input, optional)
   - **Store** (segmented picker: Whole Foods / Sam's Club / Trader Joe's)
3. Tapping **Add**: sheet closes, item appears immediately in the selected store's tab, change is persisted to DB.
4. Manual items are visually indistinguishable from recipe items — they check off and swipe-to-remove identically.
5. Tapping **Cancel** or the backdrop dismisses the sheet with no changes.

## Architecture

### Data Model

No schema migration needed. The `shopping_lists` table already has:

```sql
manual_overrides jsonb not null default '{}'::jsonb
-- current usage: { added: [], removed: [], moved: [] }
```

Manual items are stored in `manual_overrides.added` as an array of `ManualItem` objects:

```typescript
interface ManualItem {
  id: string        // uuid — stable identity for removal
  store: StoreName
  name: string
  quantity: string  // empty string if not provided
  unit: string      // empty string if not provided
}
```

`ShoppingItem` gains an optional `manual?: boolean` flag (stored in the JSONB, no migration required):

```typescript
interface ShoppingItem {
  name: string
  quantity: string
  unit: string
  category: IngredientCategory
  checked: boolean
  manual?: boolean   // true for user-added items
  manualId?: string  // matches ManualItem.id, present when manual === true
}
```

### Category Assignment

Manual items are assigned `category: 'other'` at add time. They appear in the "Other" section of their chosen store's grouped list.

### Files Changed

**`lib/types.ts`**
- Add `manual?: boolean` and `manualId?: string` to `ShoppingItem`
- Export new `ManualItem` interface

**`app/shopping/actions.ts`**
- Add `saveManualItems(listId: string, items: ManualItem[]): Promise<void>` — writes `{ added: items }` to `manual_overrides`
- Update `loadShoppingList` to also return `manualItems: ManualItem[]` from `manual_overrides.added`; merge manual items into `storeAssignments` before returning, deduplicating by `manualId` so items already present in `store_assignments` are not doubled (handles the case where a debounced `scheduleSave` didn't fire before navigation)
- Update `generateShoppingList` to load `manual_overrides.added` after building fresh assignments and merge manual items in, preserving their existing checked state from the prior `store_assignments` where possible (fall back to `checked: false` if not found)

**`app/shopping/ShoppingClient.tsx`**
- Add `initialManualItems: ManualItem[]` to Props
- Add state: `manualItems: ManualItem[]`
- Add state: `addSheetOpen: boolean`, `newItemName: string`, `newItemQty: string`, `newItemUnit: string`, `newItemStore: StoreName`
- Add `addManualItem()` handler: creates ManualItem with `crypto.randomUUID()`, merges ShoppingItem into `assignments[store]`, updates `manualItems`, saves both via `saveManualItems` and `scheduleSave`
- Update `removeItem()`: when `item.manual === true`, also removes from `manualItems` state immediately, but defers `saveManualItems` to the undo timer callback (same pattern as `scheduleSave`) so an undo within 4 seconds can restore both states without a DB write
- Render "+" button in header (hidden when `!listId`)
- Render bottom sheet when `addSheetOpen === true`

### Data Flow

```
User taps "+"
  → addSheetOpen = true
  → User fills form, taps Add
  → addManualItem():
      → new ManualItem created (uuid)
      → assignments[store] += ShoppingItem { manual: true, manualId }
      → manualItems += ManualItem
      → saveManualItems(listId, manualItems)   ← updates manual_overrides
      → scheduleSave(listId, assignments)       ← updates store_assignments

User regenerates list
  → generateShoppingList():
      → builds fresh store_assignments from recipes
      → loads manual_overrides.added
      → merges each ManualItem into fresh assignments as ShoppingItem
      → saves combined result to store_assignments
      → returns merged assignments + manualItems

User removes a manual item
  → removeItem(store, index):
      → if item.manual: remove from manualItems state immediately
      → existing undo logic runs for the assignments state
      → on undo timer expiry: scheduleSave(listId, assignments)
                             + saveManualItems(listId, updatedManualItems)

User removes a manual item then regenerates before undo expires
  → handleGenerate clears undoTimer (existing behavior)
  → item is still in manual_overrides (saveManualItems hasn't been called yet)
  → generateShoppingList re-merges item back in
  → item reappears — safe and consistent
```

## Edge Cases

| Scenario | Behavior |
|---|---|
| Regenerate while manual items exist | `generateShoppingList` re-merges from `manual_overrides.added` — items survive |
| Remove manual item, undo before 4s | Timer cleared; `assignments` and `manualItems` state both restored; no DB write to `manual_overrides` occurred |
| Remove manual item, undo timer expires | `scheduleSave` removes item from `store_assignments`; `saveManualItems` removes item from `manual_overrides` |
| Remove manual item then regenerate before undo | Timer cleared by `handleGenerate`; item still in `manual_overrides`; reappears after regenerate |
| Quantity/unit blank | Saved as empty strings; item displays as just the name |
| No list built yet | "+" button hidden — `listId` is null until list is built |
| Name blank | "Add" button disabled until name has non-whitespace content |
