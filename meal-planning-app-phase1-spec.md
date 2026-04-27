# Meal Planning App — Phase 1 Build Spec

A mobile-first Progressive Web App that helps a household of four plan weekly meals, manage a recipe library, and generate organized shopping lists split across 3 grocery stores. Quality-aware ingredient defaults reflect the household's preference for organic produce, pasture-raised eggs, grass-fed beef and butter, free-range chicken, and organic milk.

---

## 1. Tech Stack

- **Frontend:** Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Backend:** Next.js API routes (same project)
- **Database + Auth:** Supabase (Postgres + magic-link email auth, free tier)
- **AI:** Anthropic API — Claude Haiku for recipe parsing fallback
- **Hosting:** Vercel free tier
- **PWA:** Web app manifest + service worker for installability and offline shopping list access

**Operating cost target:** $0/month under household-scale usage. Anthropic API for recipe parsing is the only variable cost — expected well under $1/month at typical use.

---

## 2. Auth Model

Single shared household account. Magic-link login via Supabase Auth (no passwords). Both spouses log in with same email or via shared link. Schema supports per-user accounts in the future without migration.

---

## 3. Data Model

### `households`
- `id`, `name`, `default_servings` (int, default 4)
- `preferences` (JSON): quality defaults, dietary notes, primary stores selected (max 3)

### `users`
- `id`, `email`, `household_id`

### `recipes`
- `id`, `household_id`
- `title`, `description`, `default_servings` (int)
- `source_url`, `source_image_url`
- `ingredients` (JSON array of `{ name, quantity, unit, category, notes }`)
- `instructions` (text)
- `original_parsed_json` — preserved snapshot of the first parsed version, never overwritten; supports "reset to original"
- `state` — enum: `tried` | `saved` | `favorited`
- `last_cooked_at`, `times_cooked` (int)
- `created_at`, `updated_at`

### `meal_plans`
- `id`, `household_id`, `week_start_date` (Monday)

### `meal_plan_recipes`
- `id`, `meal_plan_id`, `recipe_id`
- `day_of_week` (0–6), `meal_slot` (e.g. dinner)
- `servings_override` (int, nullable — falls back to recipe default)
- `notes`

### `staples` (recurring grocery items)
- `id`, `household_id`, `name`, `quantity`, `unit`, `category`
- `default_store`, `paused` (bool)

### `shopping_lists`
- `id`, `meal_plan_id`, `generated_at`
- `store_assignments` (JSON: store → array of items, each with editable quantity/quality flags)
- `manual_overrides` (JSON: items moved/added/removed by user post-generation)

### `prices` (schema-ready for Phase 3, unused in Phase 1)
- `id`, `household_id`, `ingredient_normalized`, `store`, `unit_price`, `recorded_at`

---

## 4. Recipe State Model

| State | Meaning | How entered |
|---|---|---|
| `tried` | Used in a plan, not committed to library | Default on import |
| `saved` | Kept in permanent library | One tap from a recipe card |
| `favorited` | Top-tier; weighted higher in suggestions | One tap from saved |

**Library views:**
- *This Week* — recipes in the current meal plan, regardless of state
- *Library* — only `saved` + `favorited`
- *History* — all recipes ever, including `tried`

**Suggestion engine** (Phase 4) pulls from `saved` + `favorited`, weighting favorited 2×.

---

## 5. Core User Flows

### 5.1 Import recipe from URL
1. User taps + → pastes URL (Pinterest pin, recipe blog, etc.)
2. If URL is a Pinterest pin, follow the outbound link to the source recipe page
3. Attempt to extract `schema.org/Recipe` JSON-LD from the page (works for ~70–80% of recipe blogs)
4. If no structured data found, send page HTML to Claude Haiku with a parsing prompt that returns structured JSON: title, ingredients (with quantity/unit), instructions, default servings, image URL
5. Pre-fill recipe form, user reviews and edits
6. On save: store both `original_parsed_json` and the (potentially edited) live record. State = `tried`.

