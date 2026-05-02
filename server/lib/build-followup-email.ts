export const DEFAULT_FOLLOW_UP_TEMPLATE = `Hi {{firstName}},

I wanted to follow up on my previous message. I'm still very interested in what the team at {{company}} is building and would love to connect.

Would a 15-minute call work for you?

{{senderName}}`

export function buildFollowUpEmail(
  template: string | null,
  contact: { firstName: string | null; name: string | null; company: string | null },
  senderName: string | null,
  originalSubject: string | null
): { subject: string; body: string } {
  const tmpl = template ?? DEFAULT_FOLLOW_UP_TEMPLATE

  const firstName = contact.firstName ?? contact.name?.split(' ')[0] ?? 'there'
  const company = contact.company ?? 'your company'

  const body = tmpl
    .replace(/\{\{firstName\}\}/g, firstName)
    .replace(/\{\{company\}\}/g, company)
    .replace(/\{\{senderName\}\}/g, senderName ?? '')

  const baseSubject = originalSubject?.replace(/^(Re:\s*)+/i, '').trim() ?? null
  const subject = baseSubject ? `Re: ${baseSubject}` : 'Following up'

  return { subject, body }
}
