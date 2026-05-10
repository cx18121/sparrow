-- Enable RLS on every Prisma-managed table.
--
-- Why: by default Supabase exposes every public-schema table via PostgREST,
-- and the publishable/anon key is embedded in the frontend bundle. Without
-- RLS, anyone with that key can read/write rows directly via the PostgREST
-- endpoint, bypassing our API server entirely. Supabase Security Advisor
-- flagged UserGmailWatch as the worst offender; this migration closes the
-- gap on every other Prisma-managed table at the same time.
--
-- Why no policies: all data access in this app flows through the API server,
-- which uses the SUPABASE_SERVICE_ROLE_KEY. Service-role traffic bypasses
-- RLS automatically. RLS with zero policies is deny-by-default for every
-- non-service role — exactly the behavior we want. We deliberately do NOT
-- add per-row "auth.uid() = userId" policies because the frontend never
-- talks to these tables directly; adding policies would only widen the
-- attack surface (mistakes in a policy could expose data that's currently
-- inaccessible).
--
-- Idempotent: re-running ALTER TABLE ... ENABLE ROW LEVEL SECURITY on a
-- table that already has RLS is a no-op.

alter table public."Company"               enable row level security;
alter table public."Contact"               enable row level security;
alter table public."UserLead"              enable row level security;
alter table public."CustomContact"         enable row level security;
alter table public."Email"                 enable row level security;
alter table public."UserGmailWatch"        enable row level security;
alter table public."IdempotencyKey"        enable row level security;
alter table public."Template"              enable row level security;
alter table public."Campaign"              enable row level security;
alter table public."CampaignSeenCompany"   enable row level security;
alter table public."DiscoverySeenCompany"  enable row level security;
alter table public."CampaignLead"          enable row level security;
alter table public."CampaignCustomContact" enable row level security;
alter table public."DailyQuota"            enable row level security;
