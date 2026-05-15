-- One-off: reset every per-user sendingLimits blob to the current
-- server defaults (server/lib/workspace-config.ts: dailyMax=250,
-- monthlyMax=2000, delaySeconds=15).
--
-- Context: the Settings UI used to expose Daily send limit + Delay
-- between sends as user-editable fields. Some legacy rows still carry
-- custom values from that era (e.g. dailyMax: 100). The UI controls
-- were removed, so those values are now invisible-but-binding. This
-- migration normalizes everyone onto the defaults so a user's send
-- quota matches what the SendActivity panel claims.
--
-- Idempotent: running twice writes the same payload. Touches only
-- user_profiles rows that have a workspace_config JSON object.

UPDATE user_profiles
SET
  workspace_config = jsonb_set(
    workspace_config,
    '{sendingLimits}',
    '{"dailyMax": 250, "monthlyMax": 2000, "delaySeconds": 15}'::jsonb
  ),
  updated_at = NOW()
WHERE workspace_config IS NOT NULL
  AND jsonb_typeof(workspace_config) = 'object';
