import { callClaude } from './anthropic.js'
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

const GENERATION_MODEL = 'claude-haiku-4-5-20251001'

export { GENERIC_FALLBACK_SUBJECT, GENERIC_FALLBACK_BODY }

// Substitutes all supported {{variable}} placeholders in a template string.
// Both snake_case (as advertised in the Templates tab) and camelCase
// (legacy) tags are honored so we don't break templates already saved
// in either form. featureLine and fitAngle are filled when web research
// produced them — substituted as empty strings otherwise so verbatim
// templates don't render literal '{{feature_line}}' to the recipient.
export function substituteVariables(
  text: string,
  contact: { name: string | null; title?: string | null },
  senderName: string | null,
  company?: { name: string },
  ai?: { featureLine?: string | null; fitAngle?: string | null }
): string {
  const firstName = contact.name?.split(' ')[0] ?? ''
  const lastName = contact.name?.split(' ').slice(1).join(' ') ?? ''
  const role = contact.title ?? ''
  const companyName = company?.name ?? ''
  const featureLine = ai?.featureLine ?? ''
  const fitAngle = ai?.fitAngle ?? ''
  return text
    .replace(/\{\{first_name\}\}/g, firstName)
    .replace(/\{\{firstName\}\}/g, firstName)
    .replace(/\{\{last_name\}\}/g, lastName)
    .replace(/\{\{lastName\}\}/g, lastName)
    .replace(/\{\{sender_name\}\}/g, senderName ?? '')
    .replace(/\{\{senderName\}\}/g, senderName ?? '')
    .replace(/\{\{role\}\}/g, role)
    .replace(/\{\{company\}\}/g, companyName)
    .replace(/\{\{company_name\}\}/g, companyName)
    .replace(/\{\{companyName\}\}/g, companyName)
    .replace(/\{\{feature_line\}\}/g, featureLine)
    .replace(/\{\{featureLine\}\}/g, featureLine)
    .replace(/\{\{fit_angle\}\}/g, fitAngle)
    .replace(/\{\{fitAngle\}\}/g, fitAngle)
}

export function buildSubjectLine(
  template: string | null,
  contact: { name: string | null; title?: string | null },
  senderName: string | null,
  company?: { name: string },
  ai?: { featureLine?: string | null; fitAngle?: string | null }
): string {
  return substituteVariables(template ?? DEFAULT_SUBJECT_TEMPLATE, contact, senderName, company, ai)
}

function buildTemplateSkeleton(input: TemplateDraftInput): string {
  return stripPlaceholders(substituteVariables(
    input.body,
    input.contact,
    input.senderName,
    input.company,
    { featureLine: input.featureLine ?? null, fitAngle: input.fitAngle ?? null },
  ))
}

function buildTemplatePrompt(input: TemplateDraftInput): string {
  const skeleton = buildTemplateSkeleton(input)
  const basePrompt = buildPrompt({
    kind: 'ai',
    contact: input.contact,
    company: input.company,
    subjectTemplate: input.subjectTemplate,
    senderName: input.senderName,
    interestHook: null,
    senderContext: input.senderContext,
    apiKey: input.apiKey,
    featureLine: input.featureLine ?? null,
    fitAngle: input.fitAngle ?? null,
  })

  return [
    basePrompt,
    '',
    'Template skeleton:',
    skeleton,
    '',
    'Use the template skeleton as the structure and intent, but personalize the wording with the contact, company, and sender context. Do not leave merge tags or bracketed placeholders in the output.',
  ].join('\n')
}

async function draftFromTemplate(input: TemplateDraftInput): Promise<EmailDraft> {
  const rawBody = await callClaude({
    apiKey: input.apiKey,
    model: GENERATION_MODEL,
    system: EMAIL_GENERATION_SYSTEM_PROMPT,
    userContent: buildTemplatePrompt(input),
    maxTokens: 1024,
  })

  const body = await humanizeEmailBody(rawBody, input.apiKey)
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

function stripPlaceholders(text: string): string {
  return text.replace(/\{\{[^}]+\}\}/g, '[Company]')
}

function buildPrompt(input: AiDraftInput): string {
  const styleGuidance = `Style: direct, concise, specific — 80–120 words.`

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

  const featureLine = input.kind === 'ai' ? input.featureLine ?? null : null
  const fitAngle = input.kind === 'ai' ? input.fitAngle ?? null : null

  const personalizationNote =
    featureLine || fitAngle
      ? [
          'Personalization (use these verbatim, do not paraphrase):',
          featureLine ? `- Feature to work on at the company: "${featureLine}". Reference it as the thing the sender wants to contribute to.` : null,
          fitAngle ? `- Resume angle: "${fitAngle}". Use it as the bridge connecting the sender to that feature.` : null,
        ]
          .filter(Boolean)
          .join('\n')
      : null

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
    personalizationNote,
    '',
    'Output only the email body — no subject line.',
  ]
    .filter(Boolean)
    .join('\n')
}

async function draftFromAi(input: AiDraftInput): Promise<EmailDraft> {
  const rawBody = await callClaude({
    apiKey: input.apiKey,
    model: GENERATION_MODEL,
    system: EMAIL_GENERATION_SYSTEM_PROMPT,
    userContent: buildPrompt(input),
    maxTokens: 1024,
  })

  const body = await humanizeEmailBody(rawBody, input.apiKey)
  const subject = buildSubjectLine(input.subjectTemplate, input.contact, input.senderName, input.company)

  return { subject, body }
}

// Dispatches on input.kind. Each branch is independently testable through this
// single entry point — see server/__tests__/generate-email.test.ts for examples
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
