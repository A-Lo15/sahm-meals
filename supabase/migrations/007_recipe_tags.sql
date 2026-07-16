alter table recipes
  add column if not exists cuisines text[] not null default '{}',
  add column if not exists meal_types text[] not null default '{}',
  add column if not exists cooking_methods text[] not null default '{}';
