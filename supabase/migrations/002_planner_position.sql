alter table meal_plan_recipes
  add column if not exists position integer not null default 0;
