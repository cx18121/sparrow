-- Drop four indexes the Supabase advisor flagged as unused.
--
-- Verified via pg_stat_user_indexes on 2026-05-22 — all four show 0
-- scans, 0 tuples_read, 0 tuples_fetched since stats were last reset.
-- Cross-checked against the codebase:
--
--   Campaign_status_idx
--     No Prisma query filters on Campaign.status as a hot path; the
--     queries that touch status pull a single Campaign by id and read
--     the column.
--
--   CampaignLead_campaignId_batchNumber_idx
--     Composite index where the campaignId prefix is already covered
--     by the separate Campaign FK index. Queries filtering on
--     batchNumber alone don't exist in the codebase.
--
--   DailyQuota_day_idx
--     DailyQuota lookups always include userId + day, served by the
--     composite (userId, day) PK. The day-only index never gets picked.
--
--   Company_qualityScore_idx     ← 632 kB — biggest write tax of the four
--     The wizard's audience filter exposes minScore but the frontend
--     never sets it. The companies route's `qualityScore: { gte: N }`
--     predicate is reachable in principle but the UI never produces
--     a request that would trigger it. If a future feature surfaces
--     minScore, re-add the index.
--
-- Kept: Email_gmailThreadId_idx, also 0 scans, but
-- server/routes/webhooks/gmail.ts:130 actively queries by gmailThreadId
-- for reply matching. Most likely "0 scans since pg_stat reset" rather
-- than dead.
--
-- DROP INDEX CONCURRENTLY already applied via MCP execute_sql before
-- this commit; CONCURRENTLY can't run inside a Prisma-wrapped
-- transaction so the migration file uses plain DROP INDEX IF EXISTS
-- to stay idempotent on fresh deploys.

DROP INDEX IF EXISTS "Campaign_status_idx";
DROP INDEX IF EXISTS "CampaignLead_campaignId_batchNumber_idx";
DROP INDEX IF EXISTS "DailyQuota_day_idx";
DROP INDEX IF EXISTS "Company_qualityScore_idx";
