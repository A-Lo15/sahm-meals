# Recipe Tagging & Filtering

## Problem

When building a weekly meal plan, adding a recipe from the past means scrolling a flat, title-search-only list (`app/planner/[id]/PlanDetailClient.tsx`, add-recipe bottom sheet). There's no way to browse by cuisine, meal type, cooking method, or ingredient — so if the user wants "some Mexican recipe" without a specific dish in mind, there's no way to narrow the list down.

## Goals

- Every recipe gets tagged along three dimensions — cuisine, meal type, cooking method — automatically, using AI, at creation time.
- Existing recipes get backfilled with the same tagging logic in a one-time pass.
- Tags are manually editable afterward (toggle on/off from a fixed preset list per dimension).
- Both the "Add from past recipes" planner sheet and the main Recipes library page can filter by these tags, plus search by ingredient name (not just title).

## Non-goals

- No free-text/arbitrary tag values — all three dimensions use a fixed preset list (see below). "Other" is available as an escape hatch for cuisine and cooking method.
- No automatic re-tagging when a recipe is edited later — tags are generated once at creation and from then on only change via manual toggling.
- No new ingredient-tagging dimension — ingredient filtering reuses each recipe's existing `ingredients[].name` list via substring search, not a curated tag list.
- No UI-triggered backfill — the one-time backfill for existing recipes is a script run directly against Supabase, not exposed in the app.

## Design

### 1. Data model

New migration `supabase/migrations/007_recipe_tags.sql`:

```sql
alter table recipes
  add column cuisines text[] not null default '{}',
  add column meal_types text[] not null default '{}',
  add column cooking_methods text[] not null default '{}';
```

`Recipe` interface (`lib/types.ts:70-87`) gains `cuisines: string[]`, `meal_types: string[]`, `cooking_methods: string[]`. A recipe may have zero or more values per dimension (e.g. a Tex-Mex dish tagged both `Mexican` and `American`; a casserole tagged both `Lunch` and `Dinner`).

Preset vocabularies live in a new `lib/recipeTags.ts`:

- **Cuisines** (6): Italian, Mexican, American, Asian, Greek, Other
- **Meal types** (6): Breakfast, Lunch, Dinner, Dessert, Snack, Appetizer/Side
- **Cooking methods** (7): Oven Baked, Stovetop, Grill, Slow Cooker, No-Cook, Sheet Pan, Other

### 2. AI auto-tagging

`suggestRecipeTags(recipe: { title, description, ingredients, instructions })` in `lib/recipeTags.ts`, using the same Claude Haiku client setup as `lib/parseRecipe.ts`. The prompt constrains the model to pick only from the three preset lists and returns `{ cuisines: string[], meal_types: string[], cooking_methods: string[] }`.

- **New recipes**: called once, server-side, immediately after insert — regardless of whether the recipe came from URL import (`parseRecipeUrl`) or manual entry (`app/recipes/new/page.tsx`). This is a standalone call, not folded into `parseRecipe.ts`'s existing JSON-LD/Claude-fallback logic, so tagging behavior is identical no matter how the recipe was created.
- **Existing recipes**: one-off script `scripts/backfill-recipe-tags.ts` — fetches all recipes with empty tag arrays, calls `suggestRecipeTags`, updates each row. Run once after the migration ships.
- **Failure handling**: if the AI call fails (creation or backfill), the recipe keeps empty tag arrays rather than blocking the save. It remains manually taggable and still appears in unfiltered views.

### 3. Manual tag editing

On the recipe detail/edit page (`app/recipes/[id]/`), a new "Tags" section below the existing fields: one row of toggle pills per dimension (Cuisine / Meal Type / Cooking Method), showing every preset value for that dimension with the recipe's current tags highlighted. Tapping a pill toggles it on/off and saves via a server action, following the existing toggle pattern in `StateControls.tsx`. No free-text add.

### 4. Filtering UI

The same filter control is reused in two places: `app/recipes/page.tsx` and the "Add from past recipes" sheet in `app/planner/[id]/PlanDetailClient.tsx`.

- **Ingredient search**: the existing title-substring search box (`filteredRecipes`, `PlanDetailClient.tsx:369-371`, and the equivalent on the Recipes page) is extended to also match against each recipe's `ingredients[].name`, using the same case-insensitive substring matching already used for titles.
- **Cuisine / Meal Type / Cooking Method filters**: a row of toggle-pill groups above the recipe list (visually consistent with the tag-editing pills from section 3). Selections *within* one dimension OR together (e.g. Italian OR Mexican); selections *across* dimensions AND together (e.g. Mexican AND Dinner). All filters combine with the existing search box and Library/All Recipes tab.
- On the planner's bottom sheet (limited vertical space), the pill rows are hidden behind a collapsed "Filters" toggle button by default; expanding it reveals the three rows.

## Testing

- No test framework exists in this project (confirmed during the shopping-tabs work — no Jest/Vitest, no test script). Verification is manual: create a recipe and confirm it gets tagged, edit tags manually and confirm they persist, apply filters in both the Recipes page and the planner sheet and confirm the list narrows correctly (including OR-within/AND-across-dimension behavior), and run the backfill script against a couple of existing recipes to confirm it tags without touching manually-set tags on already-tagged rows.
