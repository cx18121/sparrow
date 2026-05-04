import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { buildSenderContext } from "./build-sender-context.js";
import { parseWorkspaceConfig, type WorkspaceConfig } from "./workspace-config.js";

export interface ResolvedProfile {
  apiKey: string;
  senderName: string | null;
  senderRole: string | null;
  resumeText: string | null;
  ws: WorkspaceConfig;
}

export class ProfileError extends Error {
  constructor(message: string, public readonly status: 400 | 500) {
    super(message);
  }
}

// The Claude key is host-managed via process.env.ANTHROPIC_API_KEY.
// User profiles never supply generation API keys.
function resolveClaudeKey(): string {
  const envKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (envKey) return envKey;
  throw new ProfileError("Email generation is not configured on this deployment. Contact the host.", 500);
}

// Fetches the user's Profile and assembles the sender context for email
// generation. The Claude key comes from the deployment env, not the profile.
export async function resolveProfileForGeneration(userId: string): Promise<ResolvedProfile> {
  const supabase = getSupabaseAdmin();
  const { data: profile, error } = await supabase
    .from("user_profiles")
    .select("resume_text, workspace_config")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new ProfileError(error.message, 500);

  const apiKey = resolveClaudeKey();

  const ws = parseWorkspaceConfig(profile?.workspace_config);
  return {
    apiKey,
    senderName: ws.senderName ?? null,
    senderRole: ws.senderRole ?? null,
    resumeText: profile?.resume_text ?? null,
    ws,
  };
}

// Assembles the sender context string from a resolved profile and per-request extras.
export function buildSenderContextFromProfile(
  profile: ResolvedProfile,
  extras: { tone?: string | null; extraContext?: string | null; includeResumeBullet?: boolean }
): string {
  const resumeBulletInstruction = extras.includeResumeBullet
    ? "Use one relevant detail from the sender's resume only if it strengthens the email. Make it specific and natural; do not list multiple bullets or invent experience."
    : null;
  const extraParts = [
    extras.tone ? `Tone: ${extras.tone}` : null,
    resumeBulletInstruction,
    extras.extraContext ?? null,
  ]
    .filter(Boolean)
    .join(". ");

  return buildSenderContext({
    name: profile.senderName,
    company: profile.ws.senderCompany ?? null,
    bio: [profile.senderRole, extraParts].filter(Boolean).join(". ") || null,
    targetRole: profile.senderRole,
    resumeText: profile.resumeText,
  });
}
