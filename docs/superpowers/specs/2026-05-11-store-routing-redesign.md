# Store Routing Redesign — Design Spec

**Date:** 2026-05-11

## Problem

The shopping list auto-assigns every ingredient to a store based on a hardcoded category→store map (`STORE_FOR_CATEGORY`). Users cannot change where an item is purchased, the store list is hardcoded to three specific stores, and there is no way to add, remove, or configure stores.

## Goal

Two deliverables, built in sequence:

1. **Slice 1 — Configurable Store Management:** Replace the hardcoded store list with a user-managed bank of stores persisted in the database. Users add and delete stores from a "My Stores" settings screen.
2. **Slice 2 — Routing Redesign:** Replace the automatic per-tab assignment with a unified "All" tab showing every item with a store badge. Users tap a badge to re-route any item to any store. Per-store tabs remain for shopping (checking off items). Routing decisions are remembered across weeks.

---

## Slice 1 — Configurable Store Management

### Data Model

New table `stores`:

```sql
id            uuid primary key default gen_random_uuid()
household_id  uuid not null references households(id)
name          text not null
abbreviation  text not null
display_order int  not null default 0
created_at    timestamptz not null default now()
```

**Abbreviation derivation algorithm** (computed at creation time, stored):
- Multi-word name: first letter of each word, uppercase, max 3 characters. E.g. "Whole Foods" → "WF", "Trader Joe's" → "TJ", "Sprouts Farmers Market" → "SFM".
- Single-word name: first 2 characters, title case. E.g. "Costco" → "Co", "Sprouts" → "Sp".
- Apostrophes are ignored when splitting words: "Sam's Club" → split on space → "SC".

**Seeding:** A migration inserts the three current stores for all existing households:

| name | abbreviation | display_order |
|---|---|---|
| Whole Foods | WF | 0 |
| Sam's Club | SC | 1 |
| Trader Joe's | TJ | 2 |

New households (created after this migration) receive the same three default stores.

**`lib/shopping.ts` changes:**
- Remove the `STORES` const and `StoreName` type. All code that previously imported `StoreName` uses `string` instead.
- `ManualItem.store` changes from `StoreName` to `string`.
- `StoreAssignments` changes from `Record<StoreName, ShoppingItem[]>` to `Record<string, ShoppingItem[]>`.
- The `STORE_FOR_CATEGORY` map remains (used as a category fallback) but its values are now advisory store *names* that must be matched against the household's actual store list at runtime.

### Server Actions (`app/shopping/stores-actions.ts` — new file)

```typescript
export async function getStores(): Promise<Store[]>
export async function createStore(name: string): Promise<Store>
export async function deleteStore(id: string): Promise<void>
```

`Store` type (exported from `lib/stores.ts`):
```typescript
export interface Store {
  id: string
  name: string
  abbreviation: string
  displayOrder: number
}

export function deriveAbbreviation(name: string): string
```

### UX — My Stores Screen

Entry point: a ⚙ icon button in the shopping list header, to the left of the existing "+" button.

Route: `/shopping/stores` — a new Next.js page (server component) that loads the household's stores and renders a `StoresClient` client component.

The screen shows:
- A list of current stores, each row displaying the abbreviation pill and store name with a ✕ delete button on the right.
- A simple "Add a store" section at the bottom: a text input + "Add" button. The Add button is disabled when the input is empty.
- A hint below the list: *"Items routed to a deleted store will be re-routed by category on the next list build."*

**Delete behavior:** Deleting a store is immediate (optimistic UI, server action fires). There is no confirmation dialog — the hint text sets expectations. Items currently in `store_assignments` for a deleted store are not modified; they will be re-routed on the next `generateShoppingList` call.

**Constraints:** A household must keep at least one store. The delete button is hidden when only one store remains.

---

## Slice 2 — Routing Redesign

### Routing Memory

When `generateShoppingList` runs, it derives routing for each item as follows:

1. Load the household's current stores from the `stores` table.
2. Load the most recent prior `store_assignments` from the current week's shopping list (if one exists).
3. Build a `priorRouteMap: Map<string, string>` mapping `normalizedItemName → storeName` from the prior assignments.
4. For each aggregated item in the new list:
   - If `priorRouteMap` has the item's normalized name **and** that store name still exists in the household's current store list → use it.
   - Otherwise → look up `STORE_FOR_CATEGORY[category]`. If that store name exists in the current store list → use it.
   - Otherwise → use the first store in the household's list (`display_order ASC`).

Manual items (added via "+") are not affected by this logic — they always carry an explicit store assignment chosen at add time.

### `ShoppingListData` changes

```typescript
export interface ShoppingListData {
  id: string
  storeAssignments: StoreAssignments   // Record<string, ShoppingItem[]>
  generatedAt: string
  mealPlanId: string
  manualItems: ManualItem[]
  stores: Store[]                       // ordered list of household stores
}
```

`loadShoppingList` and `generateShoppingList` both load the household's stores and include them in the returned data. `ShoppingClient` receives stores as a prop (`initialStores: Store[]`) and does not need to fetch them separately.

### `buildStoreAssignments` signature change

