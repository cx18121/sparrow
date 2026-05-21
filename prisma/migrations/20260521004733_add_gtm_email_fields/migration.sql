-- Add GTM-role persistence columns per ADR-0005 slice 2. Engineering and
-- product personalization stay in featureLine / fitAngle; GTM personalization
-- lands in gtmTriggerLine / gtmProofOfMotion. Only one role's fields are
-- populated per row, selected by the generating campaign's targetRole.
--
-- Nullable so existing rows (all engineering-shaped) keep validating and
-- so non-GTM rows after the migration leave these columns null.
ALTER TABLE "Email" ADD COLUMN "gtmTriggerLine" TEXT;
ALTER TABLE "Email" ADD COLUMN "gtmProofOfMotion" TEXT;
