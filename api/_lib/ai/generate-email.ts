import { humanizeEmailBody } from './humanize.js'
import {
  DEFAULT_SUBJECT_TEMPLATE,
  EMAIL_GENERATION_SYSTEM_PROMPT,
  GENERIC_FALLBACK_SUBJECT,
  GENERIC_FALLBACK_BODY,
} from './prompts.js'
import type { EmailDraft, GenerateEmailParams } from './types.js'

const ANTHROPIC_VERSION = '2023-06-01'
const GENERATION_MODEL = 'claude-haiku-4-5-20251001'

export { GENERIC_FALLBACK_SUBJECT, GENERIC_FALLBACK_BODY }

// Substitutes all supported {{variable}} placeholders in a template string.
export function substituteVariables(
  text: string,
  contact: { name: string | null },
  senderName: string | null,
  company?: { name: string }
): string {
  const firstName = contact.name?.split(' ')[0] ?? ''
  return text
    .replace(/\{\{firstName\}\}/g, firstName)
    .replace(/\{\{senderName\}\}/g, senderName ?? '')
    .replace(/\{\{company\}\}/g, company?.name ?? '')
    .replace(/\{\{company_name\}\}/g, company?.name ?? '')
    .replace(/\{\{companyName\}\}/g, company?.name ?? '')
}

export function buildSubjectLine(
  template: string | null,
  contact: { name: string | null },
  senderName: string | null,
  company?: { name: string }
): string {
  return substituteVariables(template ?? DEFAULT_SUBJECT_TEMPLATE, contact, senderName, company)
}

export async function generateEmailDraft(params: GenerateEmailParams): Promise<EmailDraft> {
  // When a user template is provided, use it verbatim — no AI body generation.
  if (params.userTemplate != null) {
    const body = substituteVariables(params.userTemplate, params.contact, params.senderName, params.company)
    const subject = buildSubjectLine(params.subjectTemplate, params.contact, params.senderName, params.company)
    return { subject, body }
  }

  const styleGuidance = params.styleInstruction
    ? `Style (follow precisely):\n${params.styleInstruction}`
    : 'Style: direct, concise, specific — 80–120 words.'

  const hookNote = params.interestHook
    ? `Interest hook — weave in naturally mid-email: "${params.interestHook}"`
    : 'No interest hook — do not invent one.'

  const companyContext = [
    params.company.oneLiner ?? params.company.description,
    params.company.stage,
    params.company.industry,
    params.company.isHiring ? 'currently hiring' : null,
  ]
    .filter(Boolean)
    .join('; ')

  const companyLabel = params.company.name ? ` at ${params.company.name}` : ''

  const prompt = [
    styleGuidance,
    '',
    'Write a cold email with this structure:',
    '1. Opening: a specific, concrete reason for reaching out based on the company context below. No generic flattery.',
    '2. Bridge: one sentence connecting the sender to the company or role.',
    '3. Ask: one low-friction request.',
    '',
    `Contact: ${params.contact.name ?? 'there'}, ${params.contact.title ?? 'professional'}${companyLabel}`,
    companyContext ? `Company: ${companyContext}` : null,
    `Sender: ${params.senderContext}`,
    hookNote,
    '',
    'Output only the email body — no subject line.',
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
      system: [
        EMAIL_GENERATION_SYSTEM_PROMPT,
        params.styleInstruction ? `User style preference:\n${params.styleInstruction}` : null,
      ]
        .filter(Boolean)
        .join('\n\n'),
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
