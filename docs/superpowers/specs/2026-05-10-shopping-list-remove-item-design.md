# Shopping List Remove Item — Design Spec

**Date:** 2026-05-10

## Problem

The shopping list has no way to remove an item without checking it off. When a user already has an ingredient from a previous week, they want to dismiss it from the list entirely rather than marking it purchased.

## Goal

Allow any item on the shopping list to be permanently removed (for the current week's list) via a swipe-left gesture, with a brief undo window to recover accidental removals.

## UX Flow

1. User swipes a shopping item row left — the row translates to reveal a red "Remove" button on the trailing edge.
2. Tapping **Remove**: the row disappears; a toast bar slides up from the bottom showing "[Item name] removed" with an **Undo** button.
3. Tapping **Undo** within 4 seconds: item is restored to its original position, toast disappears, no DB write occurs.
4. After 4 seconds with no Undo: the deletion is committed to the DB via the existing `saveCheckedState` action, toast disappears.
5. Only one row can be swiped open at a time — starting a swipe on a new row snaps the previously-open row closed.

## Architecture

### Files changed

**`app/shopping/ShoppingClient.tsx`** — the only file that changes.

#### New state

```typescript
const [swipeOpenKey, setSwipeOpenKey] = useState<string | null>(null)
const [pendingUndo, setPendingUndo] = useState<{
  item: ShoppingItem
  store: StoreName
  index: number
} | null>(null)
const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
```

`swipeOpenKey` is formatted as `"${store}-${globalIndex}"` to uniquely identify a row.

#### Swipe gesture

Each item row receives inline touch handlers:

- `onTouchStart`: records `touchStartX`.
- `onTouchMove`: computes `deltaX = currentX - touchStartX`. Only responds to leftward movement (`deltaX < 0`). Applies `transform: translateX(max(-REMOVE_BTN_WIDTH, deltaX))` via inline style, clamped so the row never slides further than the button width (64px).
- `onTouchEnd`: if `deltaX < -40` (swipe threshold), sets `swipeOpenKey` to this row's key (snapping any other open row closed); otherwise snaps this row back to 0.

The row's CSS transition is disabled during active dragging and re-enabled on touch end for the snap animation.

#### `removeItem(store: StoreName, index: number)`

```typescript
function removeItem(store: StoreName, index: number) {
  if (!assignments || !listId) return

  const item = assignments[store][index]

  // Commit any previous pending removal immediately before starting a new one.
  // `assignments` at this point already reflects the prior removal (setAssignments
  // is called synchronously before this handler runs again).
  if (pendingUndo && undoTimer.current) {
    clearTimeout(undoTimer.current)
    scheduleSave(listId, assignments)
  }

  const updated: StoreAssignments = {
    ...assignments,
    [store]: assignments[store].filter((_, i) => i !== index),
  }
  setAssignments(updated)
  setSwipeOpenKey(null)
  setPendingUndo({ item, store, index })

  undoTimer.current = setTimeout(() => {
    scheduleSave(listId, updated)
    setPendingUndo(null)
  }, 4000)
}
```

#### `undoRemove()`

```typescript
function undoRemove() {
  if (!pendingUndo || !assignments) return
  if (undoTimer.current) clearTimeout(undoTimer.current)

  const { item, store, index } = pendingUndo
  const restored = [...assignments[store]]
  restored.splice(index, 0, item)
  setAssignments({ ...assignments, [store]: restored })
  setPendingUndo(null)
}
```

#### Undo toast

Rendered when `pendingUndo !== null`:

```tsx
{pendingUndo && (
  <div className="fixed bottom-4 left-4 right-4 z-50 flex items-center justify-between bg-gray-900 text-white px-4 py-3 rounded-2xl shadow-lg">
    <span className="text-sm">{pendingUndo.item.name} removed</span>
    <button onClick={undoRemove} className="text-sm font-semibold text-green-400 ml-4">
      Undo
    </button>
  </div>
)}
```

### Files unchanged

- `app/shopping/actions.ts` — `saveCheckedState` already accepts the full `StoreAssignments` blob; removal just means the item is absent from the array.
- `lib/shopping.ts` — no changes to `ShoppingItem` type or `buildStoreAssignments`.
- DB schema — no migration needed.

## Data Flow

```
User swipes left → removes row from assignments state
  → pendingUndo set, 4-second timer starts
  → Toast shows "[Name] removed · Undo"

Path A: User taps Undo
  → timer cleared
  → item spliced back into assignments[store] at original index
  → toast dismissed, no DB write

Path B: 4 seconds pass
  → saveCheckedState(listId, updatedAssignments) called
  → toast dismissed
```

## Edge Cases

| Scenario | Behavior |
|---|---|
| Remove an already-checked item | Allowed — disappears like any unchecked item |
| Swipe a second row while one is open | First row snaps closed, second opens |
| Second remove before first undo expires | First item committed immediately via `scheduleSave`; second enters the undo window |
| Regenerate list while undo is pending | `handleGenerate` clears `undoTimer` and calls `setPendingUndo(null)` before triggering the regenerate transition, preventing the stale timer from overwriting the freshly generated list in the DB. |
| Remove while `scheduleSave` debounce is pending | Debounce timer is cancelled by the new call to `scheduleSave` inside the undo timer; final saved state is always consistent. |
