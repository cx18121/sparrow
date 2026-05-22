-- Fix Supabase advisor: auth_rls_initplan on user_profiles.
--
-- The original policy used `auth.uid() = user_id`. Postgres treats bare
-- auth.uid() as a volatile function reference and re-evaluates it for
-- every row scanned, which becomes a per-row overhead as the table grows.
-- Wrapping in (select auth.uid()) lifts the call into an InitPlan so it
-- runs once per query and the result is treated as a constant in the
-- filter.
--
-- Behaviorally identical — auth.uid() is constant within a single request.

DROP POLICY IF EXISTS "Users can read own profile" ON user_profiles;

CREATE POLICY "Users can read own profile" ON user_profiles
  FOR SELECT USING ((SELECT auth.uid()) = user_id);
