import { humanizeEmailBody } from './humanize.js'
import {
  BUILT_IN_DEFAULT_TEMPLATE,
  DEFAULT_SUBJECT_TEMPLATE,
  EMAIL_GENERATION_SYSTEM_PROMPT,
  GENERIC_FALLBACK_SUBJECT,
  GENERIC_FALLBACK_BODY,
} from './prompts.js'
import type { EmailDraft, GenerateEmailParams } from './types.js'

const ANTHROPIC_VERSION = '2023-06-01'
const GENERATION_MODEL = 'claude-haiku-4-5-20251001'

export { GENERIC_FALLBACK_SUBJECT, GENERIC_FALLBACK_BODY }

export function buildSubjectLine(
  template: string | null,
  contact: { name: string | null },
  senderName: string | null,
  company?: { name: string }
): string {
  const tmpl = template ?? DEFAULT_SUBJECT_TEMPLATE
  const firstName = contact.name?.split(' ')[0] ?? 'there'
  return tmpl
    .replace(/\{\{firstName\}\}/g, firstName)
    .replace(/\{\{senderName\}\}/g, senderName ?? '')
    .replace(/\{\{company\}\}/g, company?.name ?? '')
    .replace(/\{\{companyName\}\}/g, company?.name ?? '')
}

export async function generateEmailDraft(params: GenerateEmailParams): Promise<EmailDraft> {
  const template = params.userTemplate ?? BUILT_IN_DEFAULT_TEMPLATE
  const hookInstruction = params.interestHook
    ? `Weave this interest hook naturally in the MIDDLE of the email: "${params.interestHook}"`
    : 'No interest hook — write a warm, specific email. Do not invent interests.'

  const companyContext = [
    params.company.oneLiner ?? params.company.description,
    params.company.stage,
    params.company.industry,
    params.company.isHiring ? 'currently hiring' : null,
  ]
    .filter(Boolean)
    .join('; ')

  const prompt = [
    `Template:\n${template}`,
    `\nContact: ${params.contact.name ?? 'there'}, ${params.contact.title ?? 'employee'} at ${params.company.name}`,
    companyContext ? `Company context: ${companyContext}` : null,
    `Sender context: ${params.senderContext}`,
    `\n${hookInstruction}`,
    '\nFill the template. Output ONLY the email body — no subject line.',
  ]
    .filter(Boolean)
    .join('\n')

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': params.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: GENERATION_MODEL,
      max_tokens: 1024,
      system: `${EMAIL_GENERATION_SYSTEM_PROMPT}\n${hookInstruction}`,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Anthropic API ${resp.status}: ${text}`)
  }

  const data = (await resp.json()) as { content?: Array<{ type: string; text?: string }> }
  const rawBody = data.content?.find((c) => c.type === 'text')?.text?.trim() ?? ''

  const body = await humanizeEmailBody(rawBody, params.apiKey)
  const subject = buildSubjectLine(params.subjectTemplate, params.contact, params.senderName, params.company)

  return { subject, body }
}
