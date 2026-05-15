
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('SAVED', 'EMAILED', 'RESPONDED', 'NO_RESPONSE', 'DECLINED');

-- CreateEnum
CREATE TYPE "ReplyClassification" AS ENUM ('REPLY', 'AUTO_REPLY', 'BOUNCE', 'OTHER');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "description" TEXT,
    "oneLiner" TEXT,
    "website" TEXT,
    "stage" TEXT,
    "industry" TEXT,
    "subIndustry" TEXT,
    "location" TEXT,
    "region" TEXT,
    "headcount" INTEGER,
    "isHiring" BOOLEAN NOT NULL DEFAULT false,
    "batch" TEXT,
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isVerified" BOOLEAN NOT NULL DEFAULT true,
    "qualityScore" INTEGER,
    "lastScrapedAt" TIMESTAMP(3),
    "researchDossier" JSONB,
    "researchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "title" TEXT,
    "role" TEXT,
    "linkedinUrl" TEXT,
    "source" TEXT NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserLead" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "apolloPersonId" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'SAVED',
    "notes" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomContact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "title" TEXT,
    "companyName" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'SAVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Email" (
    "id" TEXT NOT NULL,
    "userLeadId" TEXT,
    "contactId" TEXT,
    "customContactId" TEXT,
    "subject" TEXT,
    "body" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "attachmentIds" JSONB NOT NULL DEFAULT '[]',
    "featureLine" TEXT,
    "fitAngle" TEXT,
    "generationKind" TEXT,
    "sentAt" TIMESTAMP(3),
    "gmailMessageId" TEXT,
    "gmailThreadId" TEXT,
    "openedAt" TIMESTAMP(3),
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "repliedAt" TIMESTAMP(3),
    "replyMessageId" TEXT,
    "replyFrom" TEXT,
    "replyClassification" "ReplyClassification",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Email_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserGmailWatch" (
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "watchExpiresAt" TIMESTAMP(3) NOT NULL,
    "historyId" TEXT NOT NULL,
    "pubsubTopic" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserGmailWatch_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("userId","key")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "verbatim" BOOLEAN NOT NULL DEFAULT true,
    "attachmentIds" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "templateId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "filterIndustry" TEXT,
    "filterRegion" TEXT,
    "filterStage" TEXT,
    "filterBatch" TEXT,
    "filterIsHiring" BOOLEAN,
    "filterTags" TEXT[],
    "batchSize" INTEGER NOT NULL DEFAULT 10,
    "currentBatch" INTEGER NOT NULL DEFAULT 0,
    "tone" TEXT,
    "attachmentIds" JSONB NOT NULL DEFAULT '[]',
    "includePreviouslySaved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignSeenCompany" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignSeenCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoverySeenCompany" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoverySeenCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignLead" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userLeadId" TEXT NOT NULL,
    "batchNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignCustomContact" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customContactId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignCustomContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyQuota" (
    "scope" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyQuota_pkey" PRIMARY KEY ("scope","subjectId","action","day")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "user_id" UUID NOT NULL,
    "google_refresh_token_encrypted" TEXT,
    "resume_path" TEXT,
    "resume_text" TEXT,
    "workspace_config" JSONB NOT NULL DEFAULT '{}',
    "default_filters" JSONB NOT NULL DEFAULT '{}',
    "full_name" TEXT,
    "bio" TEXT,
    "target_role" TEXT,
    "onboarding_completed" BOOLEAN NOT NULL DEFAULT false,
    "onboarding_completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_domain_key" ON "Company"("domain");

-- CreateIndex
CREATE INDEX "Company_stage_idx" ON "Company"("stage");

-- CreateIndex
CREATE INDEX "Company_industry_idx" ON "Company"("industry");

-- CreateIndex
CREATE INDEX "Company_region_idx" ON "Company"("region");

-- CreateIndex
CREATE INDEX "Company_isHiring_idx" ON "Company"("isHiring");

-- CreateIndex
CREATE INDEX "Company_source_idx" ON "Company"("source");

-- CreateIndex
CREATE INDEX "Company_headcount_idx" ON "Company"("headcount");

-- CreateIndex
CREATE INDEX "Company_isVerified_idx" ON "Company"("isVerified");

-- CreateIndex
CREATE INDEX "Company_qualityScore_idx" ON "Company"("qualityScore");

-- CreateIndex
CREATE INDEX "Company_tags_idx" ON "Company" USING GIN ("tags");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_email_key" ON "Contact"("email");

