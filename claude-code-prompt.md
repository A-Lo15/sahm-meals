# Build Prompt: Meal Planning App — Phase 1

Full spec is in `meal-planning-app-phase1-spec.md` in this directory. Read it before any code.

Goal: get me to a locally-running app on my phone, fast. We work in checkpoints — you pause at each one, I test, then you proceed.

## Rules

- Read the spec; don't reinterpret its design decisions.
- Pause at every checkpoint. Don't continue without my go-ahead.
- Small choices (file structure, naming, libraries): decide and move on. User-facing or architectural deviations from the spec: ask first.
- Tech stack is fixed: Next.js 14 App Router, TypeScript, Tailwind, Supabase, Vercel, Anthropic API.
- Mobile-first; 375px baseline, no hover-only interactions.
- Git from the start. Commit at each checkpoint, conventional messages.
- Tests for tricky logic only: URL parsing, ingredient aggregation/scaling, quality transforms, store routing.
- Don't over-engineer. Single-household app.

## Setup (do first)

1. Tell me what credentials I need (Supabase URL + anon key, Anthropic key) and how to get them.
2. Generate `.env.local.example`.
3. Init Next.js with TS + Tailwind + App Router + ESLint.
4. Run schema migration covering all tables in spec §3.
5. Magic-link auth via Supabase.
6. **Checkpoint 1:** I run dev, sign in on phone, see authenticated home. Stop.

## Checkpoints

After each: report what works, what to test, what you need from me. Then stop.

**2. Recipe core** — manual entry form, detail view, list with This Week / Library / History filters, state model (tried/saved/favorited), reset-to-original button (plumbing only).

**3. URL import** — schema.org/Recipe JSON-LD parser; Claude Haiku fallback for unmarked pages; Pinterest pins follow outbound link first; preserve `original_parsed_json`.

**4. Weekly planner** — Mon–Sun calendar, add recipes from library or import, per-slot servings override, copy-from-previous-week, autosave.

**5. Shopping list** — aggregate + scale across week, merge recurring staples (build staples UI here), apply quality transforms (spec §6), unit-aware dedup, categorize, route across 3 selected stores per spec §7, settings for store selection, editable output with persisted overrides.

**6. PWA + polish** — manifest, service worker (cache shell + latest list), iOS install banner, empty/loading/error states, 375px polish, README (setup + env + migrations + deploy).

## Out of scope (don't add, don't block)

Pantry tracking, price logging, AI suggestions, multi-user, push notifications, auto-cart at stores. See spec §10.

## End-of-checkpoint format

1. What's working
2. What I should test
3. What you need from me

Then stop.

Begin: read the spec, walk me through Setup.
