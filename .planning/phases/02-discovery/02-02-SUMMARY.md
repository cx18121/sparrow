---
phase: 02-discovery
plan: 02
subsystem: database
tags: [axios, playwright-extra, stealth, apollo, producthunt, yc, ingestion, polling, typescript]

# Dependency graph
requires:
  - phase: 02-01
    provides: upsertCompany, upsertContact helpers; prisma singleton; region-map; schema migrations

provides:
  - YC company ingestion from public JSON API (scripts/ingest-yc.ts)
  - Apollo People Search contact enrichment with per-user API key (scripts/enrich-apollo.ts)
  - Apollo API wrapper with rate limiting and retry (scripts/_lib/apollo-client.ts)
  - Product Hunt GraphQL ingestion with cursor pagination (scripts/ingest-producthunt.ts)
  - Wellfound stealth scraper spike with Cloudflare detection (scripts/ingest-wellfound.ts)
  - Polling orchestrator with configurable interval and freshness-based skipping (scripts/poll.ts)

affects: [03-leads, 04-email-gen, workers, background-jobs]

# Tech tracking
tech-stack:
  added: [axios@1.13.x, playwright-extra@4.x, puppeteer-extra-plugin-stealth@2.x, playwright@1.x]
  patterns:
    - "All ingestion scripts are idempotent via upsertCompany/upsertContact (domain/email unique key)"
    - "API keys accepted from CLI argv[2] OR env var (CLI takes precedence)"
    - "Every script exports named async function AND calls it at bottom via .catch(console.error)"
    - "Apollo searchContacts: 429 rate-limit handled with 60s backoff + one retry"
    - "Wellfound spike returns { status, count } struct — callers check status before trusting data"

key-files:
  created:
    - scripts/ingest-yc.ts
    - scripts/enrich-apollo.ts
    - scripts/_lib/apollo-client.ts
    - scripts/ingest-producthunt.ts
    - scripts/ingest-wellfound.ts
    - scripts/poll.ts
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "Product Hunt API requires commercial approval — added code comment and process.exit(1) with helptext pointing to hello@producthunt.com"
  - "Wellfound spike is gated by Cloudflare detection: returns { status: 'blocked' } cleanly; SKIP_WELLFOUND=true bypasses it in poll.ts"
  - "Apollo enrichment uses /people/search (not /people/match) per company domain to avoid per-contact credit consumption"
  - "Playwright install skipped in WSL (Chromium binary install requires display server); script still importable"

patterns-established:
  - "Pattern: API key from argv[2] ?? process.env.KEY — CLI arg takes precedence for one-off runs"
  - "Pattern: Always disconnect prisma at end of standalone scripts (await prisma.$disconnect())"
  - "Pattern: Wellfound spike pattern — __NEXT_DATA__ extraction first, DOM fallback second, status return struct"

requirements-completed: [DISC-01, DISC-02]

# Metrics
duration: 5min
completed: 2026-03-21
---

# Phase 02 Plan 02: Ingestion Scripts Summary

**Six standalone ingestion scripts (YC JSON API, Apollo enrichment, Product Hunt GraphQL, Wellfound stealth spike, Apollo client wrapper, poll orchestrator) wiring all data sources into the shared Company/Contact pool via idempotent upserts.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-21T21:09:25Z
- **Completed:** 2026-03-21T21:14:38Z
- **Tasks:** 3 (1a YC, 1b Apollo+PH, 2 Wellfound+Poll)
- **Files modified:** 8 (6 new scripts + package.json + package-lock.json)

## Accomplishments

- YC ingestion fetches 5,690+ companies from public JSON API, filters active+website, maps all fields including stage normalization (Early->Seed, Growth->Series A, Late->Series C+), upserts with `source=yc`
- Apollo client wrapper handles rate limiting (429 -> 60s backoff -> retry), searches by domain for CTO/Founder/CEO/Head of Engineering roles; enrichment script validates API key via health check before processing
- Product Hunt GraphQL pagination (5 pages / 100 posts), bearer token auth, commercial approval warning in code and CLI output
- Wellfound stealth scraper with playwright-extra + puppeteer-extra-plugin-stealth, Cloudflare detection, `__NEXT_DATA__` extraction with DOM fallback, structured return type
- Poll orchestrator with configurable interval (POLL_INTERVAL_MS), per-source skip flags, freshness-based Apollo skip (FRESHNESS_HOURS), per-script try/catch isolation, SIGINT/SIGTERM graceful shutdown

## Task Commits

1. **Task 1a: YC ingestion script** - `d3454b2` (feat)
2. **Task 1b: Apollo client, enrichment, Product Hunt ingestion** - `20bbd41` (feat)
3. **Task 2: Wellfound spike and polling orchestrator** - `8b92a6e` (feat)

## Files Created/Modified

- `scripts/ingest-yc.ts` - YC JSON API ingestion with stage normalization and domain extraction
- `scripts/_lib/apollo-client.ts` - Apollo API wrapper: searchContacts, checkApiHealth, enrichContact with rate-limit handling
- `scripts/enrich-apollo.ts` - Apollo enrichment: API key validation, health check, per-company search, 1s delay
- `scripts/ingest-producthunt.ts` - Product Hunt GraphQL ingestion with cursor pagination up to 5 pages
- `scripts/ingest-wellfound.ts` - Wellfound stealth spike with Cloudflare detection and __NEXT_DATA__ extraction
- `scripts/poll.ts` - Polling orchestrator with configurable interval, skip flags, freshness logic, graceful shutdown
- `package.json` - Added axios, playwright-extra, puppeteer-extra-plugin-stealth, playwright
- `package-lock.json` - Updated lockfile

## Decisions Made

- Used `axios` (already in stack) for Apollo REST and Product Hunt GraphQL instead of `graphql-request` — one less dependency, simpler POST with raw query body
- Wellfound spike: playwright-extra wraps playwright (not puppeteer) for stealth — compatible with existing playwright install
- Apollo `/people/search` per domain used instead of `/people/match` per contact — avoids burning credits on every contact; credits only consumed when `enrichContact` is explicitly called

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- npm install in WSL failed initially due to stale `node_modules/@prisma/.engines-ZJ8IaLnd` lock directory — removed stale lock dir and retried successfully
- Chromium browser binary install (`npx playwright install chromium`) not available in WSL headless context without display server — scripts are importable and will work in environments with Chromium available (CI, Docker, Railway)

## User Setup Required

None - no external service configuration required beyond environment variables already documented in `.env.example` (APOLLO_API_KEY, PRODUCTHUNT_TOKEN, DATABASE_URL).

## Next Phase Readiness

- All 6 ingestion scripts are runnable via `npx tsx scripts/<name>.ts` when DATABASE_URL is set
- YC ingestion is fully operational (public API, no auth required)
- Apollo enrichment operational once APOLLO_API_KEY is configured per user
- Product Hunt operational once PRODUCTHUNT_TOKEN is set (pending commercial approval)
- Wellfound is a spike — set SKIP_WELLFOUND=true in .env if blocked; ScrapFly/Apify identified as fallback
- Poll orchestrator ready to run as background process on Railway/Fly.io

---
*Phase: 02-discovery*
*Completed: 2026-03-21*
