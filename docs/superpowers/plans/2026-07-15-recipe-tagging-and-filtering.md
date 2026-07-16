# Recipe Tagging & Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every recipe gets auto-tagged (cuisine, meal type, cooking method) via AI at creation, existing recipes get backfilled once, tags are manually editable, and both the Recipes library page and the planner's "Add from past recipes" sheet can filter by these tags plus search by ingredient name.

**Architecture:** Three new `text[]` columns on `recipes` (`cuisines`, `meal_types`, `cooking_methods`) hold tags drawn from fixed preset lists in `lib/recipeTags.ts`. A single AI call (`suggestRecipeTags`, same Claude Haiku setup as `lib/parseRecipe.ts`) runs once at recipe creation inside the existing `createRecipe` server action — the one place all recipe creation (manual and URL-import) already funnels through. A one-off script backfills existing recipes. Tags are manually toggleable via a new "Tags" section on the recipe detail page. A shared `RecipeTagFilters` component is reused in both the Recipes page (extracted into a new client component) and the planner's bottom sheet.

**Tech Stack:** Next.js 14 (App Router), React 18, Supabase (Postgres + PostgREST), Tailwind CSS, `@anthropic-ai/sdk`. No test framework is configured in this project (no Jest/Vitest, no `test` script, no `*.test.ts*` files) — verification is manual via the dev server (`tsc`/`lint` for static checks), consistent with prior work in this repo.

## Global Constraints

- Fixed preset vocab only, no free-text tags:
  - **Cuisines** (6): `Italian, Mexican, American, Asian, Greek, Other`
  - **Meal types** (6): `Breakfast, Lunch, Dinner, Dessert, Snack, Appetizer/Side`
  - **Cooking methods** (7): `Oven Baked, Stovetop, Grill, Slow Cooker, No-Cook, Sheet Pan, Other`
- Tags are generated once at creation, never auto-regenerated on edit — only manual toggling changes them afterward.
- Ingredient filtering is substring search over existing `ingredients[].name`, not a new tag dimension.
- No UI-triggered backfill — it's a one-off script, run manually against Supabase.
- Within one dimension, selected filter values OR together; across dimensions, filters AND together.
- **The `007_recipe_tags.sql` migration must be applied by the user directly in the Supabase dashboard SQL editor before Task 2's manual verification (or Task 3's backfill) can be run for real** — there is no CLI/connection string in this project to apply it programmatically.

---

### Task 1: Data model — schema, types, and preset constants

**Files:**
- Create: `supabase/migrations/007_recipe_tags.sql`
- Create: `lib/recipeTags.ts`
- Modify: `lib/types.ts:62-68` (`RecipeOption`), `lib/types.ts:70-87` (`Recipe`)
- Modify: `app/planner/[id]/page.tsx:50-55` (recipe picker query)

**Interfaces:**
- Produces: `CUISINES`, `MEAL_TYPES`, `COOKING_METHODS` (readonly string tuples), `RecipeTags` interface (`{ cuisines: string[]; meal_types: string[]; cooking_methods: string[] }`), `matchesTagFilter(itemTags: string[], selected: string[]): boolean` — all from `lib/recipeTags.ts`, consumed by Tasks 2, 4, 5, 6.
- Produces: `Recipe.cuisines/meal_types/cooking_methods: string[]` and `RecipeOption.ingredients: Ingredient[]` / `.cuisines/.meal_types/.cooking_methods: string[]` on the existing interfaces in `lib/types.ts`.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/007_recipe_tags.sql`:

```sql
alter table recipes
  add column if not exists cuisines text[] not null default '{}',
  add column if not exists meal_types text[] not null default '{}',
  add column if not exists cooking_methods text[] not null default '{}';
```

This follows the exact style of `006_pantry_staples.sql` (lowercase `alter table`, `add column if not exists`, inline array default). No RLS changes needed — `recipes` already has household-scoped RLS covering all columns (`supabase/migrations/001_initial_schema.sql:172-174`).

- [ ] **Step 2: Create `lib/recipeTags.ts` with preset constants and the filter helper**

```ts
export const CUISINES = ['Italian', 'Mexican', 'American', 'Asian', 'Greek', 'Other'] as const
export const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Snack', 'Appetizer/Side'] as const
export const COOKING_METHODS = ['Oven Baked', 'Stovetop', 'Grill', 'Slow Cooker', 'No-Cook', 'Sheet Pan', 'Other'] as const

export interface RecipeTags {
  cuisines: string[]
  meal_types: string[]
  cooking_methods: string[]
}

