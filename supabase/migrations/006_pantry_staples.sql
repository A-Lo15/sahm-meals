alter table households
  add column if not exists pantry_staples text[] not null default '{}';
