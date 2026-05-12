---
gsd_state_version: 1.0
milestone: v1
milestone_name: Sparrow campaign workspace
status: active
last_updated: "2026-05-11i"
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

- **Local main is in sync with `origin/main`** (last push `fbb57ae..e1d5d71` landed the 2026-05-11 ingest batch — Insight, Khosla, 5 Easy wins, Exa-discovery, 5 Tier-1 mediums, 9 Tier 2/3 — totalling ~3,790 new companies across 6 ingest commits this session).
- **Phase 3 VC-scraper work**: steps 1–10 (Part 4) + steps 11–15 (Part 5 Easy wins) + steps 16–20 (Tier-1 mediums) + steps 21–29 (Tier 2/3) + Part 6 Exa-discovery — **all 2026-05-11 survey adapter candidates shipped.** Outstanding follow-ups:
  - **Step 7** — re-run `audit-stages.ts` to verify post-B counts moved with the new data.
  - **Exa-discovery breadth runs** — additional topical queries at ~1 Exa credit per 18–28 net-new rows.
  - **Balderton FacetWP unlock** (low priority) — partial-coverage adapter ships only ~30 of 200 cards because FacetWP's incremental-load AJAX is gated by a per-session nonce that doesn't reconstruct from a clean POST. Playwright path would unlock the remaining ~170.
- **Exa-discovery is operational.** `scripts/ingest-exa-discovery.ts` takes `--query "..." --topic <slug> --limit N` and ingests Exa `category=company` results. Seed run hit 8 topical queries → 179 net-new companies for 8 Exa credits. **Caveat:** company-category index doesn't support `startPublishedDate` (semantic-only) and returns some public-traded mega-caps — exit filter must happen at campaign time.
- **Battery website-extraction lesson** — `google.com/chrome` and `g2.com` are now in the chrome blocklist after the first Battery run returned google.com for 171 of 172 detail pages (browser-upgrade banner appears before the actual company link). Pattern lesson: when a "first external link" rule yields near-100% dedupe, the bug is in the blocklist, not the data. Documented in `docs/scraping-research.md` Part 5 step 20.
- **Insight Partners "needs Playwright" framing was wrong.** The `/portfolio` page is a Vue shell, but Insight is WordPress underneath — `/wp-json/wp/v2/sfcompany` (paginated list) + `/wp-json/insight/v1/get-company-content?id=<id>` (custom endpoint, double-encoded JSON wrapper around per-company rendered HTML) surface everything. Recorded as a generalizable lesson in `docs/scraping-research.md` Part 4: before reaching for Playwright, probe for `/wp-json/`, `__NEXT_DATA__`, `/_next/data/...`, or a CMS GraphQL endpoint.
- **Benchmark.com is intentionally a wall page.** Root serves 2.3 KB of HTML with office addresses + a Twitter handle; every probed sub-path 404s. Documented as step 10 (skip).

## Last Manual Refresh

2026-05-05: Root context, ADRs, README, product/design docs, env example, and active planning docs updated to match current implementation.

2026-05-11: Phase 3 VC-scraper adapters shipped (Lightspeed, IVP, Coatue) + IVP skiplist externalized to `scripts/_data/skiplists.json`. `docs/scraping-research.md` Part 4 reflects status. AGENTS.md ingest-pipeline enumeration still doesn't list `lightspeed`/`ivp`/`coatue` — small follow-up.

2026-05-11b: Phase 3 step 8 shipped — Insight Partners adapter via WP REST (509 ingested of 845 portfolio entries; 289 Prior-Investment exits filtered). `docs/scraping-research.md` Part 4 reflects status; AGENTS.md adapter enumeration updated to include `lightspeed`/`ivp`/`coatue`/`insight`.

2026-05-11c: Phase 3 step 9 shipped (Khosla — 131 ingested of 132 cards, single-page Webflow static scrape) + step 10 documented (Benchmark unreachable — no public portfolio, all probed paths 404). Net-new firm survey agent in flight (output → `.scratch/vc-survey-2026-05-11.md`) to identify the next batch of adapter candidates.

2026-05-11d: 2026-05-11 VC survey shipped (Part 5 steps 11–15 — 5 Easy single-fetch adapters): Sapphire (91), ICONIQ (100), Spark (43, with inline acquisition-spec exit filter), Initialized (181, via `__NEXT_DATA__`), Costanoa (91, via public Prismic API). **506 net-new companies in this pass.** Tier-1 mediums (~2,000 more companies) and Exa-discovery script still to ship.

2026-05-11e: Part 6 Exa-discovery shipped — `scripts/ingest-exa-discovery.ts` ingests Exa `category=company` results by topical query. Seed run: 8 topics × ~24 results = **179 net-new companies in 8 Exa credits.** Includes `category` param extension to `server/lib/ai/exa-search.ts`. Constraint discovered: company-category index doesn't support `startPublishedDate`.

2026-05-11f: 5 Tier-1 medium adapters shipped (Part 5 steps 16–20): General Catalyst (576, 100% success), Summit Partners (277, 32% no-website acts as soft exit filter), General Atlantic (393, WP REST `wp/v2/investment` + `<a class="view-site">`), Index Ventures (296, 75 IPO exits filtered via `ticker-symbol` span), Battery Ventures (171, 169 status-marked exits filtered, post-fix for google.com chrome leak). **1,713 net-new companies in this pass.** Session-wide total: **3,038 new companies across 11 commits.**

2026-05-11g: 9 Tier 2/3 adapters shipped (Part 5 steps 21–29) — Mosaic (35), BoxGroup (42), Hoxton (88), Notion Capital (64), Craft (75, **first source with stage data on list page** via fs-cmsfilter), 8VC (166), TCV (91), Felicis (171, via `\"websiteUrl\":...` regex over Next.js streaming chunks), Balderton (20, partial). **752 more companies, session total now 3,790 across 12+ commits.** All 2026-05-11 survey adapter candidates shipped.

2026-05-11h: Pushed `fbb57ae..e1d5d71` (11 commits) to `origin/main` — local is now in sync. Ran `audit-stages.ts` post-merge: DB at **11,875 verified rows**, 53.3% `stage=null`. Roll-up: Seed 4,037 / Series A 717 / Series B 528 / **Series C+ 134** / Pre-Seed 78 / Series C–I 50. The Phase 1.5 lossy-mapper patches (yc/a16z/accel) are holding cleanly. Only Craft and Balderton among the new adapters expose stage on the source — every other new growth-stage adapter (Insight 391, GC 390, GA 336, Summit 263, Battery 123) lands as `stage=null` because the page surface doesn't publish it. Notable cross-source overlap on `source` attribution (Craft 75 ingested → 43 still attributed; Initialized 181 → 99; Insight 509 → 391) — this is documented `last-write-wins` per `upsertCompany`, not an anomaly.

2026-05-11i: Expanded `INVESTOR_TAGS` in `scripts/_lib/tags.ts` from 10 to 35 slugs so the wizard's investor filter chip surface includes every adapter shipped this milestone. Confirmed via `scripts/_probe-tag-accumulation.ts` that `investor:*` tags were already accumulating cleanly on cross-source upserts (Anthropic carries 13 investor tags, Ramp 10, OpenAI/Stripe 7 each) — the data path through `mergeTags` → `reconcileCompany` was already correct; the only thing missing was the canonical-list surfacing. **The `Company.source` overwrite is metadata-only — investor signal is preserved via `tags` and queryable through the wizard.** DB-wide: of 9,912 verified rows, 998 carry ≥2 investor tags (max 13).
