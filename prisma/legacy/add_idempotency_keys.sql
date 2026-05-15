CREATE TABLE IF NOT EXISTS "IdempotencyKey" (
  "userId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "response" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("userId", "key")
);

CREATE INDEX IF NOT EXISTS "IdempotencyKey_expiresAt_idx"
  ON "IdempotencyKey" ("expiresAt");

ALTER TABLE "IdempotencyKey" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No client access to IdempotencyKey" ON "IdempotencyKey";
CREATE POLICY "No client access to IdempotencyKey"
  ON "IdempotencyKey"
  FOR ALL
  USING (false)
  WITH CHECK (false);
