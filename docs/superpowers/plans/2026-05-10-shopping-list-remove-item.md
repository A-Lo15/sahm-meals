# Shopping List Remove Item Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow any shopping list item to be permanently removed via a swipe-left gesture, with a 4-second undo window before the deletion is committed to the DB.

**Architecture:** All changes are confined to `app/shopping/ShoppingClient.tsx`. New state tracks the swipe-open row key and pending undo; swipe gestures are handled with touch event handlers that imperatively mutate the dragged element's style (avoiding re-renders during drag); on touch-end, React state is updated to finalize position. The existing `saveCheckedState` server action handles removal natively — absent items are simply not in the array.

**Tech Stack:** TypeScript, Next.js 14 App Router, React 18, Tailwind CSS. No test framework — verification is `npm run build` and manual browser testing.

---

### Task 1: Add state, refs, constants, and core functions

**Files:**
- Modify: `app/shopping/ShoppingClient.tsx`

Context: `ShoppingClient.tsx` is 255 lines. The component state block is lines 35–40. `handleGenerate` is lines 50–59. `scheduleSave` is lines 61–69. `toggleItem` is lines 71–81. The JSX begins at line 99.

- [ ] **Step 1: Add the `REMOVE_BTN_WIDTH` constant**

At the top of `app/shopping/ShoppingClient.tsx`, directly after the `CATEGORY_LABELS` object (after line 17), add:

```typescript
const REMOVE_BTN_WIDTH = 64 // px — width of the trailing Remove button
```

- [ ] **Step 2: Add swipe and undo state + refs**

The current state/ref block (lines 35–40) is:

```typescript
  const router = useRouter()
  const [listId, setListId] = useState(initialListId)
  const [assignments, setAssignments] = useState<StoreAssignments | null>(initialAssignments)
  const [generatedAt, setGeneratedAt] = useState(initialGeneratedAt)
  const [activeStore, setActiveStore] = useState<StoreName>('Whole Foods')
  const [isPending, startTransition] = useTransition()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
```

Replace it with:

```typescript
  const router = useRouter()
  const [listId, setListId] = useState(initialListId)
  const [assignments, setAssignments] = useState<StoreAssignments | null>(initialAssignments)
  const [generatedAt, setGeneratedAt] = useState(initialGeneratedAt)
  const [activeStore, setActiveStore] = useState<StoreName>('Whole Foods')
  const [isPending, startTransition] = useTransition()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Swipe-to-remove state
  const [swipeOpenKey, setSwipeOpenKey] = useState<string | null>(null)
  const [pendingUndo, setPendingUndo] = useState<{
    item: ShoppingItem
    store: StoreName
    index: number
  } | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Touch gesture refs — mutated imperatively to avoid re-renders during drag
  const touchStartX = useRef<number>(0)
  const isDragging = useRef<boolean>(false)
  const dragKey = useRef<string | null>(null)
  const dragRowRef = useRef<HTMLDivElement | null>(null)
```

- [ ] **Step 3: Update `handleGenerate` to clear undo state**

The current `handleGenerate` (lines 50–59) is:

```typescript
  function handleGenerate() {
    startTransition(async () => {
      const result = await generateShoppingList(weekStart)
      if (result) {
        setListId(result.id)
        setAssignments(result.storeAssignments)
        setGeneratedAt(result.generatedAt)
      }
    })
  }
```

Replace it with:

```typescript
  function handleGenerate() {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setPendingUndo(null)
    setSwipeOpenKey(null)
    startTransition(async () => {
      const result = await generateShoppingList(weekStart)
      if (result) {
        setListId(result.id)
        setAssignments(result.storeAssignments)
        setGeneratedAt(result.generatedAt)
      }
    })
  }
```

- [ ] **Step 4: Add `removeItem` function**

Directly after `toggleItem` (after line 81), add:

```typescript
  function removeItem(store: StoreName, index: number) {
    if (!assignments || !listId) return

    const item = assignments[store][index]

    // Commit any prior pending removal immediately before starting a new one.
    // `assignments` at this point already reflects the prior removal (setAssignments
    // was called synchronously for it).
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

- [ ] **Step 5: Add `undoRemove` function**

Directly after `removeItem`, add:

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

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npm run build
```

Expected: build succeeds. The new functions reference each other correctly and all types resolve.

- [ ] **Step 7: Commit**

```bash
git add app/shopping/ShoppingClient.tsx
git commit -m "feat: add removeItem/undoRemove state and functions for swipe-to-remove"
```

---

### Task 2: Refactor item rows to support swipe gesture

**Files:**
- Modify: `app/shopping/ShoppingClient.tsx`

Context: After Task 1, the item rows are rendered starting around line 211 in the `items.map` block. Each item is currently a single `<button>` element (lines 214–240). We need to restructure each row into three layers:
1. Outer `<div>` — `position: relative; overflow: hidden` — clips the Remove button
2. Inner content `<div>` — receives touch handlers and `transform` style; holds the existing `<button>` for check-off
3. Remove `<button>` — positioned absolutely at trailing edge, revealed when content slides left

