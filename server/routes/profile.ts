import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin, getUserIdFromRequest } from "../lib/supabaseAdmin.js";
import { encrypt } from "../lib/crypto.js";

type ProfilePayload = {
  workspaceConfig?: unknown;
  defaultFilters?: unknown;
  resumePath?: string | null;
  resumeText?: string | null;
  claudeApiKey?: string | null;
  googleRefreshToken?: string | null;
  onboardingCompleted?: boolean;
};

const MAX_JSON_BYTES = 200_000;
const MAX_RESUME_TEXT_LENGTH = 100_000;
const MAX_PATH_LENGTH = 500;
const MAX_SECRET_LENGTH = 10_000;

function jsonSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

function sanitizeWorkspaceConfig(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const sanitized = { ...(value as Record<string, unknown>) };
  delete sanitized.apiKeys;
  if (jsonSize(sanitized) > MAX_JSON_BYTES) {
    throw new Error("workspaceConfig is too large");
  }
  return sanitized;
}

function sanitizeJsonObject(value: unknown, fieldName: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  if (jsonSize(value) > MAX_JSON_BYTES) throw new Error(`${fieldName} is too large`);
  return value;
}

function nullableLimitedString(value: unknown, fieldName: string, maxLength: number): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${fieldName} must be a string`);
  if (value.length > maxLength) throw new Error(`${fieldName} is too large`);
  return value;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  // Supabase user_profiles.user_id is UUID — non-UUID IDs are local dev bypasses
  // with no server-side profile, so return null profile gracefully.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(userId)) {
    return res.status(200).json({ profile: null });
  }

  const supabase = getSupabaseAdmin();

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("user_profiles")
      .select(
        "user_id, workspace_config, default_filters, resume_path, resume_text, onboarding_completed, onboarding_completed_at, claude_api_key_encrypted, google_refresh_token_encrypted, updated_at",
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: "Could not load profile" });

    return res.status(200).json({
      profile: data
        ? {
            workspaceConfig: data.workspace_config ?? {},
            defaultFilters: data.default_filters ?? {},
            resumePath: data.resume_path,
            resumeText: data.resume_text,
            onboardingCompleted: data.onboarding_completed,
            onboardingCompletedAt: data.onboarding_completed_at,
            // hasClaudeKey reflects "can this user generate?" — the per-user
            // BYO-key path is retired, so this just mirrors whether the
            // deployment has ANTHROPIC_API_KEY configured.
            hasClaudeKey: !!process.env.ANTHROPIC_API_KEY,
            hasGoogleRefreshToken: !!data.google_refresh_token_encrypted,
            updatedAt: data.updated_at,
          }
        : null,
    });
  }

  if (req.method === "POST" || req.method === "PATCH") {
    let body: ProfilePayload;
    try {
      body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) ?? {};
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }

    const update: Record<string, unknown> = {
      user_id: userId,
      updated_at: new Date().toISOString(),
    };

    try {
      if (body.workspaceConfig !== undefined) update.workspace_config = sanitizeWorkspaceConfig(body.workspaceConfig);
      if (body.defaultFilters !== undefined) update.default_filters = sanitizeJsonObject(body.defaultFilters, "defaultFilters");
      if (body.resumePath !== undefined) update.resume_path = nullableLimitedString(body.resumePath, "resumePath", MAX_PATH_LENGTH);
      if (body.resumeText !== undefined) update.resume_text = nullableLimitedString(body.resumeText, "resumeText", MAX_RESUME_TEXT_LENGTH);
      // claudeApiKey writes are intentionally ignored — the per-user BYO-key
      // path was retired. The body field is still parsed (so old clients
      // don't 400) but never persisted. The encrypted column stays in the
      // schema for migration safety.
      if (body.googleRefreshToken !== undefined) {
        const googleRefreshToken = nullableLimitedString(body.googleRefreshToken, "googleRefreshToken", MAX_SECRET_LENGTH);
        update.google_refresh_token_encrypted = googleRefreshToken ? encrypt(googleRefreshToken) : null;
      }
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }

    if (body.onboardingCompleted !== undefined) {
      if (typeof body.onboardingCompleted !== "boolean") {
        return res.status(400).json({ error: "onboardingCompleted must be a boolean" });
      }
      update.onboarding_completed = body.onboardingCompleted;
      if (body.onboardingCompleted) update.onboarding_completed_at = new Date().toISOString();
    }

    const { error } = await supabase.from("user_profiles").upsert(update, { onConflict: "user_id" });
    if (error) return res.status(500).json({ error: "Could not save profile" });

    return res.status(204).end();
  }

  res.setHeader("Allow", "GET, POST, PATCH");
  return res.status(405).json({ error: "Method not allowed" });
}
