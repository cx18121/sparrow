-- Campaign.filterRegion / filterStage / filterBatch: String? -> String[]
--
-- Multi-select filters in the wizard need array storage. Existing scalar
-- values become 1-element arrays; NULL becomes an empty array. After the
-- conversion the columns are NOT NULL with default '{}' to match Prisma's
-- scalar-list convention.

ALTER TABLE "Campaign"
  ALTER COLUMN "filterRegion" DROP DEFAULT,
  ALTER COLUMN "filterRegion" TYPE TEXT[] USING (
    CASE WHEN "filterRegion" IS NULL THEN ARRAY[]::TEXT[] ELSE ARRAY["filterRegion"]::TEXT[] END
  ),
  ALTER COLUMN "filterRegion" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "filterRegion" SET NOT NULL;

ALTER TABLE "Campaign"
  ALTER COLUMN "filterStage" DROP DEFAULT,
  ALTER COLUMN "filterStage" TYPE TEXT[] USING (
    CASE WHEN "filterStage" IS NULL THEN ARRAY[]::TEXT[] ELSE ARRAY["filterStage"]::TEXT[] END
  ),
  ALTER COLUMN "filterStage" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "filterStage" SET NOT NULL;

ALTER TABLE "Campaign"
  ALTER COLUMN "filterBatch" DROP DEFAULT,
  ALTER COLUMN "filterBatch" TYPE TEXT[] USING (
    CASE WHEN "filterBatch" IS NULL THEN ARRAY[]::TEXT[] ELSE ARRAY["filterBatch"]::TEXT[] END
  ),
  ALTER COLUMN "filterBatch" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "filterBatch" SET NOT NULL;
