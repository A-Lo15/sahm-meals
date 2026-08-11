-- supabase/migrations/008_last_active.sql
alter table users
  add column if not exists last_active_at timestamptz;
