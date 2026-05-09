# Ingredient Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggregate shopping list ingredients so that the same ingredient with plural name variants or compatible units (volume+volume, weight+weight) is combined into a single line item.

**Architecture:** All changes are in `lib/shopping.ts`. Four pure helper functions are added (`normalizeName`, `normalizeUnit`, `unitFamily`, `volumeFromCanonical`, `weightFromCanonical`) plus two conversion lookup tables. `buildStoreAssignments` is updated to key by `normalizedName|||unitFamily` instead of `name|||unit`, accumulate in canonical units (tablespoons for volume, grams for weight), and convert back to a human-friendly display unit before returning.

**Tech Stack:** TypeScript, Next.js 14. No test framework — verification is `npm run build` and manual browser testing.

---

### Task 1: Add pure helper functions and conversion tables

**Files:**
- Modify: `lib/shopping.ts`

- [ ] **Step 1: Add unit alias map and `normalizeUnit` helper**

Insert the following directly above the existing `STORE_FOR_CATEGORY` constant in `lib/shopping.ts` (after `formatQty`):

```typescript
const UNIT_ALIASES: Record<string, string> = {
  // Teaspoon
  tsp: 'teaspoon', teaspoons: 'teaspoon',
  // Tablespoon
  tbsp: 'tablespoon', tbs: 'tablespoon', tb: 'tablespoon', tablespoons: 'tablespoon',
  // Fluid ounce
  'fl oz': 'fluid ounce', 'fl. oz.': 'fluid ounce', 'fluid ounces': 'fluid ounce',
  // Cup
  c: 'cup', cups: 'cup',
  // Pint
  pt: 'pint', pts: 'pint', pints: 'pint',
  // Quart
  qt: 'quart', qts: 'quart', quarts: 'quart',
  // Gallon
  gal: 'gallon', gallons: 'gallon',
  // Milliliter
  ml: 'milliliter', millilitre: 'milliliter', milliliters: 'milliliter', millilitres: 'milliliter',
  // Liter
  'l.': 'liter', litre: 'liter', liters: 'liter', litres: 'liter',
  // Gram
  'g.': 'gram', grams: 'gram',
  // Kilogram
  'kg.': 'kilogram', kilograms: 'kilogram',
  // Ounce (weight)
  'oz.': 'ounce', ounces: 'ounce',
  // Pound
  lb: 'pound', lbs: 'pound', 'lbs.': 'pound', pounds: 'pound',
}

function normalizeUnit(unit: string): string {
  const u = unit.toLowerCase().trim()
  return UNIT_ALIASES[u] ?? u
}
```

- [ ] **Step 2: Add unit family sets and `unitFamily` helper**

Insert directly after `normalizeUnit`:

```typescript
const VOLUME_UNITS = new Set([
  'teaspoon', 'tablespoon', 'fluid ounce', 'cup', 'pint', 'quart', 'gallon',
  'milliliter', 'liter',
])

const WEIGHT_UNITS = new Set([
  'gram', 'kilogram', 'ounce', 'pound',
])

function unitFamily(unit: string): 'volume' | 'weight' | 'other' {
  if (VOLUME_UNITS.has(unit)) return 'volume'
  if (WEIGHT_UNITS.has(unit)) return 'weight'
  return 'other'
}
```

- [ ] **Step 3: Add conversion tables and `normalizeName` helper**

Insert directly after `unitFamily`:

```typescript
const TO_TABLESPOONS: Record<string, number> = {
  teaspoon: 1 / 3,
  tablespoon: 1,
  'fluid ounce': 2,
  cup: 16,
  pint: 32,
  quart: 64,
  gallon: 256,
  milliliter: 1 / 14.787,
  liter: 1000 / 14.787,
}

const TO_GRAMS: Record<string, number> = {
  gram: 1,
  kilogram: 1000,
  ounce: 28.3495,
  pound: 453.592,
}

function volumeFromCanonical(tbsp: number): { qty: number; unit: string } {
  if (tbsp >= 16) return { qty: tbsp / 16, unit: 'cup' }
  if (tbsp >= 1) return { qty: tbsp, unit: 'tablespoon' }
  return { qty: tbsp * 3, unit: 'teaspoon' }
}

function weightFromCanonical(grams: number): { qty: number; unit: string } {
  if (grams >= 453.592) return { qty: grams / 453.592, unit: 'pound' }
  if (grams >= 28.3495) return { qty: grams / 28.3495, unit: 'ounce' }
  return { qty: grams, unit: 'gram' }
}

function normalizeName(raw: string): string {
  const s = raw.toLowerCase().trim()
  if (s.endsWith('ies') && s.length > 4) return s.slice(0, -3) + 'y'
  if (s.endsWith('oes') && s.length > 4) return s.slice(0, -2)
  if (s.endsWith('es') && s.length > 4) {
    const stem = s.slice(0, -2)
    if (/(?:ch|sh|x|z)$/.test(stem)) return stem
  }
  if (s.endsWith('s') && s.length > 3 && !s.endsWith('ss')) return s.slice(0, -1)
  return s
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run build
```