export function matchesTagFilter(itemTags: string[], selected: string[]): boolean {
  return selected.length === 0 || itemTags.some((t) => selected.includes(t))
}
```

- [ ] **Step 3: Add tag fields to `Recipe` in `lib/types.ts`**

Change (`lib/types.ts:70-87`):

```ts
export interface Recipe {
  id: string
  household_id: string
  title: string
  description: string | null
  default_servings: number
  source_url: string | null
  source_image_url: string | null
  ingredients: Ingredient[]
  instructions: string | null
  original_parsed_json: Record<string, unknown> | null
  state: RecipeState
  in_library: boolean
  last_cooked_at: string | null
  times_cooked: number
  created_at: string
  updated_at: string
}
```

to:

```ts
export interface Recipe {
  id: string
  household_id: string
  title: string
  description: string | null
  default_servings: number
  source_url: string | null
  source_image_url: string | null
  ingredients: Ingredient[]
  instructions: string | null
  original_parsed_json: Record<string, unknown> | null
  state: RecipeState
  in_library: boolean
  last_cooked_at: string | null
  times_cooked: number
  created_at: string
  updated_at: string
  cuisines: string[]
  meal_types: string[]
  cooking_methods: string[]
}
```

- [ ] **Step 4: Add tag and ingredient fields to `RecipeOption` in `lib/types.ts`**

Change (`lib/types.ts:62-68`):

```ts
export interface RecipeOption {
  id: string
  title: string
  default_servings: number
  source_image_url: string | null
  state: RecipeState
}
```

to:

```ts
export interface RecipeOption {
  id: string
  title: string
  default_servings: number
  source_image_url: string | null
  state: RecipeState
  ingredients: Ingredient[]
  cuisines: string[]
  meal_types: string[]
  cooking_methods: string[]
}
```

- [ ] **Step 5: Update the planner's recipe picker query to select the new columns**

Change (`app/planner/[id]/page.tsx:50-55`):

```ts
    db
      .from('recipes')
      .select('id, title, default_servings, source_image_url, state')
      .eq('household_id', householdId)
      .eq('in_library', true)
      .order('title'),
```

to:

```ts
    db
      .from('recipes')
      .select('id, title, default_servings, source_image_url, state, ingredients, cuisines, meal_types, cooking_methods')
      .eq('household_id', householdId)
      .eq('in_library', true)
      .order('title'),
```

- [ ] **Step 6: Type-check and lint**

Run: `cd ~/Projects/meal-planner && npx tsc --noEmit && npm run lint`
Expected: both exit cleanly. (Runtime behavior involving the new columns won't work yet — the migration hasn't been applied to the live database. That's expected until the user runs Step 1's SQL in the Supabase dashboard.)

- [ ] **Step 7: Commit**

```bash
cd ~/Projects/meal-planner
git add supabase/migrations/007_recipe_tags.sql lib/recipeTags.ts lib/types.ts app/planner/\[id\]/page.tsx
git commit -m "Add recipe tag columns, types, and preset vocab"
```

---

### Task 2: AI auto-tagging on recipe creation

**Files:**
- Modify: `lib/recipeTags.ts` (add `suggestRecipeTags`)
- Modify: `app/recipes/actions.ts:47-78` (`createRecipe`), add `updateRecipeTags`

**Interfaces:**
- Consumes: `RecipeTags`, `CUISINES`, `MEAL_TYPES`, `COOKING_METHODS` from Task 1's `lib/recipeTags.ts`. Consumes existing `Ingredient` type from `lib/types.ts`.
- Produces: `suggestRecipeTags(recipe: { title: string; description: string | null; ingredients: Ingredient[]; instructions: string | null }): Promise<RecipeTags>` from `lib/recipeTags.ts` — consumed by Task 3 (backfill script). Produces `updateRecipeTags(recipeId: string, tags: RecipeTags): Promise<void>` from `app/recipes/actions.ts` — consumed by Task 4 (tag editing UI).

- [ ] **Step 1: Add `suggestRecipeTags` to `lib/recipeTags.ts`**

Append to `lib/recipeTags.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk'
import type { Ingredient } from './types'

