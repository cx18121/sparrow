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
