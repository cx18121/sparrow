# Roadmap: Sparrow

## Current State

Sparrow has moved beyond the original three-phase scaffold. The active product is a Vite React + Vercel Functions + Supabase app with campaign workspaces, Gmail sending, Apollo contact search/reveal, Claude drafting, Exa/Tavily research, and a redesigned Home/Templates/Settings shell.

Historical phase documents under `.planning/phases/` and `.planning/research/` are archived planning notes. Use `CONTEXT.md`, `AGENTS.md`, `CLAUDE.md`, this roadmap, and ADRs for current truth.

## Shipped Foundation

- Supabase auth and profile persistence.
- Google OAuth + Gmail send grant/reconnect.
- Host-managed Claude generation.
- Shared Company/Contact pool and user-scoped Leads, Custom Contacts, Campaigns, Templates, Emails.
- Campaign-first IA and sidebar.
- Full-screen create campaign wizard.
- Campaign workspace routes.
- Template library with verbatim default and optional AI rewrite.
- Draft generation, review, attachment selection, and Gmail sending.
- Apollo search/reveal flows.
- Exa-first personalization research with Tavily fallback.

## Near-Term Roadmap

1. **Quality hardening**
   - Programmatic form labels.
   - Accessible modal focus trap/restore.
   - Settings and template form resilience.
   - E2E coverage for keyboard and dialog behavior.

2. **Performance and reliability**
   - Verify document parser chunks only load on upload paths.
   - Review vendor/manual chunks.
   - Keep campaign/email cache invalidation predictable after send/generate/delete.

3. **Research freshness**
   - Add manual re-research action for stale or weak company dossiers.
   - Make cache freshness policy explicit in UI or admin tooling.

4. **Drafting UX**
   - Surface fallback/generic-draft state when AI generation degrades.
   - Improve row-level error reporting for bulk generation.
   - Tighten attachment and template affordances.

5. **Data quality**
   - Continue verified company enrichment where ROI is clear.
   - Avoid reopening headcount filtering unless the product strategy changes.

## Scoped, not started

These were scoped during prior conversations but no implementation has begun. Each is concrete enough to pick up cold.

### Exa bulk discovery (`scripts/discover-exa-deep.ts`)

Goal: add thousands of net-new long-tail companies — ones not in any VC portfolio. Closes the "easier way to find non-VC-backed companies" ask.

Two strategies, ranked by net-new yield:
1. **`findSimilar` from existing DB rows.** Sample ~500 verified companies biased toward low-coverage clusters (regional non-US, non-VC sources like `hn-hiring` / `thehub`). For each, Exa `findSimilar` → dedupe by domain → ingest net-new via `runIngestor` with `source: exa-discovery`.
2. **List-page mining via generic Exa search.** ~100 queries like `"AI startups to watch 2026"`. Returns curation articles; for each top result, fetch `/contents`, Haiku-extract company names + URLs, dedupe, ingest.

**Don't use:** more topical `category=company` queries — empirically overlaps too heavily with VC portfolio companies. The current `ingest-exa-discovery.ts` pattern is exhausted for popular topics.

Cap total Exa spend at ~10k credits. Target net-new count: ~12k to double the DB to ~25k verified. References: `scripts/ingest-exa-discovery.ts`, `scripts/_lib/ingestor.ts`, `scripts/ingest-yc.ts`. Read those + 2 other adapters before writing.

### Self-administration dashboard

Motivation: Charlie giving specific users higher send limits + tracking own usage. Not multi-tenant admin.

Two independent layers:
- **Usage tracking** (~1-2 days): per-user drafts generated, emails sent today/month, Apollo credits used (`DailyQuota`), Exa credits used, last active, Gmail connected, current sending limit, campaigns count. Read-only.
- **Per-user send-limit override** (~2-3 days): `normalizeSendingLimits` hardcodes `maxDaily: 500`. Override field lives at user/profile level (not in `workspace_config` so user can't self-edit). Apply AFTER normalization so override is source of truth when present.

Add a `role: 'admin' | 'user'` enum on `user_profiles` (the table `parseWorkspaceConfig` reads), middleware to gate `/admin/*`, seed Charlie as admin via one-off SQL.

## Housekeeping

- (No outstanding items as of 2026-05-21. Previous three closed out: server-side tsc errors already fixed; `scripts/enrich-industries-exa.ts` committed in 55b012a; e2e bounce-to-/login flake resolved in 7940745 — root cause was `signInDemo` waiting for `h2:has-text("Welcome back")` to detach when the heading is `<h1>`, so the wait returned immediately and tests raced supabase localStorage persistence. Fix replaces the DOM-element wait with a localStorage poll for the `sb-*-auth-token` key.)

## Deferred

- Reply detection and follow-up automation.
- Scheduled sends.
- Native mobile app.
- Open/click tracking.
- LinkedIn scraping.
- BYO API keys.
- BullMQ/Redis worker architecture.

---
*Last updated: 2026-05-21*