export async function suggestRecipeTags(recipe: {
  title: string
  description: string | null
  ingredients: Ingredient[]
  instructions: string | null
}): Promise<RecipeTags> {
  const empty: RecipeTags = { cuisines: [], meal_types: [], cooking_methods: [] }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const ingredientList = recipe.ingredients.map((i) => i.name).join(', ')

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: `Categorize this recipe. Return ONLY valid JSON — no markdown fences, no explanation.

Pick zero or more values for each field, using ONLY the exact strings listed (case-sensitive) — never invent new values.

cuisines: choose from ${JSON.stringify(CUISINES)}
meal_types: choose from ${JSON.stringify(MEAL_TYPES)}
cooking_methods: choose from ${JSON.stringify(COOKING_METHODS)}

Schema:
{"cuisines": string[], "meal_types": string[], "cooking_methods": string[]}

Recipe title: ${recipe.title}
Description: ${recipe.description ?? ''}
Ingredients: ${ingredientList}
Instructions: ${recipe.instructions ?? ''}`,
        },
      ],
    })

    const block = response.content[0]
    if (block.type !== 'text') return empty

    const jsonMatch = block.text.match(/\{[\s\S]+\}/)
    if (!jsonMatch) return empty
    const parsed = JSON.parse(jsonMatch[0]) as Partial<RecipeTags>

    const cuisinesList: readonly string[] = CUISINES
    const mealTypesList: readonly string[] = MEAL_TYPES
    const cookingMethodsList: readonly string[] = COOKING_METHODS

    return {
      cuisines: (parsed.cuisines ?? []).filter((c) => cuisinesList.includes(c)),
      meal_types: (parsed.meal_types ?? []).filter((m) => mealTypesList.includes(m)),
      cooking_methods: (parsed.cooking_methods ?? []).filter((c) => cookingMethodsList.includes(c)),
    }
  } catch {
    return empty
  }
}
```

This matches `lib/parseRecipe.ts`'s exact pattern: same model string (`claude-haiku-4-5-20251001`), same `apiKey: process.env.ANTHROPIC_API_KEY`, same defensive regex-then-`JSON.parse` extraction. Unlike `parseWithClaude`, the whole body is wrapped in `try/catch` so a network failure never throws — per the spec's failure-handling requirement, tagging must never block a recipe save.

- [ ] **Step 2: Wire tagging into `createRecipe` and add `updateRecipeTags`**

Change (`app/recipes/actions.ts:1-7`, imports):

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { Ingredient, RecipeState } from '@/lib/types'
```

to:

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { Ingredient, RecipeState } from '@/lib/types'
import { suggestRecipeTags, type RecipeTags } from '@/lib/recipeTags'
```

Change (`app/recipes/actions.ts:47-78`, `createRecipe`):

```ts
export async function createRecipe(formData: FormData): Promise<{ id: string }> {
  const { db, householdId } = await getContext()

  const ingredientsRaw = formData.get('ingredients') as string
  const ingredients: Ingredient[] = ingredientsRaw ? JSON.parse(ingredientsRaw) : []
  const servings = Math.max(1, parseInt(formData.get('default_servings') as string) || 4)

  const isImport = formData.get('is_import') === 'true'
  const originalJsonRaw = formData.get('original_parsed_json') as string | null

  const { data: recipe, error } = await db
    .from('recipes')
    .insert({
      household_id: householdId,
      title: (formData.get('title') as string).trim(),
      description: (formData.get('description') as string)?.trim() || null,
      default_servings: servings,
      source_url: (formData.get('source_url') as string)?.trim() || null,
      source_image_url: (formData.get('source_image_url') as string)?.trim() || null,
      ingredients,
      instructions: (formData.get('instructions') as string)?.trim() || null,
      original_parsed_json: originalJsonRaw ? JSON.parse(originalJsonRaw) : null,
      state: (isImport ? 'tried' : 'saved') as RecipeState,
    })
    .select('id')
    .single()

  if (error) throw error

  revalidatePath('/recipes')
  return { id: recipe.id }
}
```

to:

```ts
export async function createRecipe(formData: FormData): Promise<{ id: string }> {
  const { db, householdId } = await getContext()

  const ingredientsRaw = formData.get('ingredients') as string
  const ingredients: Ingredient[] = ingredientsRaw ? JSON.parse(ingredientsRaw) : []
  const servings = Math.max(1, parseInt(formData.get('default_servings') as string) || 4)

  const isImport = formData.get('is_import') === 'true'
  const originalJsonRaw = formData.get('original_parsed_json') as string | null

  const title = (formData.get('title') as string).trim()
  const description = (formData.get('description') as string)?.trim() || null
  const instructions = (formData.get('instructions') as string)?.trim() || null

  const tags = await suggestRecipeTags({ title, description, ingredients, instructions })

  const { data: recipe, error } = await db
    .from('recipes')
    .insert({
      household_id: householdId,
      title,
      description,
      default_servings: servings,
      source_url: (formData.get('source_url') as string)?.trim() || null,
      source_image_url: (formData.get('source_image_url') as string)?.trim() || null,
      ingredients,
      instructions,
      original_parsed_json: originalJsonRaw ? JSON.parse(originalJsonRaw) : null,
      state: (isImport ? 'tried' : 'saved') as RecipeState,
      cuisines: tags.cuisines,
      meal_types: tags.meal_types,
      cooking_methods: tags.cooking_methods,
    })
    .select('id')
    .single()

  if (error) throw error

  revalidatePath('/recipes')
  return { id: recipe.id }
}
```

Add a new `updateRecipeTags` action after `updateRecipeState` (`app/recipes/actions.ts:80-88`):

```ts
export async function updateRecipeTags(recipeId: string, tags: RecipeTags): Promise<void> {
  const { db } = await getContext()
  await db
    .from('recipes')
    .update({
      cuisines: tags.cuisines,
      meal_types: tags.meal_types,
      cooking_methods: tags.cooking_methods,
    })
    .eq('id', recipeId)
  revalidatePath('/recipes')
  revalidatePath(`/recipes/${recipeId}`)
}
```

- [ ] **Step 3: Type-check and lint**

Run: `cd ~/Projects/meal-planner && npx tsc --noEmit && npm run lint`
Expected: both exit cleanly.

- [ ] **Step 4: Manual verification (requires the Task 1 migration already applied to the live database)**

Run: `cd ~/Projects/meal-planner && npm run dev`, then create a new recipe through the app (`/recipes/new`). Confirm no error is thrown and the recipe saves. If the migration has been applied, query the `recipes` table (e.g. via the Supabase dashboard) and confirm the new row has non-empty `cuisines`/`meal_types`/`cooking_methods` matching the recipe's content. If the migration has NOT been applied yet, `db.from('recipes').insert(...)` will fail on the unknown columns — that's expected and not a bug in this task; note it in your report rather than trying to work around it.

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/meal-planner
git add lib/recipeTags.ts app/recipes/actions.ts
git commit -m "Auto-tag recipes with cuisine/meal-type/cooking-method on creation"
```

