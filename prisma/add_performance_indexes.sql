CREATE INDEX IF NOT EXISTS "Email_status_createdAt_idx"
  ON "Email" ("status", "createdAt");

CREATE INDEX IF NOT EXISTS "Email_userLeadId_status_createdAt_idx"
  ON "Email" ("userLeadId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "Email_customContactId_status_createdAt_idx"
  ON "Email" ("customContactId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "CampaignLead_userLeadId_idx"
  ON "CampaignLead" ("userLeadId");

CREATE INDEX IF NOT EXISTS "CampaignLead_campaignId_userLeadId_idx"
  ON "CampaignLead" ("campaignId", "userLeadId");
