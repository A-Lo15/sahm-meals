-- supabase/migrations/005_date_range_plans.sql

-- Clear existing plan data (recipes are in a separate table and are NOT touched)
truncate table meal_plans cascade;
-- CASCADE drops rows in meal_plan_recipes and shopping_lists via FK

-- meal_plans: replace week_start_date with start_date + end_date
alter table meal_plans
  drop constraint if exists meal_plans_household_id_week_start_date_key,
  drop column week_start_date,
  add column start_date date not null,
  add column end_date   date not null;

-- meal_plans: enforce date ordering
alter table meal_plans
  add constraint meal_plans_date_range_check check (end_date >= start_date);

-- meal_plan_recipes: replace day_of_week with plan_date
alter table meal_plan_recipes
  drop constraint if exists meal_plan_recipes_day_of_week_check,
  drop column day_of_week,
  add column plan_date date not null;

-- index for per-date slot queries within a plan
create index meal_plan_recipes_plan_date_idx
  on meal_plan_recipes (meal_plan_id, plan_date);
