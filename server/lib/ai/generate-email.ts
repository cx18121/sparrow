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
  VerbatimDraftInput,
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

// Strip dangling separators and whitespace left behind when a merge tag
// substitutes to empty. Without this, a profile with no senderName turns
// the default subject 'Quick intro — {{senderName}}' into 'Quick intro — ',
// which lands in the inbox looking truncated. Runs at the tail until stable
// to handle compounded cases like 'Foo — , '.
function tidySubject(subject: string): string {
  let prev = subject
  let next = subject
  do {
    prev = next
    next = next.trim().replace(/[\s\-–—:,|·]+$/u, '').trim()
  } while (next !== prev)
  return next
}

export function buildSubjectLine(
  template: string | null,
  contact: { name: string | null; title?: string | null },
  senderName: string | null,
  company?: { name: string },
  ai?: { featureLine?: string | null; fitAngle?: string | null }
): string {
  return tidySubject(substituteVariables(template ?? DEFAULT_SUBJECT_TEMPLATE, contact, senderName, company, ai))
}

// When pickFitAngle returns NONE (or feature research came up empty), the
// merge tag substitutes to an empty string and leaves the surrounding
// sentence orphaned ("For context,  feels like a natural stepping
// stone..."). The AI rewrite then "repairs" the broken sentence by
// inventing a generic placeholder ("my recent project"). To prevent that,
// drop entire paragraphs whose only specific content was the now-empty
// merge tag — better to ship a shorter email than a hallucinated one.
function dropEmptyTagParagraphs(
  body: string,
  ai?: { featureLine?: string | null; fitAngle?: string | null }
): string {
  const featureEmpty = !ai?.featureLine
  const fitEmpty = !ai?.fitAngle
  if (!featureEmpty && !fitEmpty) return body

  const shouldDrop = (chunk: string) => {
    if (featureEmpty && /\{\{(feature_line|featureLine)\}\}/.test(chunk)) return true
    if (fitEmpty && /\{\{(fit_angle|fitAngle)\}\}/.test(chunk)) return true
    return false
  }

  // Templates from the RichEditor are stored as HTML (e.g. "<p>...</p><p>...</p>")
  // with no \n\n separators. Splitting only on blank lines would treat the whole
  // body as one paragraph and drop everything when any tag is empty. Detect
  // HTML and remove individual <p> blocks instead.
  if (/<p\b/i.test(body)) {
    return body
      .replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi, paragraph => (shouldDrop(paragraph) ? '' : paragraph))
      .replace(/(\s*<br\s*\/?>\s*){2,}/gi, '<br />')
      .trim()
  }

  return body
    .split(/\n\s*\n/)
    .filter(para => !shouldDrop(para))
    .join('\n\n')
}

function buildTemplateSkeleton(input: TemplateDraftInput): string {
  const ai = { featureLine: input.featureLine ?? null, fitAngle: input.fitAngle ?? null }
  return stripPlaceholders(substituteVariables(
    dropEmptyTagParagraphs(input.body, ai),
    input.contact,
    input.senderName,
    input.company,
    ai,
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

function draftVerbatim(input: VerbatimDraftInput): EmailDraft {
  // Verbatim mode is the user's explicit "send my template as-is" opt-out
  // from AI editing. We may drop paragraphs anchored on missing AI-only tags
  // before substitution so verbatim templates stay authored by the user
  // without shipping orphaned grammar when research has no grounded hook.
  const ai = { featureLine: input.featureLine ?? null, fitAngle: input.fitAngle ?? null }
  const subject = buildSubjectLine(input.subjectTemplate, input.contact, input.senderName, input.company, ai)
  const body = substituteVariables(dropEmptyTagParagraphs(input.body, ai), input.contact, input.senderName, input.company, ai)
  return { subject, body }
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
    case 'verbatim':
      return draftVerbatim(input)
    case 'fallback':
      return draftFallback(input)
    case 'ai':
      return draftFromAi(input)
  }
}

export type { DraftCompany, DraftContact, DraftInput, EmailDraft }
