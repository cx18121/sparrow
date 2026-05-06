-- Drop two retired columns that no live code path reads or writes.
--
-- 1. Campaign.filterHeadcountMin / filterHeadcountMax — were the campaign-
--    level headcount range filter. Retired when the audience filter dropped
--    headcount; no UI input renders, no audienceToPrismaWhere branch reads.
--    A regression test asserted the values were ignored. Pure dead plumbing.
--
-- 2. user_profiles.claude_api_key_encrypted — was the storage column for
--    per-user BYO Claude API keys (encrypted at rest). The BYO-key path is
--    fully retired; server reads process.env.ANTHROPIC_API_KEY only. Column
--    was kept "for migration safety" but nothing reads or writes it.
--
-- Note: Company.headcount stays. It still drives qualityScore, gets written
-- by every ingest source, and is the natural axis for the planned
-- sponsorship-mode audience preset.
--
-- Deploy order: ship the code that stops referencing these columns first,
-- then run this SQL. Both columns are nullable / unused, so the order is
-- not strictly critical, but doing code-first keeps the deploy reversible.

ALTER TABLE "Campaign"
  DROP COLUMN IF EXISTS "filterHeadcountMin",
  DROP COLUMN IF EXISTS "filterHeadcountMax";

ALTER TABLE user_profiles
  DROP COLUMN IF EXISTS claude_api_key_encrypted;
