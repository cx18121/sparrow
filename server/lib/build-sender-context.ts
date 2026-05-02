interface SenderProfile {
  name?: string | null
  company?: string | null
  bio?: string | null
  targetRole?: string | null
  resumeText?: string | null
}

export function buildSenderContext(profile: SenderProfile | null | undefined): string {
  if (!profile) return ''
  const parts: string[] = []
  if (profile.name) parts.push(`Name: ${profile.name}`)
  if (profile.company) parts.push(`Organization: ${profile.company}`)
  if (profile.targetRole) parts.push(`Looking for: ${profile.targetRole}`)
  if (profile.bio) parts.push(`Background: ${profile.bio}`)
  if (profile.resumeText) parts.push(`Resume excerpt: ${profile.resumeText.slice(0, 500)}`)
  return parts.join(', ')
}