---

### Task 3: Backfill script for existing recipes

**Files:**
- Create: `scripts/backfill-recipe-tags.ts`
- Modify: `package.json` (add `tsx` devDependency)

**Interfaces:**
- Consumes: `createAdminClient` from `lib/supabase/admin.ts`, `suggestRecipeTags` from `lib/recipeTags.ts` (Task 2), `Ingredient` from `lib/types.ts`.
- Produces: nothing consumed by later tasks — this is a standalone, one-off script.

- [ ] **Step 1: Add `tsx` as a dev dependency**

Run: `cd ~/Projects/meal-planner && npm install -D tsx`
Expected: `tsx` appears in `package.json` under `devDependencies`.

- [ ] **Step 2: Create `scripts/backfill-recipe-tags.ts`**

Use relative imports (not the `@/` path alias) so the script runs standalone without needing path-alias resolution configured for `tsx`:

```ts
import { createAdminClient } from '../lib/supabase/admin'
import { suggestRecipeTags } from '../lib/recipeTags'
import type { Ingredient } from '../lib/types'

async function main() {
  const db = createAdminClient()

  const { data: recipes, error } = await db
    .from('recipes')
    .select('id, title, description, ingredients, instructions, cuisines, meal_types, cooking_methods')

  if (error) {
    console.error('Failed to fetch recipes:', error)
    process.exit(1)
  }

  const untagged = (recipes ?? []).filter(
    (r) => r.cuisines.length === 0 && r.meal_types.length === 0 && r.cooking_methods.length === 0
  )

  console.log(`Found ${untagged.length} untagged recipe(s) out of ${recipes?.length ?? 0} total.`)

  for (const recipe of untagged) {
    const tags = await suggestRecipeTags({
      title: recipe.title,
      description: recipe.description,
      ingredients: (recipe.ingredients ?? []) as Ingredient[],
      instructions: recipe.instructions,
    })

    const { error: updateError } = await db
      .from('recipes')
      .update({
        cuisines: tags.cuisines,
        meal_types: tags.meal_types,
        cooking_methods: tags.cooking_methods,
      })
      .eq('id', recipe.id)

    if (updateError) {
      console.error(`Failed to update recipe ${recipe.id} (${recipe.title}):`, updateError)
    } else {
      console.log(`Tagged "${recipe.title}":`, tags)
    }
  }

  console.log('Backfill complete.')
}

main()
```

- [ ] **Step 3: Type-check the script**

Run: `cd ~/Projects/meal-planner && npx tsc --noEmit`
Expected: no new errors from `scripts/backfill-recipe-tags.ts`.

- [ ] **Step 4: Do NOT run the script yet**

This script must only be run against the live database after the Task 1 migration has been applied there (via the Supabase dashboard SQL editor). Running it before that will fail on the missing columns. Note in your report that the script is implemented and type-checks, but has not been executed — running it is a controller-level step, done once the human confirms the migration is live, via:

