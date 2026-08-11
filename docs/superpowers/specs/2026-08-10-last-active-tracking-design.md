# Last Active Tracking — Design

## Problem

`public.users` has `created_at` (visible in the Supabase Table Editor as the user's "first login"), but no way to see when a user last actually used the app. `auth.users.last_sign_in_at` tracks login events natively, but that's not the same thing — a user's session can persist for days, so "last signed in" can be stale while they're still actively using the app daily. We want a `last_active_at` signal that reflects actual usage, not just the login event.

## Architecture

- Add a nullable `last_active_at timestamptz` column to `public.users` via a new migration.
- Extend the existing `middleware.ts` — which already runs on every authenticated request to check the session — to conditionally update that column.

## Data flow

1. Middleware runs its existing `supabase.auth.getSession()` check.
2. If a session exists, issue a conditional update: set `last_active_at = now()` where `id = session.user.id` **and** (`last_active_at` is null **or** older than 1 day).
3. The update runs via `event.waitUntil(...)` (Next.js middleware's non-blocking task API), so it executes after the response has already been sent — no added latency to the request.
4. The existing RLS policy (`users: own`, `for all using (id = auth.uid())`) already permits a user to update their own row, so no new grants, functions, or service-role usage are needed.

## Throttling

Updates are limited to once per day per user (skip the write if the existing `last_active_at` is less than 1 day old). This keeps DB writes minimal — the column is an approximate "is this user still active" signal for admin visibility, not a precise access log, so day-level freshness is sufficient.

## Error handling

The update is wrapped so any failure (network blip, transient DB error, etc.) is caught and logged, never blocks or breaks the request/response cycle. Middleware must remain resilient — a failed analytics-style write should never prevent a user from reaching the app.

## Non-goals

- No UI changes. This mirrors `created_at` — visible only in the Supabase Table Editor, not surfaced anywhere in the app.
- Not a precise access log. Existing users will show `null` until their next visit after this ships; that's expected and self-healing.
- Not a replacement for `auth.users.last_sign_in_at`, which continues to track login events separately.

## Testing

Manual verification only (per project convention — no test suite for this app):
1. Apply the migration locally/on the Supabase project.
2. Log in as a test user; confirm `last_active_at` is set on first authenticated request.
3. Reload immediately; confirm `last_active_at` does *not* change (throttle holds).
4. Manually backdate `last_active_at` to >1 day ago in the DB; reload; confirm it updates to `now()`.
