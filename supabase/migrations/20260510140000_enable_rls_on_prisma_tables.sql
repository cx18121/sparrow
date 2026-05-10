-- Enable RLS on every Prisma-managed table, with an explicit deny-all policy.
--
-- Why: by default Supabase exposes every public-schema table via PostgREST,
-- and the publishable/anon key is embedded in the frontend bundle. Without
-- RLS, anyone with that key can read/write rows directly via the PostgREST
-- endpoint, bypassing our API server entirely. Supabase Security Advisor
-- flagged UserGmailWatch as the worst offender; this migration closes the
-- gap on every other Prisma-managed table at the same time.
--
-- Why deny-all and not per-user policies: all data access in this app flows
-- through the API server, which uses the SUPABASE_SERVICE_ROLE_KEY. Service-
-- role traffic bypasses RLS automatically. The frontend never queries these
-- tables directly with the anon key. A `using (false)` policy makes the
-- intent explicit ("this table is service-role only"), removes the
-- "RLS Enabled No Policy" advisor warnings, and has zero risk of accidentally
-- exposing data via a buggy auth.uid() comparison.
--
-- If you ever start using direct supabase-js .from() queries with the anon
-- key in the browser, replace these deny-all policies with per-user policies
-- (auth.uid()::text = "userId") at that point.
--
-- Idempotent: ALTER TABLE ... ENABLE ROW LEVEL SECURITY is a no-op when
-- already enabled. Policies use a fixed name and drop-then-create so re-runs
-- are safe.

do $$
declare
  t text;
  tables text[] := array[
    'Company',
    'Contact',
    'UserLead',
    'CustomContact',
    'Email',
    'UserGmailWatch',
    'IdempotencyKey',
    'Template',
    'Campaign',
    'CampaignSeenCompany',
    'DiscoverySeenCompany',
    'CampaignLead',
    'CampaignCustomContact',
    'DailyQuota'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "service_role only" on public.%I', t);
    execute format(
      'create policy "service_role only" on public.%I for all using (false) with check (false)',
      t
    );
  end loop;
end $$;
