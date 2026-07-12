# Flexible Date-Range Meal Planning — Design Spec

**Date:** 2026-07-11
**Status:** Approved

## Problem

The app currently forces planning in fixed Monday–Sunday weekly increments. In practice, planning weeks vary — sometimes shorter, sometimes starting mid-week, sometimes needing an extra day or two beyond a standard week. The goal is to replace the fixed weekly model with user-defined date ranges.

---

## Requirements

- User can create a meal plan for any start date and end date (typically 4–10 days)
- No restriction on overlapping date ranges across plans
- The planner landing always shows the plans list — no auto-navigation to a "current" plan
- Shopping list generation always covers the full date range of the selected plan
- All existing recipes are preserved; existing meal plan and shopping list data is cleared

---

## Data Model

### `meal_plans`

Remove `week_start_date date` and its unique constraint `(household_id, week_start_date)`.

Add:
```sql
start_date date not null
end_date   date not null
```

No unique constraint on dates. Overlap between plans is explicitly allowed.

### `meal_plan_recipes`

Remove `day_of_week smallint` (which was a 0–6 offset from the plan's Monday).

Add:
```sql
plan_date date not null
```

Each slot now stores an absolute calendar date, making it self-describing without reference to the parent plan's start week.

### Unchanged tables

- `recipes` — untouched entirely
- `staples` — untouched
- `shopping_lists` — still 1:1 with `meal_plan_id`; no structural change

### Migration

Truncate in foreign-key order: `shopping_lists` → `meal_plan_recipes` → `meal_plans`. Then apply the column changes. Recipes are in a separate table and never touched.

---

## Routing

| Route | Purpose |
|---|---|
| `/planner` | Plans list — always the landing |
| `/planner/[id]` | Plan detail for a specific plan |

The current `/planner?week=DATE` URL is removed.

---

## Plans List (`/planner`)

- Shows all plans sorted by `start_date` descending
- Each row displays the date range (e.g., "Wed Jul 9 – Mon Jul 14") and meal count
- "New Plan" button opens the date range picker sheet
- Tapping a plan navigates to `/planner/[id]`

---

## New Plan Flow

Tapping "New Plan" opens a bottom sheet with a calendar date range picker:

1. Tap a start date
2. Tap an end date
3. Tap "Create Plan"

The `meal_plans` record is inserted and the user is immediately navigated to `/planner/[id]`.

---

## Plan Detail (`/planner/[id]`)

**Header:** Displays the plan's date range (e.g., "Jul 11 – Jul 17") and a back arrow returning to the plans list.

**Day columns:** One column per date in the range, from `start_date` to `end_date` inclusive. Column headers show a two-line label — day name on top ("Fri"), month and date below ("Jul 11"). On mobile, columns scroll horizontally when the range exceeds screen width.

**Functionality:** Identical to the current planner — add recipes from library, import from URL, create custom meals, adjust servings, remove slots, edit recipes. All actions operate on `plan_date` (absolute date) instead of `day_of_week`.

---

## Shopping List

No structural changes. Generation still:

1. Loads all `meal_plan_recipes` for the `meal_plan_id`
2. Scales ingredient quantities by `servings_override / recipe.default_servings`
3. Merges staples
4. Applies quality defaults
5. Runs cross-unit consolidation and conflict resolution
6. Routes items to stores

The only change is that slots are now keyed by `plan_date` (a date string) instead of `day_of_week` (an integer 0–6). The aggregation, conflict detection, and store assignment logic are untouched.

---

## Edge Cases

- **Single-day plan:** `start_date == end_date`. Shows one column. Everything works normally.
- **Overlapping plans:** Allowed. The plans list shows all plans; the user opens whichever they want.
- **Large ranges:** No hard cap enforced in code. UI handles any length via horizontal scroll.

---

## Out of Scope

- Copy-from-previous-plan feature
- Plan naming / labeling
- Plan deletion UI (can be added later)
- Any changes to recipe state management, staples, or store configuration
