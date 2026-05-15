CREATE TABLE IF NOT EXISTS "CampaignCustomContact" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "customContactId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignCustomContact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CampaignCustomContact_campaignId_fkey" FOREIGN KEY ("campaignId")
    REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CampaignCustomContact_customContactId_fkey" FOREIGN KEY ("customContactId")
    REFERENCES "CustomContact"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "CampaignCustomContact_campaignId_customContactId_key"
  ON "CampaignCustomContact" ("campaignId", "customContactId");

CREATE INDEX IF NOT EXISTS "CampaignCustomContact_campaignId_idx"
  ON "CampaignCustomContact" ("campaignId");

CREATE INDEX IF NOT EXISTS "CampaignCustomContact_customContactId_idx"
  ON "CampaignCustomContact" ("customContactId");

ALTER TABLE "CampaignCustomContact" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No client access to CampaignCustomContact" ON "CampaignCustomContact";
CREATE POLICY "No client access to CampaignCustomContact"
  ON "CampaignCustomContact"
  FOR ALL
  USING (false)
  WITH CHECK (false);
