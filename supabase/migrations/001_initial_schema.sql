-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─── households ───────────────────────────────────────────────────────────────
create table if not exists households (
  id               uuid primary key default uuid_generate_v4(),
  name             text not null default 'My Household',
  default_servings integer not null default 4,
  preferences      jsonb not null default '{
    "quality_defaults": {
      "produce":  "organic",
      "eggs":     "pasture-raised",
      "beef":     "grass-fed",
      "butter":   "grass-fed",
      "chicken":  "free-range",
      "milk":     "organic"
    },
    "primary_stores": ["Sam'\''s Club", "Trader Joe'\''s", "Wegmans"]
  }'::jsonb,
  created_at       timestamptz not null default now()
);

-- ─── users ────────────────────────────────────────────────────────────────────
-- Links Supabase auth.users to a household.
create table if not exists users (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  household_id uuid references households(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- ─── recipes ──────────────────────────────────────────────────────────────────
create type recipe_state as enum ('tried', 'saved', 'favorited');

create table if not exists recipes (
  id                   uuid primary key default uuid_generate_v4(),
  household_id         uuid not null references households(id) on delete cascade,
  title                text not null,
  description          text,
  default_servings     integer not null default 4,
  source_url           text,
  source_image_url     text,
  ingredients          jsonb not null default '[]'::jsonb,
  -- each element: { name, quantity, unit, category, notes }
  instructions         text,
  original_parsed_json jsonb,
  -- preserved snapshot of first parse; never overwritten; supports reset-to-original
  state                recipe_state not null default 'tried',
  last_cooked_at       timestamptz,
  times_cooked         integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ─── meal_plans ───────────────────────────────────────────────────────────────
create table if not exists meal_plans (
  id              uuid primary key default uuid_generate_v4(),
  household_id    uuid not null references households(id) on delete cascade,
  week_start_date date not null, -- always a Monday
  created_at      timestamptz not null default now(),
  unique (household_id, week_start_date)
);

-- ─── meal_plan_recipes ────────────────────────────────────────────────────────
create table if not exists meal_plan_recipes (
  id               uuid primary key default uuid_generate_v4(),
  meal_plan_id     uuid not null references meal_plans(id) on delete cascade,
  recipe_id        uuid not null references recipes(id) on delete cascade,
  day_of_week      smallint not null check (day_of_week between 0 and 6), -- 0=Mon
  meal_slot        text not null default 'dinner',
  servings_override integer,  -- null → use recipe.default_servings
  notes            text,
  created_at       timestamptz not null default now()
);

-- ─── staples ──────────────────────────────────────────────────────────────────
create table if not exists staples (
  id            uuid primary key default uuid_generate_v4(),
  household_id  uuid not null references households(id) on delete cascade,
  name          text not null,
  quantity      numeric,
  unit          text,
  category      text,
  default_store text,
  paused        boolean not null default false,
  created_at    timestamptz not null default now()
);

-- ─── shopping_lists ───────────────────────────────────────────────────────────
create table if not exists shopping_lists (
  id               uuid primary key default uuid_generate_v4(),
  meal_plan_id     uuid not null references meal_plans(id) on delete cascade,
  generated_at     timestamptz not null default now(),
  store_assignments jsonb not null default '{}'::jsonb,
  -- { "Store Name": [{ name, quantity, unit, category, quality, checked }] }
  manual_overrides  jsonb not null default '{}'::jsonb,
  -- { added: [], removed: [], moved: [] }
  unique (meal_plan_id)
);

-- ─── prices (schema-ready, unused Phase 1) ────────────────────────────────────
create table if not exists prices (
  id                    uuid primary key default uuid_generate_v4(),
  household_id          uuid not null references households(id) on delete cascade,
  ingredient_normalized text not null,
  store                 text not null,
  unit_price            numeric,
  recorded_at           timestamptz not null default now()
);

-- ─── updated_at trigger ───────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger recipes_updated_at
  before update on recipes
  for each row execute function set_updated_at();

-- ─── auto-create user + household on first sign-in ───────────────────────────
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  new_household_id uuid;
begin
  -- create a household for this user
  insert into households (name)
  values ('My Household')
  returning id into new_household_id;

  -- create the user record
  insert into users (id, email, household_id)
  values (new.id, new.email, new_household_id);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ─── Row Level Security ───────────────────────────────────────────────────────
alter table households        enable row level security;
alter table users             enable row level security;
alter table recipes           enable row level security;
alter table meal_plans        enable row level security;
alter table meal_plan_recipes enable row level security;
alter table staples           enable row level security;
alter table shopping_lists    enable row level security;
alter table prices            enable row level security;

-- Helper: get the household_id for the calling user
create or replace function my_household_id()
returns uuid language sql stable security definer as $$
  select household_id from users where id = auth.uid()
$$;

-- households: user can see/edit their own household
create policy "households: own" on households
  for all using (id = my_household_id());

-- users: user can see/edit their own row
create policy "users: own" on users
  for all using (id = auth.uid());

-- recipes: scoped to household
create policy "recipes: household" on recipes
  for all using (household_id = my_household_id());

-- meal_plans: scoped to household
create policy "meal_plans: household" on meal_plans
  for all using (household_id = my_household_id());

-- meal_plan_recipes: via meal_plan
create policy "meal_plan_recipes: household" on meal_plan_recipes
  for all using (
    meal_plan_id in (
      select id from meal_plans where household_id = my_household_id()
    )
  );

-- staples: scoped to household
create policy "staples: household" on staples
  for all using (household_id = my_household_id());

-- shopping_lists: via meal_plan
create policy "shopping_lists: household" on shopping_lists
  for all using (
    meal_plan_id in (
      select id from meal_plans where household_id = my_household_id()
    )
  );

-- prices: scoped to household
create policy "prices: household" on prices
  for all using (household_id = my_household_id());
