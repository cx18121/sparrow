export { getAttachmentLibrary, type AttachmentFile } from './workspaceConfig'

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
