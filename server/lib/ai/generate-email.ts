import { callClaude } from './anthropic.js'
import { humanizeEmailBody } from './humanize.js'
import {
  DEFAULT_SUBJECT_TEMPLATE,
  buildEmailGenerationSystemPrompt,
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
// Personalization fields a draft can carry, role-shaped per ADR-0005.
// eng/product fills feature/fit; gtm fills trigger/proof. Only one pair is
// non-null per draft, selected by the campaign's targetRole upstream.
interface AiPersonalization {
  featureLine?: string | null
  fitAngle?: string | null
  triggerLine?: string | null
  proofOfMotion?: string | null
}

export function substituteVariables(
  text: string,
  contact: { name: string | null; title?: string | null },
  senderName: string | null,
  company?: { name: string },
  ai?: AiPersonalization
): string {
  const firstName = contact.name?.split(' ')[0] ?? ''
  const lastName = contact.name?.split(' ').slice(1).join(' ') ?? ''
  const role = contact.title ?? ''
  const companyName = company?.name ?? ''
  const featureLine = ai?.featureLine ?? ''
  const fitAngle = ai?.fitAngle ?? ''
  const triggerLine = ai?.triggerLine ?? ''
  const proofOfMotion = ai?.proofOfMotion ?? ''
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
    .replace(/\{\{trigger_line\}\}/g, triggerLine)
    .replace(/\{\{triggerLine\}\}/g, triggerLine)
    .replace(/\{\{proof_of_motion\}\}/g, proofOfMotion)
    .replace(/\{\{proofOfMotion\}\}/g, proofOfMotion)
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
  ai?: AiPersonalization
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
  ai?: AiPersonalization
): string {
  const featureEmpty = !ai?.featureLine
  const fitEmpty = !ai?.fitAngle
  const triggerEmpty = !ai?.triggerLine
  const proofEmpty = !ai?.proofOfMotion
  if (!featureEmpty && !fitEmpty && !triggerEmpty && !proofEmpty) return body

  const shouldDrop = (chunk: string) => {
    if (featureEmpty && /\{\{(feature_line|featureLine)\}\}/.test(chunk)) return true
    if (fitEmpty && /\{\{(fit_angle|fitAngle)\}\}/.test(chunk)) return true
    if (triggerEmpty && /\{\{(trigger_line|triggerLine)\}\}/.test(chunk)) return true
    if (proofEmpty && /\{\{(proof_of_motion|proofOfMotion)\}\}/.test(chunk)) return true
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
  const ai: AiPersonalization = {
    featureLine: input.featureLine ?? null,
    fitAngle: input.fitAngle ?? null,
    triggerLine: input.triggerLine ?? null,
    proofOfMotion: input.proofOfMotion ?? null,
  }
  return stripPlaceholders(substituteVariables(
    dropEmptyTagParagraphs(input.body, ai),
    input.contact,
    input.senderName,
    input.company,
    ai,
  ))
}

// Template mode: the user's template already defines the structure. Do NOT
// reuse the AI-mode "Write a cold email with 1. Opening / 2. Bridge / 3. Ask"
// instruction here — that conflicted with the skeleton and Claude resolved
// the conflict by emitting just greeting + sign-off (observed in prod: a
// 5-paragraph template collapsed to "Hi <name>,\n\nBest,\n<sender>"). The
// skeleton is the contract; personalization is wording-only.
function buildTemplatePrompt(input: TemplateDraftInput, skeleton = buildTemplateSkeleton(input)): string {
  const companyContext = [
    input.company.oneLiner ?? input.company.description,
    input.company.stage,
    input.company.industry,
    input.company.isHiring ? 'currently hiring' : null,
  ]
    .filter(Boolean)
    .join('; ')

  // Per ADR-0005 only one role's pair is populated per draft. The note
  // labels each line for the role family that wrote it so the model
  // reads it in the right register.
  const personalizationLines = [
    input.featureLine ? `- Feature to reference: "${input.featureLine}"` : null,
    input.fitAngle ? `- Resume angle: "${input.fitAngle}"` : null,
    input.triggerLine ? `- Recent company trigger: "${input.triggerLine}"` : null,
    input.proofOfMotion ? `- Candidate proof of motion: "${input.proofOfMotion}"` : null,
  ].filter(Boolean)
  const personalizationNote =
    personalizationLines.length > 0
      ? ['Personalization (use verbatim, do not paraphrase):', ...personalizationLines].join('\n')
      : null

  return [
    'Rewrite this email template, personalizing the wording for the recipient. Do not add, remove, or merge paragraphs — preserve the skeleton structure exactly.',
    '',
    `Contact: ${input.contact.name ?? 'there'}${input.contact.title ? `, ${input.contact.title}` : ''}${input.company.name ? ` at ${input.company.name}` : ''}`,
    companyContext ? `Company: ${companyContext}` : null,
    `Sender: ${input.senderContext}`,
    personalizationNote,
    '',
    'Rules:',
    '- Preserve every paragraph, bullet, and the greeting and sign-off. Same number of paragraphs in, same number out.',
    '- Personalize wording only where it sharpens specificity. Keep length similar to the skeleton.',
    '- Do not leave merge tags or bracketed placeholders ([Company], {{...}}) in the output.',
    '- Separate paragraphs with one blank line. Output ONLY the rewritten body — no subject, no preamble.',
    '',
    'Template skeleton:',
    skeleton,
  ]
    .filter(Boolean)
    .join('\n')
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function templateParagraphs(skeleton: string): string[] {
  if (/<p\b/i.test(skeleton)) {
    const paragraphs = [...skeleton.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)]
      .map(match => htmlToPlainText(match[0]))
      .filter(Boolean)
    if (paragraphs.length > 0) return paragraphs
  }

  return htmlToPlainText(skeleton)
    .split(/\n\s*\n/)
    .map(para => para.trim())
    .filter(Boolean)
}

function signoffLine(line: string): boolean {
  return /^(best|thanks|thank you|regards|sincerely|cheers),?$/i.test(line.trim())
}

function restoreTemplateParagraphSpacing(body: string, skeleton: string): string {
  const trimmed = body.trim()
  if (!trimmed || /\n\s*\n/.test(trimmed)) return trimmed

  const paragraphs = templateParagraphs(skeleton)
  if (paragraphs.length < 2) return trimmed

  const lines = trimmed
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
  if (lines.length < 2) return trimmed

  const lastTemplateParagraph = paragraphs[paragraphs.length - 1] ?? ''
  const shouldMergeSignoff =
    lines.length === paragraphs.length + 1 &&
    signoffLine(lines[lines.length - 2] ?? '') &&
    (lastTemplateParagraph.includes('\n') || signoffLine(lastTemplateParagraph.split('\n')[0] ?? ''))

  const blocks = shouldMergeSignoff
    ? [...lines.slice(0, -2), `${lines[lines.length - 2]}\n${lines[lines.length - 1]}`]
    : lines

  return blocks.length === paragraphs.length ? blocks.join('\n\n') : trimmed
}

async function draftFromTemplate(input: TemplateDraftInput): Promise<EmailDraft> {
  const skeleton = buildTemplateSkeleton(input)
  const rawBody = await callClaude({
    apiKey: input.apiKey,
    model: GENERATION_MODEL,
    system: buildEmailGenerationSystemPrompt(input.targetRole ?? null),
    userContent: buildTemplatePrompt(input, skeleton),
    maxTokens: 1024,
  })

  const humanized = await humanizeEmailBody(rawBody, input.apiKey)
  const body = restoreTemplateParagraphSpacing(humanized, skeleton)
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
  const ai: AiPersonalization = {
    featureLine: input.featureLine ?? null,
    fitAngle: input.fitAngle ?? null,
    triggerLine: input.triggerLine ?? null,
    proofOfMotion: input.proofOfMotion ?? null,
  }
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

  // Per ADR-0005, AI mode receives the role-shaped personalization pair:
  // eng/product → feature/fit; gtm → trigger/proof. Only one pair is
  // populated per call. The labels here are role-specific so the model
  // weaves each into the body in the right register — "Feature to work
  // on" reads as eng intent; "Trigger" + "Proof of motion" reads as GTM.
  const personalizationLines = [
    input.featureLine
      ? `- Feature to work on at the company: "${input.featureLine}". Reference it as the thing the sender wants to contribute to.`
      : null,
    input.fitAngle
      ? `- Resume angle: "${input.fitAngle}". Use it as the bridge connecting the sender to that feature.`
      : null,
    input.triggerLine
      ? `- Recent company trigger: "${input.triggerLine}". Lead the opener with this as the why-now signal.`
      : null,
    input.proofOfMotion
      ? `- Candidate proof of motion: "${input.proofOfMotion}". Use it as the credibility bridge — what the sender has done that maps to this trigger.`
      : null,
  ].filter(Boolean)
  const personalizationNote =
    personalizationLines.length > 0
      ? ['Personalization (use these verbatim, do not paraphrase):', ...personalizationLines].join('\n')
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
    system: buildEmailGenerationSystemPrompt(input.targetRole ?? null),
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