```bash
cd ~/Projects/meal-planner
set -a; source .env.local; set +a
npx tsx scripts/backfill-recipe-tags.ts
```

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/meal-planner
git add scripts/backfill-recipe-tags.ts package.json package-lock.json
git commit -m "Add one-off backfill script for recipe tags"
```

---

### Task 4: Manual tag editing UI on the recipe detail page

**Files:**
- Create: `app/recipes/[id]/RecipeTags.tsx`
- Modify: `app/recipes/[id]/page.tsx:1-7` (imports), `app/recipes/[id]/page.tsx:69-71` (insert the new section)

**Interfaces:**
- Consumes: `CUISINES`, `MEAL_TYPES`, `COOKING_METHODS`, `RecipeTags` from `lib/recipeTags.ts` (Task 1/2). Consumes `updateRecipeTags` from `app/recipes/actions.ts` (Task 2).
- Produces: `RecipeTags` component (default export of `app/recipes/[id]/RecipeTags.tsx`), props `{ recipeId: string; initialCuisines: string[]; initialMealTypes: string[]; initialCookingMethods: string[] }` — consumed only within `app/recipes/[id]/page.tsx`, not by other tasks.

- [ ] **Step 1: Create `app/recipes/[id]/RecipeTags.tsx`**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { updateRecipeTags } from '../actions'
import { CUISINES, MEAL_TYPES, COOKING_METHODS } from '@/lib/recipeTags'

interface Props {
  recipeId: string
  initialCuisines: string[]
  initialMealTypes: string[]
  initialCookingMethods: string[]
}

type Dimension = 'cuisines' | 'mealTypes' | 'cookingMethods'

export default function RecipeTags({
  recipeId,
  initialCuisines,
  initialMealTypes,
  initialCookingMethods,
}: Props) {
  const [cuisines, setCuisines] = useState(initialCuisines)
  const [mealTypes, setMealTypes] = useState(initialMealTypes)
  const [cookingMethods, setCookingMethods] = useState(initialCookingMethods)
  const [, startTransition] = useTransition()

  function persist(next: { cuisines: string[]; meal_types: string[]; cooking_methods: string[] }) {
    startTransition(() => updateRecipeTags(recipeId, next))
  }

  function toggle(dimension: Dimension, value: string) {
    if (dimension === 'cuisines') {
      const next = cuisines.includes(value) ? cuisines.filter((c) => c !== value) : [...cuisines, value]
      setCuisines(next)
      persist({ cuisines: next, meal_types: mealTypes, cooking_methods: cookingMethods })
    } else if (dimension === 'mealTypes') {
      const next = mealTypes.includes(value) ? mealTypes.filter((c) => c !== value) : [...mealTypes, value]
      setMealTypes(next)
      persist({ cuisines, meal_types: next, cooking_methods: cookingMethods })
    } else {
      const next = cookingMethods.includes(value)
        ? cookingMethods.filter((c) => c !== value)
        : [...cookingMethods, value]
      setCookingMethods(next)
      persist({ cuisines, meal_types: mealTypes, cooking_methods: next })
    }
  }

  function renderPillRow(label: string, options: readonly string[], selected: string[], dimension: Dimension) {
    return (
      <div>
        <p className="text-xs text-gray-400 mb-1.5">{label}</p>
        <div className="flex flex-wrap gap-2">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(dimension, opt)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                selected.includes(opt) ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <section>
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Tags</h2>
      <div className="space-y-4">
        {renderPillRow('Cuisine', CUISINES, cuisines, 'cuisines')}
        {renderPillRow('Meal Type', MEAL_TYPES, mealTypes, 'mealTypes')}
        {renderPillRow('Cooking Method', COOKING_METHODS, cookingMethods, 'cookingMethods')}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Insert the new section into `app/recipes/[id]/page.tsx`**

Change the imports (`app/recipes/[id]/page.tsx:1-7`):

```tsx
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import StateControls from './StateControls'
import RecipeIngredients from './RecipeIngredients'
import type { Recipe, Ingredient } from '@/lib/types'
```

to:

```tsx
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import StateControls from './StateControls'
import RecipeIngredients from './RecipeIngredients'
import RecipeTags from './RecipeTags'
import type { Recipe, Ingredient } from '@/lib/types'
```

Change (`app/recipes/[id]/page.tsx:69-71`, the gap between the title block and the ingredients section):

```tsx
            )}
          </div>

          {ingredients.length > 0 && (
```

to:

```tsx
            )}
          </div>

          <RecipeTags
            recipeId={recipe.id}
            initialCuisines={recipe.cuisines}
            initialMealTypes={recipe.meal_types}
            initialCookingMethods={recipe.cooking_methods}
          />

          {ingredients.length > 0 && (
```

- [ ] **Step 3: Type-check and lint**

Run: `cd ~/Projects/meal-planner && npx tsc --noEmit && npm run lint`
Expected: both exit cleanly.

- [ ] **Step 4: Manual verification (requires the Task 1 migration already applied)**

Run: `cd ~/Projects/meal-planner && npm run dev`, open any existing recipe's detail page, confirm the "Tags" section renders three pill rows, tapping a pill toggles its highlighted state, and reloading the page shows the change persisted.

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/meal-planner
git add app/recipes/\[id\]/RecipeTags.tsx app/recipes/\[id\]/page.tsx
git commit -m "Add manual tag editing UI to recipe detail page"
```

---

### Task 5: Shared filter component + Recipes page integration

**Files:**
- Create: `app/components/RecipeTagFilters.tsx`
- Create: `app/recipes/RecipesListClient.tsx`
- Modify: `app/recipes/page.tsx:1-5` (imports), `app/recipes/page.tsx:102-152` (replace inline list with the new client component)

**Interfaces:**
- Consumes: `CUISINES`, `MEAL_TYPES`, `COOKING_METHODS`, `matchesTagFilter` from `lib/recipeTags.ts` (Task 1).
- Produces: `RecipeTagFilters` component (default export of `app/components/RecipeTagFilters.tsx`), props `{ selectedCuisines: string[]; onCuisinesChange: (next: string[]) => void; selectedMealTypes: string[]; onMealTypesChange: (next: string[]) => void; selectedCookingMethods: string[]; onCookingMethodsChange: (next: string[]) => void; collapsible?: boolean }` — consumed by this task's `RecipesListClient.tsx` and by Task 6's `PlanDetailClient.tsx`.

- [ ] **Step 1: Create `app/components/RecipeTagFilters.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { CUISINES, MEAL_TYPES, COOKING_METHODS } from '@/lib/recipeTags'

function toggleValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

function PillRow({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: readonly string[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(toggleValue(selected, opt))}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selected.includes(opt) ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}

interface Props {
  selectedCuisines: string[]
  onCuisinesChange: (next: string[]) => void
  selectedMealTypes: string[]
  onMealTypesChange: (next: string[]) => void
  selectedCookingMethods: string[]
  onCookingMethodsChange: (next: string[]) => void
  collapsible?: boolean
}

export default function RecipeTagFilters({
  selectedCuisines,
  onCuisinesChange,
  selectedMealTypes,
  onMealTypesChange,
  selectedCookingMethods,
  onCookingMethodsChange,
  collapsible = false,
}: Props) {
  const [expanded, setExpanded] = useState(!collapsible)
  const activeCount = selectedCuisines.length + selectedMealTypes.length + selectedCookingMethods.length

  return (
    <div>
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-sm font-medium text-gray-500 px-1 pb-2"
        >
          Filters{activeCount > 0 ? ` (${activeCount})` : ''} {expanded ? '▲' : '▼'}
        </button>
      )}
      {expanded && (
        <div className="space-y-3 pb-3">
          <PillRow label="Cuisine" options={CUISINES} selected={selectedCuisines} onChange={onCuisinesChange} />
          <PillRow label="Meal Type" options={MEAL_TYPES} selected={selectedMealTypes} onChange={onMealTypesChange} />
          <PillRow
            label="Cooking Method"
            options={COOKING_METHODS}
            selected={selectedCookingMethods}
            onChange={onCookingMethodsChange}
          />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create `app/recipes/RecipesListClient.tsx`**

This extracts the existing `<main>` block from `app/recipes/page.tsx` (lines 102-152) into a client component with added search + tag filter state layered on top:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import RecipeTagFilters from '../components/RecipeTagFilters'
import { matchesTagFilter } from '@/lib/recipeTags'
import type { Recipe } from '@/lib/types'

const STATE_BADGE: Record<string, { label: string; cls: string }> = {
  tried: { label: 'Tried', cls: 'bg-gray-100 text-gray-600' },
  saved: { label: 'Saved', cls: 'bg-blue-100 text-blue-700' },
  favorited: { label: '★ Fave', cls: 'bg-amber-100 text-amber-700' },
}

interface Props {
  recipes: Recipe[]
  emptyIcon: string
  emptyMessage: string
}

export default function RecipesListClient({ recipes, emptyIcon, emptyMessage }: Props) {
  const [search, setSearch] = useState('')
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>([])
  const [selectedMealTypes, setSelectedMealTypes] = useState<string[]>([])
  const [selectedCookingMethods, setSelectedCookingMethods] = useState<string[]>([])

  const q = search.trim().toLowerCase()
  const filtered = recipes.filter((r) => {
    const matchesSearch =
      q === '' || r.title.toLowerCase().includes(q) || r.ingredients.some((i) => i.name.toLowerCase().includes(q))
    return (
      matchesSearch &&
      matchesTagFilter(r.cuisines, selectedCuisines) &&
      matchesTagFilter(r.meal_types, selectedMealTypes) &&
      matchesTagFilter(r.cooking_methods, selectedCookingMethods)
    )
  })

  return (
    <main className="max-w-lg mx-auto px-4 py-4 space-y-3">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search recipes or ingredients…"
        className="w-full px-4 py-2.5 bg-gray-100 rounded-xl text-base focus:outline-none"
      />

      <RecipeTagFilters
        selectedCuisines={selectedCuisines}
        onCuisinesChange={setSelectedCuisines}
        selectedMealTypes={selectedMealTypes}
        onMealTypesChange={setSelectedMealTypes}
        selectedCookingMethods={selectedCookingMethods}
        onCookingMethodsChange={setSelectedCookingMethods}
      />

      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">{emptyIcon}</div>
          <p className="font-medium text-gray-600">{recipes.length === 0 ? emptyMessage : 'No recipes match'}</p>
          {recipes.length === 0 && (
            <Link
              href="/recipes/new"
              className="mt-4 inline-block px-5 py-2.5 bg-green-600 text-white rounded-xl text-sm font-medium"
            >
              Add a recipe
            </Link>
          )}
        </div>
      ) : (
        filtered.map((recipe) => {
          const badge = STATE_BADGE[recipe.state] ?? STATE_BADGE.tried
          return (
            <Link key={recipe.id} href={`/recipes/${recipe.id}`} className="block">
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 active:bg-gray-50">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 text-base truncate">{recipe.title}</h3>
                    {recipe.description && (
                      <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{recipe.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                      <span className="text-xs text-gray-400">{recipe.default_servings} servings</span>
                      {recipe.times_cooked > 0 && (
                        <span className="text-xs text-gray-400">{recipe.times_cooked}× cooked</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          )
        })
      )}
    </main>
  )
}
```

- [ ] **Step 3: Wire it into `app/recipes/page.tsx`**

Change the imports (`app/recipes/page.tsx:1-5`):

```tsx
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Recipe } from '@/lib/types'
```

to:

```tsx
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import RecipesListClient from './RecipesListClient'
import type { Recipe } from '@/lib/types'
```

Remove the now-unused `STATE_BADGE` constant (`app/recipes/page.tsx:7-11`) since it moved into `RecipesListClient.tsx` — delete these lines entirely:

```tsx
const STATE_BADGE: Record<string, { label: string; cls: string }> = {
  tried: { label: 'Tried', cls: 'bg-gray-100 text-gray-600' },
  saved: { label: 'Saved', cls: 'bg-blue-100 text-blue-700' },
  favorited: { label: '★ Fave', cls: 'bg-amber-100 text-amber-700' },
}
```

Change the `<main>` block (`app/recipes/page.tsx:102-152`):

```tsx
      <main className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {recipes.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">{emptyIcon}</div>
            <p className="font-medium text-gray-600">{emptyMessage}</p>
            <Link
              href="/recipes/new"
              className="mt-4 inline-block px-5 py-2.5 bg-green-600 text-white rounded-xl text-sm font-medium"
            >
              Add a recipe
            </Link>
          </div>
        ) : (
          recipes.map((recipe) => {
            const badge = STATE_BADGE[recipe.state] ?? STATE_BADGE.tried
            return (
              <Link key={recipe.id} href={`/recipes/${recipe.id}`} className="block">
                <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 active:bg-gray-50">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 text-base truncate">
                        {recipe.title}
                      </h3>
                      {recipe.description && (
                        <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">
                          {recipe.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                        <span className="text-xs text-gray-400">
                          {recipe.default_servings} servings
                        </span>
                        {recipe.times_cooked > 0 && (
                          <span className="text-xs text-gray-400">
                            {recipe.times_cooked}× cooked
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            )
          })
        )}
      </main>
```

to:

```tsx
      <RecipesListClient recipes={recipes} emptyIcon={emptyIcon} emptyMessage={emptyMessage} />
```

- [ ] **Step 4: Type-check and lint**

Run: `cd ~/Projects/meal-planner && npx tsc --noEmit && npm run lint`
Expected: both exit cleanly.

- [ ] **Step 5: Manual verification (requires the Task 1 migration already applied, ideally with a few recipes already tagged)**

Run: `cd ~/Projects/meal-planner && npm run dev`, open `/recipes`, confirm the search box and filter pills render above the list, typing an ingredient name narrows the list, and toggling a cuisine/meal-type/cooking-method pill narrows it further (OR within a dimension, AND across dimensions).

- [ ] **Step 6: Commit**

```bash
cd ~/Projects/meal-planner
git add app/components/RecipeTagFilters.tsx app/recipes/RecipesListClient.tsx app/recipes/page.tsx
git commit -m "Add tag/ingredient filtering to the Recipes library page"
```

---

### Task 6: Planner "Add from past recipes" filter integration

**Files:**
- Modify: `app/planner/[id]/PlanDetailClient.tsx:1-21` (imports), `:60-80` (new state), `:367-373` (`filteredRecipes`), `:582-595` (insert filter row in the bottom sheet)

**Interfaces:**
- Consumes: `RecipeTagFilters` from `app/components/RecipeTagFilters.tsx` (Task 5), `matchesTagFilter` from `lib/recipeTags.ts` (Task 1). Consumes `RecipeOption.ingredients/.cuisines/.meal_types/.cooking_methods` from Task 1.

- [ ] **Step 1: Add the import**

Change (`app/planner/[id]/PlanDetailClient.tsx:17-20`):

```tsx
import ImportReviewModal from '../ImportReviewModal'
import CustomMealSheet from '../CustomMealSheet'
import RecipeScopeSheet from '../RecipeScopeSheet'
import RecipeEditSheet from '../RecipeEditSheet'
```

to:

```tsx
import ImportReviewModal from '../ImportReviewModal'
import CustomMealSheet from '../CustomMealSheet'
import RecipeScopeSheet from '../RecipeScopeSheet'
import RecipeEditSheet from '../RecipeEditSheet'
import RecipeTagFilters from '../../components/RecipeTagFilters'
import { matchesTagFilter } from '@/lib/recipeTags'
```

- [ ] **Step 2: Add filter state**

Change (`app/planner/[id]/PlanDetailClient.tsx:74-75`):

```tsx
  const [search, setSearch] = useState('')
  const [pickerTab, setPickerTab] = useState<'library' | 'all'>('library')
```

to:

```tsx
  const [search, setSearch] = useState('')
  const [pickerTab, setPickerTab] = useState<'library' | 'all'>('library')
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>([])
  const [selectedMealTypes, setSelectedMealTypes] = useState<string[]>([])
  const [selectedCookingMethods, setSelectedCookingMethods] = useState<string[]>([])
```

- [ ] **Step 3: Extend `filteredRecipes` with ingredient search and tag filters**

Change (`app/planner/[id]/PlanDetailClient.tsx:369-373`):

```tsx
  const filteredRecipes = recipes.filter((r) => {
    const matchesTab = pickerTab === 'all' || r.state === 'saved' || r.state === 'favorited'
    const matchesSearch = r.title.toLowerCase().includes(search.toLowerCase())
    return matchesTab && matchesSearch
  })
```

to:

```tsx
  const filteredRecipes = recipes.filter((r) => {
    const matchesTab = pickerTab === 'all' || r.state === 'saved' || r.state === 'favorited'
    const q = search.toLowerCase()
    const matchesSearch = r.title.toLowerCase().includes(q) || r.ingredients.some((i) => i.name.toLowerCase().includes(q))
    return (
      matchesTab &&
      matchesSearch &&
      matchesTagFilter(r.cuisines, selectedCuisines) &&
      matchesTagFilter(r.meal_types, selectedMealTypes) &&
      matchesTagFilter(r.cooking_methods, selectedCookingMethods)
    )
  })
```

- [ ] **Step 4: Insert the collapsible filter row in the bottom sheet**

Change (`app/planner/[id]/PlanDetailClient.tsx:582-595`):

```tsx
            <div className="flex gap-0 px-4 pb-2">
              {(['library', 'all'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setPickerTab(tab)}
                  className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    pickerTab === tab ? 'bg-green-100 text-green-700' : 'text-gray-500'
                  }`}
                >
                  {tab === 'library' ? 'Library' : 'All Recipes'}
                </button>
              ))}
            </div>
