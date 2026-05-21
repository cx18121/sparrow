import type { RoleFamily } from '../../../src/types/roleFamilies.js'

export interface EmailDraft {
  subject: string
  body: string
}

export interface DraftContact {
  name: string | null
  title: string | null
}

export interface DraftCompany {
  name: string
  description: string | null
  oneLiner: string | null
  stage: string | null
  industry: string | null
  isHiring: boolean
  // Bare hostname like "acme.ai" — used to scope web_search via allowed_domains
  // during fit-angle research. Null for custom contacts where we have no domain.
  domain?: string | null
}

// Fields shared across every draft kind. The subject is template-driven in all
// modes — AI never generates the subject line, only the body.
interface DraftBase {
  contact: DraftContact
  company: DraftCompany
  subjectTemplate: string | null
  senderName: string | null
}

// Personalization payload threaded into every non-fallback draft mode.
// Per ADR-0005 each role family populates its own pair: eng/product fills
// featureLine + fitAngle; gtm fills triggerLine + proofOfMotion; ops fills
// inflectionLine + systemBuilt. Only one role's pair is non-null per call,
// selected by targetRole upstream. Flat optional fields rather than a
// discriminated union — same YAGNI logic the ADR used to reject a
// generic {hook, pitch} type.
interface PersonalizationFields {
  // Engineering + product personalization
  featureLine?: string | null
  fitAngle?: string | null
  // GTM personalization
  triggerLine?: string | null
  proofOfMotion?: string | null
  // Operations personalization
  inflectionLine?: string | null
  systemBuilt?: string | null
}

// Template mode — the template body is a merge-tag skeleton. Variables are
// substituted first, then AI rewrites the body per recipient using company and
// sender context. The role-shaped personalization pair (feature/fit or
// trigger/proof) is woven into the AI rewrite — same semantics as AI mode.
export interface TemplateDraftInput extends DraftBase, PersonalizationFields {
  kind: 'template'
  body: string
  senderContext: string
  apiKey: string
  // Resolved role family for this campaign (per-campaign override, falling
  // back to workspace default). When set, the generation system prompt is
  // augmented with a one-line role-specific voice steer — see
  // server/lib/ai/prompts.ts:buildEmailGenerationSystemPrompt.
  targetRole?: RoleFamily | null
}

// AI mode — Anthropic generates the body from sender context, company info,
// and an optional interest hook plus the role-shaped personalization pair.
// All four personalization fields default to null when no pair is set, so
// the email drafts without personalization (e.g. custom contacts without
// a Company row, or interest-hook-supplied recipients that skip research).
export interface AiDraftInput extends DraftBase, PersonalizationFields {
  kind: 'ai'
  interestHook: string | null
  senderContext: string
  apiKey: string
  // See TemplateDraftInput.targetRole — same semantics.
  targetRole?: RoleFamily | null
}

// Verbatim mode — template body and subject are rendered exactly as
// authored, with merge tags (including the role-shaped pair) substituted
// from the AI research pass. No Claude rewrite is invoked, so the email
// goes out word-for-word as the template author wrote it. Used whenever
// Template.verbatim = true. Paragraphs anchored on empty AI-only tags are
// dropped before substitution so missing research does not leave broken
// grammar.
export interface VerbatimDraftInput extends DraftBase, PersonalizationFields {
  kind: 'verbatim'
  body: string
}

// Fallback mode — generic email used when AI generation fails. Reachable as
// a deliberate input choice, not just an exception recovery path.
export interface FallbackDraftInput extends DraftBase {
  kind: 'fallback'
}

export type DraftInput = TemplateDraftInput | AiDraftInput | VerbatimDraftInput | FallbackDraftInput
