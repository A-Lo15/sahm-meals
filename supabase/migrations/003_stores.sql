create table if not exists stores (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  name          text not null,
  abbreviation  text not null,
  display_order int  not null default 0,
  created_at    timestamptz not null default now()
);

alter table stores enable row level security;

create policy "stores: household" on stores
  for all using (household_id = my_household_id());

-- Seed 3 default stores for all existing households
insert into stores (household_id, name, abbreviation, display_order)
select h.id, s.name, s.abbreviation, s.ord
from households h
cross join (values
  ('Whole Foods',  'WF', 0),
  ('Sam''s Club',  'SC', 1),
  ('Trader Joe''s','TJ', 2)
) as s(name, abbreviation, ord);

-- Seed defaults for new households going forward
create or replace function seed_default_stores()
returns trigger language plpgsql as $$
begin
  insert into stores (household_id, name, abbreviation, display_order) values
    (new.id, 'Whole Foods',  'WF', 0),
    (new.id, 'Sam''s Club',  'SC', 1),
    (new.id, 'Trader Joe''s','TJ', 2);
  return new;
end; $$;

create trigger household_default_stores
  after insert on households
  for each row execute function seed_default_stores();

grant all on stores to service_role;
