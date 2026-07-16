# Responsive Shopping List Store Tabs

## Problem

On the Shopping List page (`app/shopping/ShoppingClient.tsx:469-512`), the per-store tabs ("All", "WF", "SC", "TJ", ...) are `flex-shrink-0` with `overflow-x-auto`. They only ever render `store.abbreviation` and never grow to fill the row, leaving unused horizontal space when there are few stores.

## Goals

- Tabs fill the available horizontal width of the row, splitting it evenly, instead of scrolling.
- Tab sizing (padding/font) shrinks gracefully as more stores are added or the container narrows.
- When there's enough room, show the full store name (`store.name`) instead of the abbreviation.

## Design

**Layout**: Each tab (including "All") becomes `flex-1 min-w-0` so the row always fills its container. Remove `overflow-x-auto` / `flex-shrink-0`.

**Measurement**: A `ResizeObserver` on the tab row container computes:

```
avgTabWidth = containerWidth / tabCount   // tabCount = stores.length + 1 for "All"
```

This reacts both to container resizes and to store count changes (re-measured on `stores` change), which a CSS/viewport breakpoint approach can't do since tab count is data-driven, not viewport-driven.

**Discrete tiers** (chosen over continuous per-label text measurement for simplicity):

| avgTabWidth | Label | Sizing |
|---|---|---|
| ≥ 100px | `store.name` (full) | `px-4 py-3 text-xs` (current) |
| 64–99px | `store.abbreviation` | `px-4 py-3 text-xs` (current) |
| < 64px | `store.abbreviation` | `px-2 py-2 text-[11px]` (compact) |

The "All" tab always shows "All" but follows the same sizing tier as its siblings for visual consistency.

## Non-goals

- No changes to `lib/stores.ts` abbreviation derivation logic.
- No changes to the Stores management page (`StoresClient.tsx`).
- No per-label pixel-accurate text measurement (canvas/hidden-span) — tiers are based on average available width per tab, not each label's actual rendered width.

## Testing

- Manually verify in browser at a few store counts (2, 4, 6+ stores) and a couple of viewport widths that tabs fill the row and transition tiers as expected.
- No new unit tests needed; this is a presentational change with no new business logic beyond the resize observer wiring.
