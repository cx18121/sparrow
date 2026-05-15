CREATE TABLE IF NOT EXISTS "DailyQuota" (
  "scope" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyQuota_pkey" PRIMARY KEY ("scope", "subjectId", "action", "day")
);

CREATE INDEX IF NOT EXISTS "DailyQuota_day_idx" ON "DailyQuota" ("day");

ALTER TABLE "DailyQuota" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No client access to DailyQuota" ON "DailyQuota";
CREATE POLICY "No client access to DailyQuota"
  ON "DailyQuota"
  FOR ALL
  USING (false)
  WITH CHECK (false);
