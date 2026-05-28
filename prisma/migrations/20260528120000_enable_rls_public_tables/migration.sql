-- Enable RLS on every public application table so Supabase's PostgREST
-- anon/authenticated endpoints expose zero rows by default. The anon and
-- authenticated roles hold default SELECT grants on the public schema, so a
-- table without RLS is readable through the public Supabase REST endpoint
-- using only the publishable anon key (which ships in the client bundle).
--
-- Most of these tables already had RLS enabled in prod via an ad-hoc apply of
-- prisma/legacy/enable_public_rls.sql — but that script lived OUTSIDE the
-- migration history, so a fresh deploy from `prisma/migrations/` would NOT
-- reproduce the lockdown. This migration captures the live state in version
-- control AND closes the one table that slipped through: CompanyOptionsSnapshot
-- (added after the legacy script, shipped with RLS off).
--
-- No policies are added: RLS enabled + no policy = deny-all for anon and
-- authenticated. The app server reaches these tables through Prisma's
-- DIRECT_URL/DATABASE_URL connection, which runs as a postgres-role superuser
-- that bypasses RLS — so server-side reads/writes are unaffected. This is the
-- same mechanism already proven live on Company, Email, UserLead, etc.
--
-- Idempotent: ENABLE ROW LEVEL SECURITY on an already-enabled table is a
-- no-op, so re-running this migration is safe.
ALTER TABLE "public"."Campaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."CampaignCustomContact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."CampaignLead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."CampaignSeenCompany" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Company" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."CompanyOptionsSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."CustomContact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."DailyQuota" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."DiscoverySeenCompany" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Email" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."IdempotencyKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Template" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."UserGmailWatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."UserLead" ENABLE ROW LEVEL SECURITY;
