-- Single-row precomputed snapshot of /api/campaign-options output.
--
-- Background: the wizard's filter-chip endpoint fires 10 parallel
-- Company-wide queries on every Leads-tab mount. After the partial-index
-- migration (20260522230500) the 5 DISTINCT scans are ~30ms each, but
-- the live `unnest(tags) GROUP BY tag` aggregate is uncovered (no index
-- can help an aggregation over unnested array elements) and tails ~40s
-- cold-cache. The in-process LRU cache (commit daff053) covered this
-- per-instance, but cross-instance cold starts under load were still a
-- thundering-herd risk.
--
-- This snapshot table holds the precomputed response payload as JSONB.
-- Refresh fires on demand via scripts/refresh-company-options.ts
-- (typically after an ingest session). The endpoint reads it with a
-- single PK lookup (~5ms). On a fresh deploy with no row yet, the
-- endpoint falls back to live compute and writes the row, so there's
-- no "missing row → 500 error" failure mode.
--
-- IF NOT EXISTS so prisma migrate deploy is idempotent if the table
-- was applied out-of-band via MCP execute_sql.

CREATE TABLE IF NOT EXISTS "CompanyOptionsSnapshot" (
  "id"        TEXT       NOT NULL,
  "payload"   JSONB      NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyOptionsSnapshot_pkey" PRIMARY KEY ("id")
);