### 5.2 Plan the week
1. Open *This Week* view — calendar grid Mon–Sun
2. Tap any day → add a recipe (search Library, browse History, or Import new)
3. Adjust servings per slot (input field, defaults to recipe's `default_servings`)
4. Optional notes per day
5. Auto-saves; can copy from previous week as a starting point

### 5.3 Generate shopping list
1. From the planned week, tap *Generate Shopping List*
2. Aggregate ingredients across all recipes, scaling each by `servings_override / recipe.default_servings`
3. Merge recurring staples (skipping any paused ones)
4. Apply quality transforms (see §6)
5. Combine duplicates with unit-aware math (e.g. 1 lb + 8 oz beef → 1.5 lb)
6. Categorize each item (produce, dairy, meat, pantry, frozen, household)
7. Route each item across the user's 3 selected stores using the heuristic rules in §7
8. Output: 3 lists, each sorted by typical store layout
9. Lists are editable post-generation: move items between stores, add/remove, mark off while shopping. Manual overrides persist in `manual_overrides`.

### 5.4 Manage recipe states
- Heart icon on recipe → toggles `tried` ↔ `saved`
- Star icon → toggles `saved` ↔ `favorited`
- Long-press for full state menu, including "remove from library"

### 5.5 Get suggestions (stubbed in Phase 1, full feature in Phase 4)
- *Suggest meals* button on planner with two options:
  - **From my library** — rotation through `saved` + `favorited`, prioritizing recipes not cooked recently
  - **Something new** — calls Claude API with household context (preferences, recent meals, season) to suggest novel recipes; user can import any suggestion
- Phase 1 ships the *From my library* version only

---

## 6. Quality Defaults

Applied automatically when generating shopping list. Visible on the list as the qualified item ("organic spinach" not "spinach").

| Ingredient category | Quality prefix |
|---|---|
| Produce (fruit, vegetables, herbs) | organic |
| Eggs | pasture-raised |
| Beef (any cut) | grass-fed |
| Butter | grass-fed |
| Chicken (any cut) | free-range |
| Milk | organic |

All rules editable in settings. When in doubt between two product choices, app defaults to the healthier option (e.g. whole-grain over refined, lower-sugar variants).

---

## 7. Three-Store Routing Heuristics (Phase 1: hardcoded)

User selects up to 3 primary stores in settings from: Harris Teeter, Food Lion, Walmart, Target, Wegmans, Whole Foods, Trader Joe's, Sam's Club. Default selection for ZIP 27604:

1. **Sam's Club** — bulk meat, dairy, eggs, household, snacks in volume
2. **Trader Joe's** — snacks, frozen meals/sides, pantry staples, easy weeknight ingredients
3. **Wegmans** — produce, specialty items, anything not optimal at the other two

**Routing rules (Phase 1):**
- Bulk-friendly staples (eggs, butter, ground beef, chicken breast, paper goods) → primary bulk store
- Frozen, snacks, packaged sides → Trader Joe's
- Produce, fresh herbs, specialty items, fish → Wegmans
- Items the user has manually moved before for a given category → respect that preference (lightweight learning even pre-Phase 3)

If user picks fewer than 3 stores, rules collapse to fit. If they pick 3 different stores, fallback rules use the same category-to-store-type mapping (any bulk store → bulk role, etc.).

Phase 3 replaces these heuristics with learned routing from logged prices.

---

## 8. Recurring Staples

Settings page lists items always bought regardless of recipes (e.g. bananas, organic milk, pasture-raised eggs, kid snacks, bread). Each has:
- Default quantity, unit, store
- "Pause for this week" toggle (resets weekly)
- Quick-add from shopping list ("always add this")

Auto-merged into shopping list during generation.

---

## 9. PWA Requirements

- Web app manifest with name, icons (multiple sizes), `display: standalone`, theme color
- Service worker caches static shell + last-generated shopping list for offline access in-store
- iOS install prompt UI (Safari doesn't auto-prompt) on first visit
- Mobile viewport tuning, large touch targets, no hover-only interactions

---

## 10. Out of Scope for Phase 1

- Pantry tracking (Phase 2+)
- Price logging and adaptive routing (Phase 3)
- AI "something new" suggestions (Phase 4 — button is stubbed)
- Per-user accounts within a household
- Push notifications
- Auto-building carts at retailer apps/sites (no APIs available across these 8 stores)

---

## 11. Known Limitations to Surface in UI

- Pinterest pins that are screenshots of recipe cards (no outbound link to a recipe page) cannot be auto-parsed → app falls back to manual entry with image upload
- ~20–30% of recipe blogs lack schema.org markup; Claude Haiku fallback handles these but takes a few seconds
- Store routing in Phase 1 is heuristic — accuracy improves substantially in Phase 3 once price logging is added

---

## 12. Phase 1 Acceptance Criteria

1. URL import produces a structured, editable recipe in under 10 seconds for schema.org-tagged sources, under 20 for fallback parsing
2. A full week of meals can be planned in under 5 minutes once the library has recipes in it
3. Shopping list generation runs in under 3 seconds and produces 3 organized, store-categorized lists
4. Quality defaults are applied automatically and clearly visible
5. Recipe state model (tried / saved / favorited) functions as specified, including reset-to-original
6. Recurring staples merge correctly, respect pause flag
7. App installs to iOS and Android home screens as a PWA
8. All views work cleanly on a phone-sized viewport (375px width baseline)

---

## 13. Suggested Build Order

1. Project bootstrap: Next.js + TypeScript + Tailwind + Supabase client + magic-link auth
2. Database schema migration (all tables from §3)
3. Recipe model + manual entry form + recipe detail view
4. URL import: schema.org JSON-LD parser, then Claude Haiku fallback
5. Recipe state management (tried / saved / favorited) + Library view
6. Weekly meal plan UI (calendar grid, add/remove recipes, servings override)
7. Shopping list generation engine (aggregation, scaling, dedup, categorization)
8. Quality default transforms layer
9. Three-store routing heuristics + store selection in settings
10. Recurring staples management
11. Shopping list edit UI (move items, manual additions, check off)
12. PWA manifest + service worker + install prompts
13. Polish: empty states, loading states, error handling, mobile testing

---

## 14. Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
```

---

## 15. Future Phases (for context, not for Phase 1 implementation)

- **Phase 2:** Pantry tracking (add to schema, deduct from shopping list when item is in pantry)
- **Phase 3:** Price logging UI + adaptive store routing based on observed prices
- **Phase 4:** Claude-powered "something new" meal suggestions, drawing on season, history, preferences

---
