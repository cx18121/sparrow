-- Capture per-draft AI generation metadata directly on Email so we can
-- audit personalization quality (feature_line distribution, fit_angle null
-- rate, fallback frequency) via a Supabase SQL query without building a
-- separate logging table.
--
-- All columns are nullable: rows written before this migration stay valid,
-- and the old code path stays functional after deploy until the new code
-- ships. Deploy order: run this SQL first, then deploy the code that
-- writes to these columns.

ALTER TABLE "Email"
  ADD COLUMN IF NOT EXISTS "featureLine" TEXT,
  ADD COLUMN IF NOT EXISTS "fitAngle" TEXT,
  ADD COLUMN IF NOT EXISTS "generationKind" TEXT;
