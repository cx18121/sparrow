import { humanizeEmailBody } from './humanize.js'
import {
  DEFAULT_SUBJECT_TEMPLATE,
  EMAIL_GENERATION_SYSTEM_PROMPT,
  GENERIC_FALLBACK_SUBJECT,
  GENERIC_FALLBACK_BODY,
} from './prompts.js'
import type {
  AiDraftInput,
  DraftCompany,
  DraftContact,
  DraftInput,
  EmailDraft,
  FallbackDraftInput,
  TemplateDraftInput,
} from './types.js'

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

function draftFromTemplate(input: TemplateDraftInput): EmailDraft {
  const body = substituteVariables(input.body, input.contact, input.senderName, input.company)
  const subject = buildSubjectLine(input.subjectTemplate, input.contact, input.senderName, input.company)
  return { subject, body }
}

function draftFallback(input: FallbackDraftInput): EmailDraft {
  const contactName = input.contact.name ?? 'there'
  const subject = buildSubjectLine(input.subjectTemplate, input.contact, input.senderName, input.company)
  return {
    subject: input.subjectTemplate ? subject : GENERIC_FALLBACK_SUBJECT,
    body: GENERIC_FALLBACK_BODY(contactName, input.company.name),
  }
}

function buildPrompt(input: AiDraftInput): string {
  const styleGuidance = input.styleInstruction
    ? `Style (follow precisely):\n${input.styleInstruction}`
    : 'Style: direct, concise, specific — 80–120 words.'

  const hookNote = input.interestHook
    ? `Interest hook — weave in naturally mid-email: "${input.interestHook}"`
    : 'No interest hook — do not invent one.'

  const companyContext = [
    input.company.oneLiner ?? input.company.description,
    input.company.stage,
    input.company.industry,
    input.company.isHiring ? 'currently hiring' : null,
  ]
    .filter(Boolean)
    .join('; ')

  const companyLabel = input.company.name ? ` at ${input.company.name}` : ''

  return [
    styleGuidance,
    '',
    'Write a cold email with this structure:',
    '1. Opening: a specific, concrete reason for reaching out based on the company context below. No generic flattery.',
    '2. Bridge: one sentence connecting the sender to the company or role.',
    '3. Ask: one low-friction request.',
    '',
    `Contact: ${input.contact.name ?? 'there'}, ${input.contact.title ?? 'professional'}${companyLabel}`,
    companyContext ? `Company: ${companyContext}` : null,
    `Sender: ${input.senderContext}`,
    hookNote,
    '',
    'Output only the email body — no subject line.',
  ]
    .filter(Boolean)
    .join('\n')
}

async function draftFromAi(input: AiDraftInput): Promise<EmailDraft> {
  const prompt = buildPrompt(input)

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': input.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: GENERATION_MODEL,
      max_tokens: 1024,
      system: [
        EMAIL_GENERATION_SYSTEM_PROMPT,
        input.styleInstruction ? `User style preference:\n${input.styleInstruction}` : null,
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

  const body = await humanizeEmailBody(rawBody, input.apiKey)
  const subject = buildSubjectLine(input.subjectTemplate, input.contact, input.senderName, input.company)

  return { subject, body }
}

// Dispatches on input.kind. Each branch is independently testable through this
// single entry point — see api/__tests__/generate-email.test.ts for examples
// of every mode.
export async function generateEmailDraft(input: DraftInput): Promise<EmailDraft> {
  switch (input.kind) {
    case 'template':
      return draftFromTemplate(input)
    case 'fallback':
      return draftFallback(input)
    case 'ai':
      return draftFromAi(input)
  }
}

export type { DraftCompany, DraftContact, DraftInput, EmailDraft }
