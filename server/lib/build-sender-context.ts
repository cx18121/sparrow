interface SenderProfile {
  name?: string | null
  bio?: string | null
  resumeText?: string | null
}

export function buildSenderContext(profile: SenderProfile | null | undefined): string {
  if (!profile) return ''
  const parts: string[] = []
  if (profile.name) parts.push(`Name: ${profile.name}`)
  if (profile.bio) parts.push(`Background: ${profile.bio}`)
  if (profile.resumeText) parts.push(`Resume excerpt: ${profile.resumeText.slice(0, 500)}`)
  return parts.join(', ')
}
