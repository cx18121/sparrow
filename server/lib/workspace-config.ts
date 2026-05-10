export interface FileEntry {
  id: string;
  path: string;
  fileName: string;
  mimeType: string;
}

export interface WorkspaceConfig {
  senderName?: string | null;
  resumeText?: string | null;
  resumeFileName?: string | null;
  resumePath?: string | null;
  templateId?: string | null;
  leadsPerGeneration?: number | null;
  sendingLimits?: {
    dailyMax?: number | null;
    monthlyMax?: number | null;
    delaySeconds?: number | null;
  } | null;
  files?: FileEntry[] | null;
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeSendingLimits(value: unknown, bounds = { maxDaily: 500, maxMonthly: 10000 }) {
  const limits = value && typeof value === "object" && !Array.isArray(value)
    ? value as { dailyMax?: unknown; monthlyMax?: unknown; delaySeconds?: unknown }
    : {};
  const daily = finiteNumber(limits.dailyMax);
  const monthly = finiteNumber(limits.monthlyMax);
  const delay = finiteNumber(limits.delaySeconds);
  return {
    dailyMax: daily == null ? 250 : Math.min(bounds.maxDaily, Math.max(1, Math.round(daily))),
    monthlyMax: monthly == null ? 2000 : Math.min(bounds.maxMonthly, Math.max(1, Math.round(monthly))),
    delaySeconds: delay == null ? 15 : Math.min(3600, Math.max(15, Math.round(delay))),
  };
}

export function mimeFromWorkspaceFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

export function attachmentLibraryFromWorkspaceConfig(workspaceConfig: WorkspaceConfig) {
  const files = Array.isArray(workspaceConfig.files) ? workspaceConfig.files : [];
  const resume = workspaceConfig.resumePath && workspaceConfig.resumeFileName
    ? [{
        id: "resume",
        path: workspaceConfig.resumePath,
        fileName: workspaceConfig.resumeFileName,
        mimeType: mimeFromWorkspaceFileName(workspaceConfig.resumeFileName),
      }]
    : [];
  return [...resume, ...files];
}

export function parseWorkspaceConfig(raw: unknown): WorkspaceConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const parsed = raw as WorkspaceConfig;
  return {
    ...parsed,
    sendingLimits: normalizeSendingLimits(parsed.sendingLimits),
    files: Array.isArray(parsed.files) ? parsed.files : [],
  };
}
