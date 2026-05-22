-- Cleanup pass after partial-indexes migration (20260522230500).
--
-- 1. Cover the four FK columns the Supabase advisor flagged as
--    unindexed_foreign_keys. A FK without a covering index forces a
--    sequential scan on the referenced table whenever Postgres needs
--    to verify referential integrity (cascade delete, parent update)
--    or whenever Prisma joins through the relation. These four are
--    the ones flagged at https://supabase.com/docs/guides/database/database-linter:
--
--      CampaignSeenCompany.companyId   FK → Company.id
--      DiscoverySeenCompany.companyId  FK → Company.id
--      UserLead.companyId              FK → Company.id
--      UserLead.contactId              FK → Contact.id
--
-- 2. Lower the per-table autovacuum thresholds on Company. The default
--    20% scale factor means autovacuum/autoanalyze only fires after
--    ~6,800 rows change on a 34k-row table, which is far too coarse
--    for a table that turns over thousands of rows per ingest run.
--    Stale planner stats during ingest are a real contributor to the
--    bad plan choices seen in the 2026-05-22 slowdown. 0.01 / 0.05
--    trigger analyze after ~1% row change and vacuum after ~5%.
--
-- 3. Run ANALYZE "Company" once now so planner stats reflect the
--    post-Exa-cleanup row distribution (7,611 rows demoted from
--    isVerified=true).
--
-- Plain CREATE INDEX IF NOT EXISTS — these tables are small relative
-- to Company so the brief lock during deploy is acceptable. For live
-- apply during heavy write traffic, run via MCP execute_sql with
-- CONCURRENTLY first (same pattern as 20260522230500).

CREATE INDEX IF NOT EXISTS "CampaignSeenCompany_companyId_idx"
  ON "CampaignSeenCompany" ("companyId");

CREATE INDEX IF NOT EXISTS "DiscoverySeenCompany_companyId_idx"
  ON "DiscoverySeenCompany" ("companyId");

CREATE INDEX IF NOT EXISTS "UserLead_companyId_idx"
  ON "UserLead" ("companyId");

CREATE INDEX IF NOT EXISTS "UserLead_contactId_idx"
  ON "UserLead" ("contactId");

ALTER TABLE "Company" SET (
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_scale_factor  = 0.05
);

ANALYZE "Company";