Expected: build succeeds with no type errors. The helpers are not yet used by `buildStoreAssignments` so there may be "declared but never used" lint warnings — that is fine; they will be wired up in Task 2.

- [ ] **Step 5: Commit**

```bash
git add lib/shopping.ts
git commit -m "feat: add ingredient normalization and unit conversion helpers"
```

---

### Task 2: Wire helpers into `buildStoreAssignments`

**Files:**
- Modify: `lib/shopping.ts`

- [ ] **Step 1: Replace `buildStoreAssignments` with the new implementation**

The current function starts at `export function buildStoreAssignments(slots: RawSlot[]): StoreAssignments {` and runs to the end of the file. Replace it entirely with:

```typescript
interface AggEntry {
  canonical: number
  family: 'volume' | 'weight' | 'other'
  unit: string
  category: IngredientCategory
}

export function buildStoreAssignments(slots: RawSlot[]): StoreAssignments {
  const agg = new Map<string, AggEntry>()

  for (const slot of slots) {
    const scale =
      (slot.servings_override ?? slot.recipe.default_servings) / slot.recipe.default_servings

    for (const ing of slot.recipe.ingredients ?? []) {
      if (!ing.name?.trim()) continue

      const normalizedName = normalizeName(ing.name)
      const normalizedUnit = normalizeUnit(ing.unit)
      const family = unitFamily(normalizedUnit)

      const key =
        family === 'other'
          ? `${normalizedName}|||${normalizedUnit}`
          : `${normalizedName}|||${family}`

      const rawQty = parseQty(ing.quantity) * scale

      let canonical: number
      if (family === 'volume') {
        canonical = rawQty * (TO_TABLESPOONS[normalizedUnit] ?? 1)
      } else if (family === 'weight') {
        canonical = rawQty * (TO_GRAMS[normalizedUnit] ?? 1)
      } else {
        canonical = rawQty
      }

      const existing = agg.get(key)
      if (existing) {
        existing.canonical += canonical
      } else {
        agg.set(key, { canonical, family, unit: normalizedUnit, category: ing.category ?? '' })
      }
    }
  }

  const result: StoreAssignments = {
    'Whole Foods': [],
    "Sam's Club": [],
    "Trader Joe's": [],
  }

  for (const [key, { canonical, family, unit, category }] of Array.from(agg.entries())) {
    const rawName = key.split('|||')[0]
    const name = rawName.charAt(0).toUpperCase() + rawName.slice(1)

    let displayQty: number
    let displayUnit: string

    if (family === 'volume') {
      const converted = volumeFromCanonical(canonical)
      displayQty = converted.qty
      displayUnit = converted.unit
    } else if (family === 'weight') {
      const converted = weightFromCanonical(canonical)
      displayQty = converted.qty
      displayUnit = converted.unit
    } else {
      displayQty = canonical
      displayUnit = unit
    }

    const store = (STORE_FOR_CATEGORY[category] ?? "Trader Joe's") as StoreName
    result[store].push({ name, quantity: formatQty(displayQty), unit: displayUnit, category, checked: false })
  }

  for (const store of STORES) {
    result[store].sort((a, b) => {
      const ci = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
      return ci !== 0 ? ci : a.name.localeCompare(b.name)
    })
  }

  return result
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```

Expected: build succeeds with no type errors or warnings.

- [ ] **Step 3: Manual browser test — same-unit aggregation**

```bash
npm run dev
```

1. Open the planner at `http://localhost:3000/planner`
2. Add two recipes to different days that share an ingredient with the same unit — e.g., two recipes each calling for some quantity of "butter" measured in tablespoons
3. Navigate to the shopping list and tap **Build List** (or **Regenerate** if a list already exists)
4. Confirm the butter appears as a single line item with the quantities summed

- [ ] **Step 4: Manual browser test — cross-unit aggregation**

1. Add two recipes where the same ingredient appears in compatible but different units — e.g., one recipe calls for `½ cup` broth and another for `2 tablespoons` broth
2. Regenerate the shopping list
3. Confirm broth appears as a single line item: `½ cup` = 8 tbsp canonical + `2 tbsp` = 10 tbsp = `⅝ cup`

- [ ] **Step 5: Manual browser test — pluralization**

1. Confirm that an ingredient appearing as "apple" in one recipe and "apples" in another combines into a single line item (not two separate rows)

- [ ] **Step 6: Manual browser test — incompatible units stay separate**

1. If you have a recipe that calls for "2 apples" (no unit) and another that calls for "1 cup apple sauce", confirm these appear as two separate line items (count vs volume = different families)

- [ ] **Step 7: Commit**

```bash
git add lib/shopping.ts
git commit -m "feat: consolidate shopping ingredients by name and compatible units"
```