```

to:

```tsx
            <div className="flex gap-0 px-4 pb-2">
              {(['library', 'all'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setPickerTab(tab)}
                  className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    pickerTab === tab ? 'bg-green-100 text-green-700' : 'text-gray-500'
                  }`}
                >
                  {tab === 'library' ? 'Library' : 'All Recipes'}
                </button>
              ))}
            </div>

            <div className="px-4">
              <RecipeTagFilters
                selectedCuisines={selectedCuisines}
                onCuisinesChange={setSelectedCuisines}
                selectedMealTypes={selectedMealTypes}
                onMealTypesChange={setSelectedMealTypes}
                selectedCookingMethods={selectedCookingMethods}
                onCookingMethodsChange={setSelectedCookingMethods}
                collapsible
              />
            </div>
```

- [ ] **Step 5: Type-check and lint**

Run: `cd ~/Projects/meal-planner && npx tsc --noEmit && npm run lint`
Expected: both exit cleanly.

- [ ] **Step 6: Manual verification (requires the Task 1 migration already applied, ideally with a few recipes already tagged)**

Run: `cd ~/Projects/meal-planner && npm run dev`, open a meal plan, tap a day to open "Add from past recipes," confirm a collapsed "Filters" toggle appears below the Library/All Recipes tabs, expanding it shows the three pill rows, and selecting tags narrows the recipe list below (consistent with the Recipes page behavior from Task 5).

- [ ] **Step 7: Commit**

```bash
cd ~/Projects/meal-planner
git add app/planner/\[id\]/PlanDetailClient.tsx
git commit -m "Add tag/ingredient filtering to the planner's add-recipe picker"
```

---

## Self-Review

- **Spec coverage:** data model + presets (Task 1), AI auto-tagging at creation with never-blocking failure handling (Task 2), one-off backfill script (Task 3), manual tag editing (Task 4), Recipes page filtering incl. ingredient search (Task 5), planner sheet filtering with collapsible behavior (Task 6) — every section of the approved spec maps to a task.
- **Placeholder scan:** no TBD/TODO; every step has complete, copy-pasteable code; the one deliberately-deferred action (running the backfill script) is explicitly called out as a controller-level step gated on a human confirmation, not left vague.
- **Type consistency:** `RecipeTags` (`cuisines`/`meal_types`/`cooking_methods: string[]`) is defined once in Task 1 and used identically in Tasks 2-6. `matchesTagFilter(itemTags, selected)` signature is defined once (Task 1) and called identically in Tasks 5 and 6. `RecipeTagFilters` props are defined once (Task 5) and consumed with the same prop names in Task 6.
