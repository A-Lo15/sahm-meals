# Pantry Staples Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users mark recurring ingredients (flour, olive oil, salt, etc.) as "always on hand" so they stop cluttering the shopping list, while keeping them accessible in a collapsed section in case they actually need to restock.

**Architecture:** A `pantry_staples text[]` column on `households` stores normalized ingredient names. The shopping list client filters items into visible/suppressed buckets client-side using the same `normalizeName` function the aggregation engine already uses. Two fire-and-forget server actions handle adding and removing staples optimistically.

**Tech Stack:** Next.js 14 App Router (server actions), Supabase Postgres (array column), React `useState`/`useTransition` for optimistic UI, existing `normalizeName` from `lib/shopping.ts`.

---

## Data Model

One migration on the `households` table:

```sql
alter table households
  add column if not exists pantry_staples text[] not null default '{}';
```

Staples are stored as **normalized ingredient names** using the existing `normalizeName()` function from `lib/shopping.ts` (e.g. `"Garlic cloves"` → `"garlic"`, `"Flours"` → `"flour"`). This means marking "Garlic" suppresses it regardless of how individual recipes spell it.

`normalizeName` must be exported from `lib/shopping.ts` (currently unexported) so server actions and the client component can share it.

---

## Server Actions

Two new actions added to `app/shopping/actions.ts`, following the existing `getContext()` pattern for household auth:

```typescript
export async function addPantryStaple(name: string): Promise<void>
export async function removePantryStaple(name: string): Promise<void>
```

Both normalize the incoming name before writing. Postgres array operations:
- **Add:** `update households set pantry_staples = array_append(pantry_staples, $normalized) where id = $householdId`
- **Remove:** `update households set pantry_staples = array_remove(pantry_staples, $normalized) where id = $householdId`

Neither calls `revalidatePath` — staples state is managed optimistically in the client.

`loadShoppingList` gains one extra field on its return type: `pantryStaples: string[]`. It reads `pantry_staples` from the `households` row it already fetches and returns it alongside the existing data. The server page (`app/shopping/page.tsx`) passes it to `ShoppingClient` as `initialStaples`.

---

## ShoppingClient Changes

**New prop:**
```typescript
initialStaples: string[]
```

**New state:**
```typescript
const [staples, setStaples] = useState(() => new Set(initialStaples))
const [staplesExpanded, setStaplesExpanded] = useState(false)
```

**Filtering (per store tab and All tab):** Suppressed items remain in `assignments` state — they are only excluded at render time, not removed from the state object. This ensures checked-state persistence via `scheduleSave` continues to work correctly for suppressed items. Before rendering, split each store's items into two display lists:
```typescript
const visible    = items.filter(item => !staples.has(normalizeName(item.name)))
const suppressed = items.filter(item =>  staples.has(normalizeName(item.name)))
```

Suppressed items are excluded from tab badge counts (remaining and total).

**"Mark as staple" button:** A small secondary icon button on every item row in both the per-store and All tabs, positioned between the item name and the quantity. Tapping it:
1. Optimistically adds to `staples` set (item immediately moves to suppressed list)
2. Fires `addPantryStaple(item.name)` inside `startTransition`

**"I have these" section:** Rendered below all visible category groups for the active tab. Only shown when `suppressed.length > 0`.

- **Collapsed state (default):** Single tappable row — `"I have these (N) ▸"` — in gray text. Tapping expands.
- **Expanded state:** Items rendered in a dimmed style (gray text, no category headers). Each item row has:
  - A checkbox (tapping checks it off in `assignments` and persists via `scheduleSave`, same as visible items)
  - Item name and quantity (dimmed)
  - An "unmark" icon button that:
    1. Optimistically removes from `staples` set (item moves back to visible list)
    2. Fires `removePantryStaple(item.name)` inside `startTransition`

The "I have these" section collapses back to its header when all items in it are unmarked.

---

## What Does Not Change

- `buildStoreAssignments` in `lib/shopping.ts` — no changes; filtering is client-side
- `ShoppingItem` type — no new fields
- The swipe-to-remove gesture — unchanged; the staple button is a separate tap target
- Manual items — can be marked as staples the same as recipe-derived items
- Checked state persistence — suppressed items that get checked still save via `scheduleSave` normally
- The conflict resolution flow — staple filtering runs after assignment generation, no interaction

---

## Scope

This feature does not include:
- A dedicated "manage staples" screen — the list builds organically from the shopping list
- Quantity thresholds or "running low" tracking
- Pre-seeded default staples list
