export interface FileEntry {
  id: string;
  path: string;
  fileName: string;
  mimeType: string;
}

export interface WorkspaceConfig {
  senderName?: string | null;
  senderRole?: string | null;
  senderCompany?: string | null;
  resumeText?: string | null;
  resumeFileName?: string | null;
  resumePath?: string | null;
  templateId?: string | null;
  styleProfile?: {
    prompt?: string;
    traits?: string[];
    examples?: string[];
    name?: string;
    summary?: string;
  } | null;
  leadsPerGeneration?: number | null;
  sendingLimits?: {
    dailyMax?: number | null;
    delaySeconds?: number | null;
  } | null;
  files?: FileEntry[] | null;
}

export function parseWorkspaceConfig(raw: unknown): WorkspaceConfig {
  if (!raw || typeof raw !== "object") return {};
  return raw as WorkspaceConfig;
}

const TRAIT_PROMPTS: Record<string, string> = {
  direct: 'Use direct language. State the reason for reaching out early and include a clear ask.',
  warm: 'Use a warm but professional tone. Keep the message human without adding filler.',
  concise: 'Keep the email short. Prefer 70 to 100 words and remove unnecessary setup.',
  specific: 'Include one concrete relevance signal about the company or recipient. Do not invent facts.',
  polished: 'Keep phrasing professional and composed. Avoid slang, hype, and overfamiliar language.',
}

export function resolveStyleInstruction(ws: WorkspaceConfig): string | null {
  const sp = ws.styleProfile;
  if (typeof sp?.prompt === "string" && sp.prompt.trim()) return sp.prompt.trim();
  if (Array.isArray(sp?.traits) && sp.traits.length > 0) {
    return sp.traits.map((t) => TRAIT_PROMPTS[t]).filter(Boolean).join(' ');
  }
  return null;
}