The `swipeOpenKey` format is `"${activeStore}-${globalIdx}"`. This uniquely identifies each row across all stores.

The touch handlers imperatively update `dragRowRef.current.style.transform` during drag (no React state) to avoid re-renders on every pixel of movement. On touch-end, a state update (`setSwipeOpenKey`) finalizes the position and React re-renders normally.

- [ ] **Step 1: Replace the item row `<button>` with the swipe structure**

Find the current item row block (the `items.map` callback, currently ending around line 241). The current code looks like:

```tsx
                          {items.map((item, idx) => {
                            const globalIdx = assignments[activeStore].indexOf(item)
                            return (
                              <button
                                key={idx}
                                onClick={() => toggleItem(activeStore, globalIdx)}
                                className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-gray-50 text-left"
                              >
                                <span
                                  className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center text-xs ${
                                    item.checked
                                      ? 'bg-green-500 border-green-500 text-white'
                                      : 'border-gray-300'
                                  }`}
                                >
                                  {item.checked ? '✓' : ''}
                                </span>
                                <span
                                  className={`flex-1 text-sm ${
                                    item.checked ? 'line-through text-gray-400' : 'text-gray-800'
                                  }`}
                                >
                                  {item.name}
                                </span>
                                {(item.quantity || item.unit) && (
                                  <span className={`text-sm flex-shrink-0 ${item.checked ? 'text-gray-300' : 'text-gray-500'}`}>
                                    {[item.quantity, item.unit].filter(Boolean).join(' ')}
                                  </span>
                                )}
                              </button>
                            )
                          })}
