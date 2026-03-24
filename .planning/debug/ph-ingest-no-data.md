---
status: awaiting_human_verify
trigger: "Product Hunt ingest script runs silently with no data written to the database"
created: 2026-03-22T00:00:00Z
updated: 2026-03-22T00:30:00Z
---

## Current Focus

hypothesis: CONFIRMED — Two bugs found and fixed. Awaiting human verification.
test: User should run `npx tsx scripts/ingest-producthunt.ts` and see pages printing + companies ingested
expecting: Script prints "Page 1 done, N ingested so far..." and terminates with non-zero count
next_action: Human verify script runs correctly end-to-end

## Symptoms

expected: Companies from Product Hunt are ingested and upserted into the Postgres database
actual: Script runs but no companies appear in the DB — silent failure, no errors shown
errors: None reported
reproduction: Run `npx tsx scripts/ingest-producthunt.ts`
started: Never worked — newly written but untested

## Eliminated

- hypothesis: PRODUCTHUNT_TOKEN not set
  evidence: .env contains PRODUCTHUNT_TOKEN value
  timestamp: 2026-03-22T00:05:00Z

- hypothesis: DATABASE_URL not set or DB unreachable
  evidence: DB query via adapter returned count=2768 successfully; DATABASE_URL and DIRECT_URL both present in .env
  timestamp: 2026-03-22T00:10:00Z

- hypothesis: PrismaPg adapter constructor call wrong
  evidence: PrismaPg({ connectionString }) is valid pg.PoolConfig shape — adapter creates successfully
  timestamp: 2026-03-22T00:15:00Z

- hypothesis: Prisma schema missing url in datasource
  evidence: prisma.config.ts supplies DIRECT_URL via defineConfig; schema.prisma with no url field is valid with this setup
  timestamp: 2026-03-22T00:15:00Z

## Evidence

- timestamp: 2026-03-22T00:05:00Z
  checked: .env file
  found: PRODUCTHUNT_TOKEN set; DATABASE_URL set (pgbouncer pooler on port 6543); DIRECT_URL set (direct on port 5432)
  implication: Auth and DB credentials available

- timestamp: 2026-03-22T00:08:00Z
  checked: .ph-checkpoint.json
  found: {"cursor":"MTI2MA","page":63,"count":1260} — cursor decodes to post position 1260
  implication: Script thinks it already ingested 1260 posts and will resume from position 1260 (oldest end of the recent window)

- timestamp: 2026-03-22T00:10:00Z
  checked: ingest-producthunt.ts lines 106-114
  found: loadCheckpoint() is called unconditionally at script start; cursor and page loaded from file
  implication: Every run picks up the stale checkpoint and resumes from page 63

- timestamp: 2026-03-22T00:12:00Z
  checked: ingest-producthunt.ts cutoff logic (lines 135-170)
  found: API returns posts in NEWEST order; cursor at position 1260 means the next page fetches posts 1261-1280 (oldest of the past-year window, or beyond); first post in that batch will be older than the 1-year cutoff; reachedCutoff=true fires on the first edge; loop breaks with 0 new upserts; checkpoint was saved BEFORE breaking with the new deeper cursor; next run resumes even deeper — infinite repeat of doing nothing
  implication: PRIMARY BUG — stale checkpoint causes every run to do nothing silently

- timestamp: 2026-03-22T00:15:00Z
  checked: scripts/_lib/prisma.ts
  found: connectionString = process.env.DATABASE_URL which has ?pgbouncer=true; the @prisma/adapter-pg uses a raw pg.Pool and manages its own connections — the pgbouncer=true hint is meaningless/harmful for direct pg pools (can disable prepared statements); DIRECT_URL is available
  implication: SECONDARY BUG — wrong URL used for driver adapter; should use DIRECT_URL

- timestamp: 2026-03-22T00:18:00Z
  checked: DB connectivity test
  found: prisma.company.count() returned 2768 — DB is reachable and schema is migrated
  implication: DB is not the problem; the script simply never gets to the upsert call

## Resolution

root_cause: |
  Two bugs:
  1. (Primary) .ph-checkpoint.json contained a stale cursor from a previous run (page:63, count:1260).
     The ingest script unconditionally resumes from this cursor. The NEWEST-ordered API returns posts
     at position 1260+, which are ~1 year old and immediately trigger the 1-year cutoff filter.
     The loop breaks after 0 upserts — silently. Worse: before breaking, it saved the *new* deeper
     cursor, so every subsequent run goes even further past the cutoff and still does nothing.
  2. (Secondary) scripts/_lib/prisma.ts used DATABASE_URL (?pgbouncer=true) for the driver adapter
     (PrismaPg). The adapter manages its own pg.Pool and does not need PgBouncer; the pgbouncer=true
     param can disable prepared statements and cause subtle errors.

fix: |
  1. Moved `saveCheckpoint` call after the `reachedCutoff` check so that hitting the cutoff resets
     the checkpoint to {cursor:null, page:0, count:0} instead of saving the deeper cursor.
     This ensures the next run always starts from scratch when the prior run finished normally.
  2. Changed prisma.ts to prefer DIRECT_URL over DATABASE_URL so the pg.Pool connects directly
     to Postgres without going through PgBouncer.
  3. Manually reset .ph-checkpoint.json to {cursor:null,page:0,count:0} to unblock the current stale state.

verification: awaiting human confirmation
files_changed:
  - scripts/_lib/prisma.ts
  - scripts/ingest-producthunt.ts
  - .ph-checkpoint.json
