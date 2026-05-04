import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { decrypt } from "./crypto.js";
import { buildSenderContext } from "./build-sender-context.js";
import { parseWorkspaceConfig, resolveStyleInstruction, type WorkspaceConfig } from "./workspace-config.js";

export interface ResolvedProfile {
  apiKey: string;
  senderName: string | null;
  senderRole: string | null;
  signature: string | null;
  resumeText: string | null;
  styleInstruction: string | null;
  ws: WorkspaceConfig;
}

export class ProfileError extends Error {
  constructor(message: string, public readonly status: 400 | 500) {
    super(message);
  }
}

// Resolve the Claude key with this precedence: per-user encrypted key in the
// profile (BYO-key, higher rate limits + their own billing) → server env
// fallback (lets a fresh user generate without going to Settings first).
// Throws ProfileError when neither path yields a usable key.
function resolveClaudeKey(encrypted: string | null | undefined): string {
  if (encrypted) {
    try {
      return decrypt(encrypted);
    } catch {
      throw new ProfileError("We could not read your saved Claude key. Re-enter it in Settings.", 500);
    }
  }
  const envKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (envKey) return envKey;
  throw new ProfileError("Add a Claude API key in Settings before generating emails.", 400);
}

// Fetches the user's Profile, resolves a Claude API key (per-user → env), and
// assembles the sender context for email generation.
export async function resolveProfileForGeneration(userId: string): Promise<ResolvedProfile> {
  const supabase = getSupabaseAdmin();
  const { data: profile, error } = await supabase
    .from("user_profiles")
    .select("resume_text, claude_api_key_encrypted, workspace_config")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new ProfileError(error.message, 500);

  const apiKey = resolveClaudeKey(profile?.claude_api_key_encrypted);

  const ws = parseWorkspaceConfig(profile?.workspace_config);
  const signature = typeof ws.signature === "string" ? ws.signature.trim() : "";
  return {
    apiKey,
    senderName: ws.senderName ?? null,
    senderRole: ws.senderRole ?? null,
    signature: signature || null,
    resumeText: profile?.resume_text ?? null,
    styleInstruction: resolveStyleInstruction(ws),
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
