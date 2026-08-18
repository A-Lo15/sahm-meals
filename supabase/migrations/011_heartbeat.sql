-- supabase/migrations/011_heartbeat.sql
-- The GitHub Actions keepalive cron previously pinged /auth/v1/health, which
-- never touches Postgres. Supabase's free-tier pause check looks at database
-- query volume over the trailing week, not "was any endpoint hit" -- the cron
-- was reporting success while the project still paused. This table exists
-- solely so the cron has a real, harmless row to SELECT.
create table if not exists heartbeat (
  id        smallint primary key default 1,
  pinged_at timestamptz not null default now()
);
insert into heartbeat (id) values (1) on conflict (id) do nothing;

alter table heartbeat enable row level security;

-- No real data lives here -- safe to allow anonymous read so the
-- unauthenticated GitHub Actions cron can query it directly.
create policy "heartbeat: anon read" on heartbeat
  for select using (true);

grant select on public.heartbeat to anon;
