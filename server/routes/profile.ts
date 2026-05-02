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

    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({
      profile: data
        ? {
            workspaceConfig: data.workspace_config ?? {},
            defaultFilters: data.default_filters ?? {},
            resumePath: data.resume_path,
            resumeText: data.resume_text,
            onboardingCompleted: data.onboarding_completed,
            onboardingCompletedAt: data.onboarding_completed_at,
            hasClaudeKey: !!data.claude_api_key_encrypted,
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

    if (body.workspaceConfig !== undefined) update.workspace_config = body.workspaceConfig;
    if (body.defaultFilters !== undefined) update.default_filters = body.defaultFilters;
    if (body.resumePath !== undefined) update.resume_path = body.resumePath;
    if (body.resumeText !== undefined) update.resume_text = body.resumeText;

    if (body.claudeApiKey !== undefined) {
      update.claude_api_key_encrypted = body.claudeApiKey ? encrypt(body.claudeApiKey) : null;
    }
    if (body.googleRefreshToken !== undefined) {
      update.google_refresh_token_encrypted = body.googleRefreshToken
        ? encrypt(body.googleRefreshToken)
        : null;
    }
    if (body.onboardingCompleted !== undefined) {
      update.onboarding_completed = body.onboardingCompleted;
      if (body.onboardingCompleted) update.onboarding_completed_at = new Date().toISOString();
    }

    const { error } = await supabase.from("user_profiles").upsert(update, { onConflict: "user_id" });
    if (error) return res.status(500).json({ error: error.message });

    return res.status(204).end();
  }

  res.setHeader("Allow", "GET, POST, PATCH");
  return res.status(405).json({ error: "Method not allowed" });
}
