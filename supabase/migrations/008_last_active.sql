-- supabase/migrations/008_last_active.sql
-- Tracks actual app usage (see middleware.ts), distinct from
-- auth.users.last_sign_in_at which only tracks login events.
alter table users
  add column if not exists last_active_at timestamptz;