```typescript
export function buildStoreAssignments(
  slots: RawSlot[],
  stores: Store[],
  priorRouteMap: Map<string, string>
): StoreAssignments
```

The function initialises `StoreAssignments` with an empty array for each store name (replacing the hardcoded `STORES` initialisation), then uses `priorRouteMap` + `STORE_FOR_CATEGORY` + store-list fallback to route each item.

### UX — Shopping List

#### Tab bar

The tab bar is now dynamic, built from `stores` (ordered by `display_order`):

```
[ All | <store1.abbreviation> | <store2.abbreviation> | … ]
```

The tab bar scrolls horizontally when the stores overflow the screen width. Active tab indicator is the existing green underline.

The "All" tab shows `unchecked/total` across all stores combined (or "✓ done" when everything is checked). Each store tab shows `unchecked/total` (or "✓ done" when all checked), exactly as today.

The `activeTab` state is `string`. The sentinel value `'all'` represents the All tab; any other value is a store name. Default active tab on load: `'all'`.

#### "All" tab

Shows every item across all stores, grouped by category. Each item row displays:
- Item name (full width)
- Quantity + unit (right-aligned, secondary text)
- Store badge: abbreviated store name in a colored pill with a "›" indicator. Tap to open the re-route sheet.

No check circles on the "All" tab — checked items appear with strikethrough text (same visual treatment as checked items in store tabs) but cannot be toggled from this view. Swipe-to-remove is disabled on the All tab. The All tab is for routing only; checking off happens in per-store tabs.

#### Re-route mini-sheet

Tapping a store badge opens a bottom sheet anchored to the item:
- Title: `"<ItemName> — send to:"`
- Lists all stores by full name with their abbreviation pill. The currently assigned store shows a green ✓ checkmark.
- Tapping a different store: closes the sheet immediately, moves the item to the new store in `assignments` state, calls `scheduleSave`.
- Tapping the current store or dismissing via backdrop: closes with no change.

#### Per-store tabs

Identical to the current design: items grouped by category, check circles, swipe-to-remove with 4-second undo. No store badges shown (the tab itself communicates the store context).

#### Manual item add sheet ("+" button)

The store picker in the add-item bottom sheet replaces the hardcoded three-button row with a dynamic list built from `stores`, showing full name + abbreviation. Default selection: first store in `stores`.

### Re-route action (`rerouteItem`)

```typescript
function rerouteItem(item: ShoppingItem, fromStore: string, toStore: string): void
```

- Removes `item` from `assignments[fromStore]`
- Appends `item` to `assignments[toStore]`
- Calls `scheduleSave(listId, updatedAssignments)`
- If `item.manual && item.manualId`: also updates `manualItems` state (change `store` field) and calls `saveManualItems`

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| Store deleted that has routed items | Items remain in `store_assignments` until next `generateShoppingList`; on next build they are re-routed via category fallback or first-store fallback |
| Prior store no longer in store list (routing memory) | Category fallback used; if category default also gone, first store in list |
| Single store remaining | Delete button hidden; user cannot remove last store |
| `generateShoppingList` on a week with no prior list | All items routed by category fallback (no prior route map) |
| Manual item re-routed via "All" tab | Both `assignments` and `manualItems` state updated; `saveManualItems` called |
| Store list empty on page load (race condition) | Falls back gracefully to showing no store tabs; "Build List" disabled |

---

## Files Changed

### Slice 1

| File | Action | Purpose |
|---|---|---|
| `lib/stores.ts` | Create | `Store` type, `deriveAbbreviation()` |
| `app/shopping/stores-actions.ts` | Create | `getStores`, `createStore`, `deleteStore` server actions |
| `app/shopping/stores/page.tsx` | Create | My Stores server page (loads stores, renders `StoresClient`) |
| `app/shopping/stores/StoresClient.tsx` | Create | Client component: store list, add input, delete buttons |
| `lib/shopping.ts` | Modify | Remove `STORES` const + `StoreName` type; `ManualItem.store: string`; `StoreAssignments: Record<string, ShoppingItem[]>` |
| `app/shopping/ShoppingClient.tsx` | Modify | Add ⚙ button linking to `/shopping/stores`; replace `StoreName` with `string` throughout |
| `app/shopping/actions.ts` | Modify | Import `Store` from `lib/stores`; add `stores: Store[]` to `ShoppingListData`; load stores in `loadShoppingList` and `generateShoppingList` |
| `app/shopping/page.tsx` | Modify | Pass `initialStores` to `ShoppingClient` |
| Supabase migration | Create | Create `stores` table; seed 3 default stores for existing households |

### Slice 2

| File | Action | Purpose |
|---|---|---|
| `lib/shopping.ts` | Modify | `buildStoreAssignments` takes `stores: Store[]` + `priorRouteMap`; dynamic store initialisation |
| `app/shopping/actions.ts` | Modify | `generateShoppingList` builds `priorRouteMap` from prior assignments; both actions return `stores` in result |
| `app/shopping/ShoppingClient.tsx` | Modify | "All" tab with store badges; re-route mini-sheet; dynamic tab bar; `rerouteItem()`; dynamic store picker in add sheet |
