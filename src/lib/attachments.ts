export type AttachmentFile = {
  id: string
  path?: string
  fileName: string
  mimeType?: string | null
  size?: number | null
  uploadedAt?: string | null
  source?: 'resume' | 'library'
}

export function getAttachmentLibrary(workspaceConfig: any): AttachmentFile[] {
  const files = Array.isArray(workspaceConfig?.files) ? workspaceConfig.files : []
  const resume = workspaceConfig?.resumePath && workspaceConfig?.resumeFileName
    ? [{
        id: 'resume',
        path: workspaceConfig.resumePath,
        fileName: workspaceConfig.resumeFileName,
        mimeType: workspaceConfig.resumeFileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : undefined,
        size: null,
        uploadedAt: workspaceConfig.resumeUploadedAt || null,
        source: 'resume' as const,
      }]
    : []
  return [...resume, ...files.map((file: AttachmentFile) => ({ ...file, source: 'library' as const }))]
}

export function sanitizeAttachmentIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []
}

export function defaultAttachmentIds(workspaceConfig: any, template?: { attachmentIds?: string[] | null } | null): string[] {
  const templateIds = sanitizeAttachmentIds(template?.attachmentIds)
  if (templateIds.length > 0) return templateIds
  return workspaceConfig?.resumePath && workspaceConfig?.resumeFileName ? ['resume'] : []
}
