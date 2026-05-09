# Ingredient Consolidation — Design Spec

**Date:** 2026-05-08

## Problem

The weekly shopping list shows duplicate ingredient entries when the same ingredient appears across multiple recipes with pluralized names or compatible-but-different units. For example, one recipe with "1 apple" and another with "2 apples" produce two separate line items instead of one "3 apple" entry.

## Goal

Consolidate shopping list ingredients so that:
- The same ingredient spelled differently (singular vs plural) is treated as one item
- The same ingredient measured in compatible units (e.g., 1 cup broth + 2 tablespoons broth) is converted and combined into a single quantity
- Incompatible units (count vs volume vs weight) remain separate

## Scope

Only `lib/shopping.ts` changes. The output type (`StoreAssignments`) is unchanged, so `ShoppingClient.tsx`, server actions, and the database schema are untouched. Existing saved lists are not retroactively re-aggregated — changes take effect when the user taps "Regenerate."

## Algorithm

Four new helpers are added to `lib/shopping.ts` and used inside `buildStoreAssignments`:

### 1. `normalizeName(name: string): string`

De-pluralizes ingredient names before they are used as aggregation keys. Rules applied in order:

| Pattern | Transformation | Example |
|---|---|---|
| Ends in `ves` | Replace with `f` | loaves → loaf |
| Ends in `ies`, length > 4 | Replace with `y` | berries → berry |
| Ends in `es`, length > 4 | Strip `es` | tomatoes → tomato, peaches → peach |
| Ends in `s`, length > 3, doesn't end in `ss` | Strip `s` | apples → apple, carrots → carrot |

Applied after lowercasing and trimming (already done by existing code).

### 2. `normalizeUnit(unit: string): string`

Maps unit aliases to canonical strings:

| Aliases | Canonical |
|---|---|
| tsp, t | teaspoon |
| tbsp, tbs, T | tablespoon |
| fl oz, fluid ounce | fluid ounce |
| c | cup |
| pt | pint |
| qt | quart |
| gal | gallon |
| ml, mL, millilitre | milliliter |
| l, L, litre | liter |
| g | gram |
| kg | kilogram |
| oz, ounce | ounce |
| lb, lbs, pound | pound |

Unrecognized units pass through unchanged (lowercased).

### 3. `unitFamily(unit: string): 'volume' | 'weight' | 'other'`

Classifies a normalized unit:

- **volume**: teaspoon, tablespoon, fluid ounce, cup, pint, quart, gallon, milliliter, liter
- **weight**: gram, kilogram, ounce, pound
- **other**: everything else, including empty string (count/piece/clove/head/etc.)

### 4. Aggregation Key

Replaces the current `name|||unit` key:

| Family | Key format | Example |
|---|---|---|
| volume | `normalizedName\|\|\|volume` | `broth\|\|\|volume` |
| weight | `normalizedName\|\|\|weight` | `butter\|\|\|weight` |
| other | `normalizedName\|\|\|normalizedUnit` | `garlic\|\|\|clove`, `apple\|\|\|` |

Volume and weight items with the same name but different units (e.g., cups + tablespoons) share a key and are combined. Count-like items only combine when their specific unit is identical.

### 5. Canonical Accumulation

Quantities are stored internally in canonical units during aggregation:

- **Volume → tablespoons**: teaspoon = 1/3, tablespoon = 1, fluid ounce = 2, cup = 16, pint = 32, quart = 64, gallon = 256, milliliter = 1/14.787, liter = 67.628
- **Weight → grams**: gram = 1, kilogram = 1000, ounce = 28.3495, pound = 453.592
- **Other**: raw numeric value (no conversion)

### 6. Display Unit Selection

After summing in canonical units, convert to the most human-friendly unit for display:

- **Volume** (from tablespoons): if ≥ 16 → cups; if ≥ 1 → tablespoons; otherwise → teaspoons. (Pints and quarts are intentionally skipped — cups is the more natural cooking unit for US recipes.)
- **Weight** (from grams): if ≥ 453.592 → pounds; if ≥ 28.3495 → ounces; otherwise → grams
- **Other**: use the original unit string (pass through unchanged)

The existing `formatQty` function handles fractional formatting (e.g., 1.125 → `1⅛`).

## Edge Cases

| Scenario | Behavior |
|---|---|
| Same name, incompatible families ("1 cup apple" + "2 apples") | Different keys → separate line items |
| Same name, different "other" units ("2 cloves garlic" + "1 head garlic") | Different keys → separate line items |
| Same name, same "other" unit ("2 cloves garlic" + "3 cloves garlic") | Same key → combined to "5 cloves garlic" |
| De-pluralization false positive (rare) | Acceptable risk; cooking ingredient vocabulary is narrow |
| Unparseable quantity | `parseQty` returns 0; item still appears with empty quantity (existing behavior) |
| Existing saved lists | Not retroactively updated; changes apply on next "Regenerate" |