-- CreateIndex
CREATE INDEX "Contact_companyId_idx" ON "Contact"("companyId");

-- CreateIndex
CREATE INDEX "Contact_role_idx" ON "Contact"("role");

-- CreateIndex
CREATE INDEX "Contact_lastVerifiedAt_idx" ON "Contact"("lastVerifiedAt");

-- CreateIndex
CREATE INDEX "UserLead_userId_idx" ON "UserLead"("userId");

-- CreateIndex
CREATE INDEX "UserLead_status_idx" ON "UserLead"("status");

-- CreateIndex
CREATE UNIQUE INDEX "UserLead_userId_companyId_contactId_key" ON "UserLead"("userId", "companyId", "contactId");

-- CreateIndex
CREATE INDEX "CustomContact_userId_idx" ON "CustomContact"("userId");

-- CreateIndex
CREATE INDEX "Email_userLeadId_idx" ON "Email"("userLeadId");

-- CreateIndex
CREATE INDEX "Email_contactId_idx" ON "Email"("contactId");

-- CreateIndex
CREATE INDEX "Email_customContactId_idx" ON "Email"("customContactId");

-- CreateIndex
CREATE INDEX "Email_status_createdAt_idx" ON "Email"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Email_userLeadId_status_createdAt_idx" ON "Email"("userLeadId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Email_customContactId_status_createdAt_idx" ON "Email"("customContactId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Email_gmailThreadId_idx" ON "Email"("gmailThreadId");

-- CreateIndex
CREATE UNIQUE INDEX "UserGmailWatch_email_key" ON "UserGmailWatch"("email");

-- CreateIndex
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- CreateIndex
CREATE INDEX "Template_userId_idx" ON "Template"("userId");

-- CreateIndex
CREATE INDEX "Campaign_userId_idx" ON "Campaign"("userId");

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE INDEX "Campaign_templateId_idx" ON "Campaign"("templateId");

-- CreateIndex
CREATE INDEX "CampaignSeenCompany_campaignId_idx" ON "CampaignSeenCompany"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignSeenCompany_campaignId_companyId_key" ON "CampaignSeenCompany"("campaignId", "companyId");

-- CreateIndex
CREATE INDEX "DiscoverySeenCompany_userId_idx" ON "DiscoverySeenCompany"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoverySeenCompany_userId_companyId_key" ON "DiscoverySeenCompany"("userId", "companyId");

-- CreateIndex
CREATE INDEX "CampaignLead_campaignId_idx" ON "CampaignLead"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignLead_campaignId_batchNumber_idx" ON "CampaignLead"("campaignId", "batchNumber");

-- CreateIndex
CREATE INDEX "CampaignLead_userLeadId_idx" ON "CampaignLead"("userLeadId");

-- CreateIndex
CREATE INDEX "CampaignLead_campaignId_userLeadId_idx" ON "CampaignLead"("campaignId", "userLeadId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignLead_campaignId_batchNumber_userLeadId_key" ON "CampaignLead"("campaignId", "batchNumber", "userLeadId");

-- CreateIndex
CREATE INDEX "CampaignCustomContact_campaignId_idx" ON "CampaignCustomContact"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignCustomContact_customContactId_idx" ON "CampaignCustomContact"("customContactId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignCustomContact_campaignId_customContactId_key" ON "CampaignCustomContact"("campaignId", "customContactId");

-- CreateIndex
CREATE INDEX "DailyQuota_day_idx" ON "DailyQuota"("day");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLead" ADD CONSTRAINT "UserLead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLead" ADD CONSTRAINT "UserLead_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_userLeadId_fkey" FOREIGN KEY ("userLeadId") REFERENCES "UserLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_customContactId_fkey" FOREIGN KEY ("customContactId") REFERENCES "CustomContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSeenCompany" ADD CONSTRAINT "CampaignSeenCompany_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSeenCompany" ADD CONSTRAINT "CampaignSeenCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoverySeenCompany" ADD CONSTRAINT "DiscoverySeenCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLead" ADD CONSTRAINT "CampaignLead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLead" ADD CONSTRAINT "CampaignLead_userLeadId_fkey" FOREIGN KEY ("userLeadId") REFERENCES "UserLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignCustomContact" ADD CONSTRAINT "CampaignCustomContact_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignCustomContact" ADD CONSTRAINT "CampaignCustomContact_customContactId_fkey" FOREIGN KEY ("customContactId") REFERENCES "CustomContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

