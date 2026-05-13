-- supabase/migrations/004_in_library.sql
alter table recipes add column in_library boolean not null default true;
