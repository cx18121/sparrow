-- Production security patch for existing Supabase projects.
-- Run after backing up the project and reviewing the target project ref.

-- Allow both legacy resume paths (`<user_id>/<filename>`) and attachment
-- library paths (`files/<user_id>/<file_id>`) in the private resumes bucket.
DROP POLICY IF EXISTS "Users can upload own resume" ON storage.objects;
DROP POLICY IF EXISTS "Users can read own resume" ON storage.objects;
DROP POLICY IF EXISTS "Users can replace own resume" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own resume" ON storage.objects;

CREATE POLICY "Users can upload own resume"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'resumes'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR (
        (storage.foldername(name))[1] = 'files'
        AND auth.uid()::text = (storage.foldername(name))[2]
      )
    )
  );

CREATE POLICY "Users can read own resume"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'resumes'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR (
        (storage.foldername(name))[1] = 'files'
        AND auth.uid()::text = (storage.foldername(name))[2]
      )
    )
  );

CREATE POLICY "Users can replace own resume"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'resumes'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR (
        (storage.foldername(name))[1] = 'files'
        AND auth.uid()::text = (storage.foldername(name))[2]
      )
    )
  )
  WITH CHECK (
    bucket_id = 'resumes'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR (
        (storage.foldername(name))[1] = 'files'
        AND auth.uid()::text = (storage.foldername(name))[2]
      )
    )
  );

CREATE POLICY "Users can delete own resume"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'resumes'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR (
        (storage.foldername(name))[1] = 'files'
        AND auth.uid()::text = (storage.foldername(name))[2]
      )
    )
  );

-- DB-backed quota table used by server/lib/rate-limit.ts.
CREATE TABLE IF NOT EXISTS public."DailyQuota" (
  "scope" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyQuota_pkey" PRIMARY KEY ("scope", "subjectId", "action", "day")
);

CREATE INDEX IF NOT EXISTS "DailyQuota_day_idx" ON public."DailyQuota" ("day");

ALTER TABLE public."DailyQuota" ENABLE ROW LEVEL SECURITY;

-- No browser/client access; all quota writes happen via the server Prisma user.
DROP POLICY IF EXISTS "No client access to DailyQuota" ON public."DailyQuota";
CREATE POLICY "No client access to DailyQuota"
  ON public."DailyQuota"
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- Prisma-managed public tables are accessed through server-side API routes.
-- Keep RLS enabled as defense in depth so anon/authenticated Data API clients
-- cannot access rows unless explicit policies are added later.
ALTER TABLE public."Campaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CampaignLead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CampaignSeenCompany" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Company" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CustomContact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DiscoverySeenCompany" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Email" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Template" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."UserLead" ENABLE ROW LEVEL SECURITY;
