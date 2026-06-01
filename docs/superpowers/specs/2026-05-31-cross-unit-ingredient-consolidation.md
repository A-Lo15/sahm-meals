# Cross-Unit Ingredient Consolidation

**Date:** 2026-05-31

## Problem

Ingredients that appear in a week's recipes under different unit families are not consolidated on the shopping list. For example, one recipe calls for "1 clove garlic" (unit family: `other`) and another calls for "3 tablespoons minced garlic" (unit family: `volume`). The current aggregation key is `normalizedName|||family`, so these produce two separate shopping list entries instead of one merged line.

## Approach

**AI-powered conversion on first conflict, with stored unit preferences.**

When a conflict is detected (same normalized ingredient name, two different unit families), Claude is asked to provide the conversion factor. The user confirms or adjusts the preferred display unit in a generation-time dropdown modal. The preference is saved permanently in `households.preferences.unit_preferences` and applied automatically on all future weeks — no repeat API call or user prompt needed.

No hand-curated static conversion table is required. Any ingredient combination Claude can reason about is supported automatically.

## Design

### 1. Conflict Detection (lib/shopping.ts)

After the existing aggregation pass in `buildStoreAssignments`, add a post-pass scan:

- Collect all `(normalizedName, family)` pairs from the `agg` map.
- For each `normalizedName` that appears in more than one unit family, record it as a `ConflictItem`.
- A conflict only applies between `other` and `volume` or `other` and `weight`. Same-family conflicts (e.g., grams vs. ounces) are already handled by the existing canonical conversion and do not trigger this flow.

`ConflictItem` shape:
```ts
interface ConflictItem {
  normalizedName: string      // e.g. "garlic"
  displayName: string         // e.g. "Garlic"
  options: {
    family: 'volume' | 'weight' | 'other'
    unit: string              // normalized unit of the aggregated entry
    displayQty: string        // human-readable quantity in that unit
  }[]
}
```

`buildStoreAssignments` grows a second return value:

```ts
function buildStoreAssignments(
  slots: RawSlot[],
  storeNames: string[],
  priorRouteMap: Map<string, string>,
  unitPreferences: Record<string, string>   // new param
): { assignments: StoreAssignments; conflicts: ConflictItem[] }
```

- Conflicts where `unitPreferences[normalizedName]` is already set are resolved inline (the minority-family quantity is converted and merged) and do not appear in the returned `conflicts` array.
- Conflicts with no stored preference are returned for user resolution.

### 2. AI Conversion Suggestions (app/shopping/actions.ts)

Add a private helper `fetchConversionSuggestions(conflicts: ConflictItem[]): Promise<Record<string, number>>` called internally by `generateShoppingList` — it is not a separate client-callable server action.

- Builds a single prompt listing all unresolved conflicts and asks Claude for the conversion factor (in tablespoons for volume, grams for weight) per count unit per ingredient.
- Returns a map of `normalizedName → conversionFactor`.
- On any error (API failure, malformed response), returns an empty map. The UI falls back to showing both options with no pre-selection; the user picks manually.
- Model: `claude-haiku-4-5-20251001` (cheap, fast — this is a lookup call, not generation).

`generateShoppingList` returns a discriminated union so the client can handle both cases:

```ts
type GenerateResult =
  | { type: 'success'; listId: string; assignments: StoreAssignments; generatedAt: string }
  | { type: 'conflicts'; conflicts: ConflictItem[]; suggestions: Record<string, number> }
```

### 3. Conflict Resolution Modal (app/shopping/ShoppingClient.tsx)

Triggered only when `conflicts.length > 0` after `generateShoppingList` is called. Implemented as a bottom sheet (matching the app's existing sheet pattern) with:

- Title: "Review consolidated ingredients"
- Subtitle: "These ingredients appear in mixed units this week. Your choice will be remembered."
- One row per conflict: ingredient name on the left, `<select>` dropdown on the right.
- Dropdown options: both unit representations with their merged quantities (e.g., "3 cloves", "1 tbsp"). The AI-suggested option is pre-selected and labeled "(suggested)". If no suggestion, no pre-selection.
- **Generate List** button at the bottom — disabled until every conflict has a selection.
- On confirm: calls `resolveAndGenerateList(mealPlanId, weekStart, unitPreferences)` with the chosen preferences merged into the existing stored preferences.

### 4. Persistence

Unit preferences are stored in the existing `households.preferences` JSONB column under a new key:

```json
{
  "quality_defaults": { ... },
  "primary_stores": [ ... ],
  "unit_preferences": {
    "garlic": "clove",
    "green onion": "stalk"
  }
}
```

The value is the `normalizedUnit` of the chosen option. No schema migration required.

`resolveAndGenerateList` server action:
1. Reads current `households.preferences`.
2. Merges new unit preferences into `unit_preferences`.
3. Writes back to `households`.
4. Calls the existing list generation logic with the full merged preferences.

### 5. Updated Generation Flow

```
User taps "Generate"
  → server: aggregate slots, detect conflicts, check stored unit_preferences
  → if all conflicts resolved: generate list directly (existing behavior, no change)
  → if unresolved conflicts:
      → fetch Claude conversion suggestions (single batched call)
      → return conflicts + suggestions to client
      → client shows bottom sheet with dropdowns
      → user confirms choices
      → server: merge preferences, generate list, save
```

The happy path (all preferences already stored) is a single server round-trip with no API call — identical performance to today.

### 6. Error Handling

| Failure | Behavior |
|---|---|
| Claude API error | Dropdowns shown with no pre-selection; user picks manually |
| Household preferences write fails | List still generated with chosen units for this week; preferences not persisted; silent retry not attempted (user can regenerate) |
| Conversion math error (divide by zero, NaN) | Conflict treated as unresolvable; both entries kept as separate list items (current behavior) |

## Out of Scope

- User-editable conversion factors (the AI suggestion is the source of truth; no override UI)
- Weight ↔ volume cross-family consolidation (e.g., grams vs. cups of flour) — too ingredient-specific to be reliable
- Retroactively re-merging already-generated lists when preferences change
