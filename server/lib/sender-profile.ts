import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { buildSenderContext } from "./build-sender-context.js";
import { parseWorkspaceConfig, type WorkspaceConfig } from "./workspace-config.js";
import type { RoleFamily } from "../../src/types/roleFamilies.js";

export interface ResolvedProfile {
  apiKey: string;
  senderName: string | null;
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
    .select("resume_text, resume_path, workspace_config")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new ProfileError(error.message, 500);

  const apiKey = resolveClaudeKey();

  const ws = {
    ...parseWorkspaceConfig(profile?.workspace_config),
    resumePath: parseWorkspaceConfig(profile?.workspace_config).resumePath || profile?.resume_path || null,
  };
  return {
    apiKey,
    senderName: ws.senderName ?? null,
    resumeText: profile?.resume_text ?? null,
    ws,
  };
}

// Role-family steers for which resume bullet to surface. Positive-only:
// when the resume has a bullet matching the family, prefer it; otherwise
// fall back to the generic "most relevant" behavior. Negative framing
// (e.g. "avoid eng bullets when targeting GTM") risks dropping strong
// cross-functional anchors like "shipped product that drove $2M ARR" —
// off-tag on the surface, exactly the right signal in substance.
//
// Note: this hint reaches the body-generation prompt, not pickFitAngle.
// The primary resume-bullet decision (fitAngle) is locked in upstream by
// research-fit-angle.ts:ROLE_HINTS and passed verbatim into the body
// prompt — this map only nudges the model when it weaves in additional
// resume detail beyond the chosen fitAngle. See scripts/smoke-role-drafts.ts
// for the harness that surfaces this seam.
const ROLE_BULLET_HINTS: Record<RoleFamily, string> = {
  engineering:
    "If the resume includes engineering work (systems, infrastructure, code, models, developer tools, shipping at scale), prefer that bullet.",
  product:
    "If the resume includes product or design work (user-facing features, decisions, research, craft), prefer that bullet.",
  gtm:
    "If the resume includes go-to-market work (sales, marketing, growth, revenue, partnerships, customer wins), prefer that bullet.",
  operations:
    "If the resume includes operations, finance, people, or process work (scaling teams, hiring, systems, cross-functional execution), prefer that bullet.",
};

function resumeBulletInstructionFor(role: RoleFamily | null | undefined): string {
  const base =
    "Use one relevant detail from the sender's resume only if it strengthens the email. Make it specific and natural; do not list multiple bullets or invent experience.";
  if (!role) return base;
  const hint = ROLE_BULLET_HINTS[role];
  return hint ? `${base} ${hint}` : base;
}

// Assembles the sender context string from a resolved profile and per-request extras.
export function buildSenderContextFromProfile(
  profile: ResolvedProfile,
  extras: {
    tone?: string | null;
    extraContext?: string | null;
    includeResumeBullet?: boolean;
    targetRole?: RoleFamily | null;
  }
): string {
  const resumeBulletInstruction = extras.includeResumeBullet
    ? resumeBulletInstructionFor(extras.targetRole ?? null)
    : null;
  const bio = [
    extras.tone ? `Tone: ${extras.tone}` : null,
    resumeBulletInstruction,
    extras.extraContext ?? null,
  ]
    .filter(Boolean)
    .join(". ");

  return buildSenderContext({
    name: profile.senderName,
    bio: bio || null,
    resumeText: profile.resumeText,
  });
}
