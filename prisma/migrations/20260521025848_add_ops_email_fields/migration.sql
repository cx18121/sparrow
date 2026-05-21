-- Add operations-role persistence columns per ADR-0005 slice 3.
-- Engineering+product personalization stays in featureLine / fitAngle;
-- GTM personalization in gtmTriggerLine / gtmProofOfMotion (slice 2);
-- ops personalization lands in opsInflectionLine / opsSystemBuilt.
-- Only one role's pair is populated per row, selected by the generating
-- campaign's targetRole.
--
-- Nullable so existing rows (all engineering- or GTM-shaped) keep
-- validating and so non-ops rows after the migration leave these
-- columns null.
ALTER TABLE "Email" ADD COLUMN "opsInflectionLine" TEXT;
ALTER TABLE "Email" ADD COLUMN "opsSystemBuilt" TEXT;