```

Replace it with:

```tsx
                          {items.map((item, idx) => {
                            const globalIdx = assignments[activeStore].indexOf(item)
                            const rowKey = `${activeStore}-${globalIdx}`
                            const isOpen = swipeOpenKey === rowKey

                            return (
                              <div key={idx} className="relative overflow-hidden">
                                {/* Sliding row content */}
                                <div
                                  style={{
                                    transform: isOpen ? `translateX(-${REMOVE_BTN_WIDTH}px)` : 'translateX(0)',
                                    transition: 'transform 0.2s ease',
                                  }}
                                  onTouchStart={(e) => {
                                    touchStartX.current = e.touches[0].clientX
                                    isDragging.current = true
                                    dragKey.current = rowKey
                                    dragRowRef.current = e.currentTarget as HTMLDivElement
                                    dragRowRef.current.style.transition = 'none'
                                  }}
                                  onTouchMove={(e) => {
                                    if (!isDragging.current || dragKey.current !== rowKey) return
                                    const deltaX = e.touches[0].clientX - touchStartX.current
                                    if (deltaX >= 0) return
                                    const clamped = Math.max(-REMOVE_BTN_WIDTH, deltaX)
                                    if (dragRowRef.current) {
                                      dragRowRef.current.style.transform = `translateX(${clamped}px)`
                                    }
                                  }}
                                  onTouchEnd={(e) => {
                                    if (!isDragging.current || dragKey.current !== rowKey) return
                                    const deltaX = e.changedTouches[0].clientX - touchStartX.current
                                    isDragging.current = false
                                    dragKey.current = null

                                    if (dragRowRef.current) {
                                      dragRowRef.current.style.transition = 'transform 0.2s ease'
                                    }
                                    dragRowRef.current = null

                                    if (deltaX < -40) {
                                      setSwipeOpenKey(rowKey)
                                    } else {
                                      // Snap back — if this row was already open, keep it open
                                      if (!isOpen) {
                                        const el = e.currentTarget as HTMLDivElement
                                        el.style.transform = 'translateX(0)'
                                      }
                                    }
                                  }}
                                >
                                  <button
                                    onClick={() => {
                                      if (isOpen) {
                                        setSwipeOpenKey(null)
                                      } else {
                                        toggleItem(activeStore, globalIdx)
                                      }
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-gray-50 text-left"
                                  >
                                    <span
                                      className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center text-xs ${
                                        item.checked
                                          ? 'bg-green-500 border-green-500 text-white'
                                          : 'border-gray-300'
                                      }`}
                                    >
                                      {item.checked ? '✓' : ''}
                                    </span>
                                    <span
                                      className={`flex-1 text-sm ${
                                        item.checked ? 'line-through text-gray-400' : 'text-gray-800'
                                      }`}
                                    >
                                      {item.name}
                                    </span>
                                    {(item.quantity || item.unit) && (
                                      <span className={`text-sm flex-shrink-0 ${item.checked ? 'text-gray-300' : 'text-gray-500'}`}>
                                        {[item.quantity, item.unit].filter(Boolean).join(' ')}
                                      </span>
                                    )}
                                  </button>
                                </div>

                                {/* Remove button — revealed when content slides left */}
                                <button
                                  onClick={() => removeItem(activeStore, globalIdx)}
                                  className="absolute right-0 top-0 bottom-0 flex items-center justify-center bg-red-500 text-white text-xs font-bold"
                                  style={{ width: REMOVE_BTN_WIDTH }}
                                  aria-label={`Remove ${item.name}`}
                                >
                                  Remove
                                </button>
                              </div>
                            )
                          })}
```

Note on the click handler: when a row is swiped open (`isOpen`), tapping the row closes it rather than toggling the checked state. This prevents accidental check-offs when the user means to dismiss the swipe.

- [ ] **Step 2: Add one-open-at-a-time enforcement on touch start**

The `onTouchStart` handler above needs to snap any currently-open row closed when a new swipe begins. Update the `onTouchStart` inside the sliding content `<div>` to:

```tsx
                                  onTouchStart={(e) => {
                                    // Snap any currently-open row closed before starting a new drag
                                    if (swipeOpenKey !== null && swipeOpenKey !== rowKey) {
                                      setSwipeOpenKey(null)
                                    }
                                    touchStartX.current = e.touches[0].clientX
                                    isDragging.current = true
                                    dragKey.current = rowKey
                                    dragRowRef.current = e.currentTarget as HTMLDivElement
                                    dragRowRef.current.style.transition = 'none'
                                  }}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run build
```

Expected: build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add app/shopping/ShoppingClient.tsx
git commit -m "feat: add swipe-left row structure with Remove button to shopping list"
```

---

### Task 3: Add undo toast, verify end-to-end, and final commit

**Files:**
- Modify: `app/shopping/ShoppingClient.tsx`

Context: After Task 2, swipe-to-remove works but there's no undo toast. The toast must be rendered at the root of the component return (outside the store-tabs and list `<div>`s) so it overlays everything at the bottom of the viewport. It renders when `pendingUndo !== null`.

- [ ] **Step 1: Add the undo toast JSX**

Find the closing `</div>` of the outermost `min-h-screen` container (currently the last `</div>` before the component's `)`). Just before that closing tag, add:

```tsx
      {/* Undo toast */}
      {pendingUndo && (
        <div className="fixed bottom-4 left-4 right-4 z-50 flex items-center justify-between bg-gray-900 text-white px-4 py-3 rounded-2xl shadow-lg">
          <span className="text-sm">{pendingUndo.item.name} removed</span>
          <button
            onClick={undoRemove}
            className="text-sm font-semibold text-green-400 ml-4"
          >
            Undo
          </button>
        </div>
      )}
```

The full end of the return statement should look like:

```tsx
      {/* List */}
      {assignments && (
        <>
          {/* ... store tabs and items ... */}
        </>
      )}

      {/* Undo toast */}
      {pendingUndo && (
        <div className="fixed bottom-4 left-4 right-4 z-50 flex items-center justify-between bg-gray-900 text-white px-4 py-3 rounded-2xl shadow-lg">
          <span className="text-sm">{pendingUndo.item.name} removed</span>
          <button
            onClick={undoRemove}
            className="text-sm font-semibold text-green-400 ml-4"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```

Expected: clean build with no errors or warnings.

- [ ] **Step 3: Manual browser test — happy path remove**

```bash
npm run dev
```

1. Open `http://localhost:3000/shopping` for the current week (must have a generated list)
2. Swipe a row left — confirm the row slides and the red "Remove" button appears at the trailing edge
3. Tap **Remove** — confirm the row disappears and a dark toast slides up from the bottom: "[Item name] removed · Undo"
4. Wait 4 seconds — confirm the toast disappears and the item does not come back on page refresh

- [ ] **Step 4: Manual browser test — undo path**

1. Swipe a row left and tap **Remove**
2. While the toast is visible, tap **Undo**
3. Confirm the toast disappears and the item is immediately restored to its original position in the list
4. Refresh the page — confirm the item is still present (no DB write occurred)

- [ ] **Step 5: Manual browser test — one-open-at-a-time**

1. Swipe row A left until it opens (Remove button visible)
2. Swipe row B left — confirm row A snaps closed and row B opens
3. Tap anywhere on row B (not Remove) — confirm row B closes without toggling its checked state

- [ ] **Step 6: Manual browser test — second remove before undo expires**

1. Swipe item A left, tap Remove — toast shows "A removed"
2. While toast is still showing, swipe item B left, tap Remove — toast updates to "B removed"
3. Wait 4 seconds — confirm toast disappears
4. Refresh page — confirm both A and B are gone (both committed to DB)

- [ ] **Step 7: Manual browser test — regenerate while undo pending**

1. Swipe an item, tap Remove — toast appears
2. While toast is still showing, tap **Regenerate**
3. Confirm the toast disappears immediately
4. Confirm the newly generated list loads correctly with no ghost saves overwriting it

- [ ] **Step 8: Commit**

```bash
git add app/shopping/ShoppingClient.tsx
git commit -m "feat: add undo toast for shopping list swipe-to-remove"
```
