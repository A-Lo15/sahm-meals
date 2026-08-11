-- The "users: own" RLS policy (001_initial_schema.sql) has always existed but
-- was never reachable: Postgres requires a table-level grant before RLS policies
-- take effect, and the authenticated role was never granted one. Every existing
-- code path queries via the service-role admin client, which bypasses this
-- entirely, so the gap was never surfaced until middleware started querying as
-- the authenticated user directly.
grant select, update on public.users to authenticated;
