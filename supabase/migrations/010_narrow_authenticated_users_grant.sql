-- 009 granted select/update on the whole users table. The "users: own" RLS
-- policy (id = auth.uid()) has no WITH CHECK clause, so it constrains which
-- row a user can touch but not which columns — table-wide update left
-- household_id (the app's tenancy boundary) writable by any authenticated
-- user. Every other part of the app resolves household access via the
-- service-role admin client, which bypasses RLS entirely, so a user
-- rewriting their own household_id would gain access to another
-- household's data through the normal app UI.
--
-- This feature only ever needs id (for the WHERE clause) and
-- last_active_at (read + write), so narrow to exactly that.
revoke select, update on public.users from authenticated;
grant select (id, last_active_at) on public.users to authenticated;
grant update (last_active_at)     on public.users to authenticated;
