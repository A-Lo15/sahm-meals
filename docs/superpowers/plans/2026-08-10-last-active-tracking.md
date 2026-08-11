# Last Active Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track when each user last actually used the app (not just when they last logged in) by adding a throttled `last_active_at` column, updated non-blockingly from existing session middleware.

**Architecture:** A nullable `last_active_at timestamptz` column on `public.users`. The existing `middleware.ts` — which already runs `supabase.auth.getSession()` on every authenticated request — issues a conditional, non-blocking update (`event.waitUntil`) once the existing value is missing or more than 1 day old. No new routes, clients, or UI.

**Tech Stack:** Next.js 14 middleware (`NextFetchEvent.waitUntil`), `@supabase/ssr`, Postgres/Supabase (RLS-scoped update).

## Global Constraints

- No automated test suite in this project (confirmed: no jest/vitest in `package.json`). Verification is manual: `npx tsc --noEmit` for type safety, plus direct `curl` checks against Supabase for runtime behavior.
- Supabase migrations in this repo are applied manually via the Supabase Dashboard SQL Editor — there is no linked Supabase CLI project (no `supabase/config.toml`, no CLI scripts in `package.json`). Every migration task includes an explicit "apply it in the dashboard" step.
- The `users` table has RLS enabled with no anon-role grants, so schema/data verification during migration must use the service-role key (`SUPABASE_SERVICE_ROLE_KEY` in `.env.local`), never the anon key — mirrors the existing `lib/supabase/admin.ts` pattern.

---

## File Map

| File | Change |
|------|--------|
| `supabase/migrations/008_last_active.sql` | Create — adds `last_active_at` column |
| `middleware.ts` | Modify — throttled, non-blocking update on authenticated requests |

---

### Task 1: Migration — add `last_active_at` column

**Files:**
- Create: `supabase/migrations/008_last_active.sql`

**Interfaces:**
- Produces: `public.users.last_active_at` (nullable `timestamptz`), which Task 2 writes to.

**Context:** Follows the same pattern as `supabase/migrations/006_pantry_staples.sql` — a single `alter table ... add column if not exists`.

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/008_last_active.sql
alter table users
  add column if not exists last_active_at timestamptz;
```

- [ ] **Step 2: Apply the migration**

Open the Supabase Dashboard → SQL Editor for this project, paste the contents of `supabase/migrations/008_last_active.sql`, and run it.

- [ ] **Step 3: Verify the column exists**

Run (uses the service-role key to bypass RLS — the anon key has no grants on `users` and will fail regardless of whether the column exists):

```bash
cd /Users/austin.louthan/Projects/meal-planner
SUPABASE_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2-)
SERVICE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2-)
curl -s "${SUPABASE_URL}/rest/v1/users?select=id,last_active_at&limit=1" \
  -H "apikey: ${SERVICE_KEY}" -H "Authorization: Bearer ${SERVICE_KEY}"
```

Expected: a JSON array with one object containing a `last_active_at` key (value will be `null` for existing users — expected, matches the spec's non-goals).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/008_last_active.sql
git commit -m "feat: add last_active_at column to users"
```

---

### Task 2: Middleware — throttled non-blocking update

**Files:**
- Modify: `middleware.ts`

**Interfaces:**
- Consumes: `public.users.last_active_at` (Task 1).
- Produces: nothing — this is the final task.

**Context:** `middleware.ts` currently reads:

```typescript
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const isAuthRoute =
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/auth");

  if (!session && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

The `supabase` client here already carries the user's session (set up via `getSession()`), so a `.from("users").update(...)` call from it runs as that authenticated user — the existing `"users: own"` RLS policy (`id = auth.uid()`) permits the write with no new grants.

> **Amendment (2026-08-11):** this assumption was wrong. Postgres requires a table-level grant before RLS policies take effect — `authenticated` had none. See `supabase/migrations/009_grant_authenticated_users.sql` and `010_narrow_authenticated_users_grant.sql`.

- [ ] **Step 1: Add the `NextFetchEvent` import and parameter**

Find:
```typescript
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
```

Replace with:
```typescript
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";

export async function middleware(request: NextRequest, event: NextFetchEvent) {
```

- [ ] **Step 2: Add the throttled, non-blocking update**

Find:
```typescript
  if (!session && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
```

Replace with:
```typescript
  if (!session && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (session) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    event.waitUntil(
      supabase
        .from("users")
        .update({ last_active_at: new Date().toISOString() })
        .eq("id", session.user.id)
        .or(`last_active_at.is.null,last_active_at.lt.${cutoff}`)
        .then(({ error }) => {
          if (error) {
            console.error("middleware: failed to update last_active_at", error);
          }
        })
        .catch((error) => {
          console.error("middleware: failed to update last_active_at", error);
        })
    );
  }

  return supabaseResponse;
}
```

This runs after the redirect check, so it only fires for requests that actually reach the app with a valid session. `event.waitUntil` lets this write happen after the response is sent — it adds no latency to the request. The `.or(...)` clause means the `UPDATE` only touches a row when `last_active_at` is `null` or more than a day old, so a user browsing normally triggers at most one write per day.

- [ ] **Step 3: Type-check**

```bash
cd /Users/austin.louthan/Projects/meal-planner
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Manual runtime test — first visit sets the timestamp**

Start the dev server:
```bash
cd /Users/austin.louthan/Projects/meal-planner
npm run dev
```

In a browser, log in as any existing test user and load any page past `/login`.

Then verify the row updated (this orders by `last_active_at` descending, so the most recently active user — the one you just logged in as — comes back first):
```bash
cd /Users/austin.louthan/Projects/meal-planner
SUPABASE_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2-)
SERVICE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2-)
curl -s "${SUPABASE_URL}/rest/v1/users?select=id,last_active_at&order=last_active_at.desc&limit=1" \
  -H "apikey: ${SERVICE_KEY}" -H "Authorization: Bearer ${SERVICE_KEY}"
```

Expected: `last_active_at` is a timestamp within the last minute or two (not `null`).

- [ ] **Step 5: Manual runtime test — throttle holds within the same day**

Reload the page a couple of times in the browser (same logged-in user), then re-run the same `curl` check from Step 4.

Expected: `last_active_at` is unchanged from Step 4 (same value) — the throttle is holding.

- [ ] **Step 6: Manual runtime test — throttle releases after 1 day**

Manually backdate the row to simulate staleness (replace `<user-id>` with the id from Step 4's response):
```bash
cd /Users/austin.louthan/Projects/meal-planner
SUPABASE_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2-)
SERVICE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2-)
curl -s -X PATCH "${SUPABASE_URL}/rest/v1/users?id=eq.<user-id>" \
  -H "apikey: ${SERVICE_KEY}" -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"last_active_at": "2000-01-01T00:00:00Z"}'
```

Reload the page in the browser (same logged-in user), then re-run the `curl` check from Step 4.

Expected: `last_active_at` has updated to a fresh timestamp (within the last minute or two), confirming the throttle releases once the existing value is stale.

- [ ] **Step 7: Commit**

```bash
cd /Users/austin.louthan/Projects/meal-planner
git add middleware.ts
git commit -m "feat: track last_active_at via throttled middleware update"
```
