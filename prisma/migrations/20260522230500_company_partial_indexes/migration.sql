-- Partial indexes for the wizard's campaign-options endpoint.
--
-- server/routes/campaign-options.ts fires 10 parallel findMany({ distinct })
-- on Company with `where: { isVerified: true, <col>: { not: null } }`.
-- Each one was doing a full B-tree scan over Company_<col>_idx and
-- filtering out ~7.6k non-verified rows in the page-output phase (the
-- exa-discovery cleanup demoted those from isVerified=true).
--
-- With 10 callers in parallel on a wizard mount, Postgres workers
-- saturate, the 2-min statement timeout fires, and unrelated queries
-- (incl. auth /user) get starved. Partial indexes scoped to the verified
-- subset turn each DISTINCT scan from ~1.2s avg / 117s tail → ~30ms.
--
-- CREATE INDEX CONCURRENTLY can't run inside a transaction, so the
-- production DB already has these (applied via MCP execute_sql). This
-- file records the change for any fresh deploy. The IF NOT EXISTS keeps
-- prisma migrate deploy idempotent.

CREATE INDEX IF NOT EXISTS "Company_source_verified_idx"
  ON "Company" (source)
  WHERE "isVerified" = true;

CREATE INDEX IF NOT EXISTS "Company_stage_verified_idx"
  ON "Company" (stage)
  WHERE "isVerified" = true AND stage IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Company_region_verified_idx"
  ON "Company" (region)
  WHERE "isVerified" = true AND region IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Company_industry_verified_idx"
  ON "Company" (industry)
  WHERE "isVerified" = true AND industry IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Company_batch_verified_idx"
  ON "Company" (batch)
  WHERE "isVerified" = true AND batch IS NOT NULL;
