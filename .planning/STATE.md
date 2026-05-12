---
gsd_state_version: 1.0
milestone: v1
milestone_name: Sparrow campaign workspace
status: active
last_updated: "2026-05-11d"
---

# Project State

## Source Of Truth

Use these docs for current behavior:

- `CONTEXT.md`
- `AGENTS.md`
- `CLAUDE.md`
- `docs/adr/`
- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/ROADMAP.md`

Older files under `.planning/research/`, `.planning/phases/`, and `.scratch/` are historical unless a current doc explicitly points at them.

## Current Product

Sparrow is campaign-first. Global navigation is Home, Templates, Settings. Campaign work lives under `/campaigns/:id/*` with Overview, Leads, Drafts, Sent, and Settings.

## Current Architecture

- Frontend: Vite + React + Tailwind.
- API: Vercel Functions-compatible router, with `local-api.ts` for local Express development.
- Database: Supabase Postgres via Prisma 7.
- Auth: Supabase Auth.
- Gmail: Google OAuth + Gmail API.
- AI: host-managed Anthropic Claude key.
- Research: Exa-first, Tavily fallback.
- Contacts: Apollo search/reveal.

## Current Decisions

- No per-user Claude or Apollo keys in the product.
- Settings has three tabs: Profile, Sending, Account.
- Templates default to verbatim mode.
- Headcount filter is retired from the audience UI.
- `LeadStatus` is SAVED, EMAILED, NO_RESPONSE, DECLINED.
- Reply detection, scheduled sends, and follow-up automation are deferred.
- **No Crunchbase.** Not a planned enrichment direction now or later. Several existing docs (`docs/scraping-research.md` Parts 2/4; ingest pipeline notes) frame Crunchbase open data as the canonical "Phase 4" fix for stage staleness, missing exit data, and the curated `PREEXISTING_PUBLICS` skiplist rot — that framing is **superseded**. External company-status enrichment, if pursued, must use a different source/approach. Future sessions that arrive at "the canonical fix is Crunchbase" via the older docs should redirect to this decision.

## Active Concerns

- Accessibility hardening: labels and modal focus management.
- Bundle size around vendor/pdf/docx parser chunks.
- Research dossier freshness is manual/implicit, not a scheduled refresh.
- Some old planning files are archived and intentionally not reliable as current implementation docs.

## Resume hints (ephemeral)

Transient session-handoff notes. Clear after the next manual refresh or push.

- **8+ commits on local main ahead of origin** (Lightspeed, IVP, JSON skiplist refactor, Coatue, Insight + AGENTS.md, Khosla + Benchmark dead-end, 5 Easy-win adapters from the survey) — pending push approval.
- **Phase 3 VC-scraper work**: steps 1–10 (Part 4) + steps 11–15 (Part 5 Easy wins) shipped. Remaining:
  - **Step 7** — re-run `audit-stages.ts` to verify post-B counts moved.
  - **Part 5 Tier-1 mediums** — General Catalyst (578), Summit Partners (407), General Atlantic (398), Index Ventures (372), Battery Ventures (341). Sitemap/REST + detail-page hop pattern.
  - **Exa-discovery ingest source** — `scripts/ingest-exa-discovery.ts` to surface companies outside VC portfolios via topical Exa queries (category=company). `category` param already added to `server/lib/ai/exa-search.ts` (uncommitted change held back to land alongside the new script).
- **Insight Partners "needs Playwright" framing was wrong.** The `/portfolio` page is a Vue shell, but Insight is WordPress underneath — `/wp-json/wp/v2/sfcompany` (paginated list) + `/wp-json/insight/v1/get-company-content?id=<id>` (custom endpoint, double-encoded JSON wrapper around per-company rendered HTML) surface everything. Recorded as a generalizable lesson in `docs/scraping-research.md` Part 4: before reaching for Playwright, probe for `/wp-json/`, `__NEXT_DATA__`, `/_next/data/...`, or a CMS GraphQL endpoint.
- **Benchmark.com is intentionally a wall page.** Root serves 2.3 KB of HTML with office addresses + a Twitter handle; every probed sub-path 404s. Documented as step 10 (skip).

## Last Manual Refresh

2026-05-05: Root context, ADRs, README, product/design docs, env example, and active planning docs updated to match current implementation.

2026-05-11: Phase 3 VC-scraper adapters shipped (Lightspeed, IVP, Coatue) + IVP skiplist externalized to `scripts/_data/skiplists.json`. `docs/scraping-research.md` Part 4 reflects status. AGENTS.md ingest-pipeline enumeration still doesn't list `lightspeed`/`ivp`/`coatue` — small follow-up.

2026-05-11b: Phase 3 step 8 shipped — Insight Partners adapter via WP REST (509 ingested of 845 portfolio entries; 289 Prior-Investment exits filtered). `docs/scraping-research.md` Part 4 reflects status; AGENTS.md adapter enumeration updated to include `lightspeed`/`ivp`/`coatue`/`insight`.

2026-05-11c: Phase 3 step 9 shipped (Khosla — 131 ingested of 132 cards, single-page Webflow static scrape) + step 10 documented (Benchmark unreachable — no public portfolio, all probed paths 404). Net-new firm survey agent in flight (output → `.scratch/vc-survey-2026-05-11.md`) to identify the next batch of adapter candidates.

2026-05-11d: 2026-05-11 VC survey shipped (Part 5 steps 11–15 — 5 Easy single-fetch adapters): Sapphire (91), ICONIQ (100), Spark (43, with inline acquisition-spec exit filter), Initialized (181, via `__NEXT_DATA__`), Costanoa (91, via public Prismic API). **506 net-new companies in this pass.** Tier-1 mediums (~2,000 more companies) and Exa-discovery script still to ship.
