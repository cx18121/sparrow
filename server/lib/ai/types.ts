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

// Template mode — the template body is a merge-tag skeleton. Variables are
// substituted first, then AI rewrites the body per recipient using company and
// sender context. featureLine/fitAngle are research outputs woven into the
// personalization pass — same semantics as AI mode.
export interface TemplateDraftInput extends DraftBase {
  kind: 'template'
  body: string
  senderContext: string
  apiKey: string
  featureLine?: string | null
  fitAngle?: string | null
}

// AI mode — Anthropic generates the body from sender context, company info,
// and an optional interest hook.
//
// featureLine: a specific company surface the sender wants to work on (output
// of researchFitAngle). fitAngle: the resume project that opens the
// conversation. Both null → email drafts without those personalization lines.
export interface AiDraftInput extends DraftBase {
  kind: 'ai'
  interestHook: string | null
  senderContext: string
  apiKey: string
  featureLine?: string | null
  fitAngle?: string | null
}

// Verbatim mode — template body and subject are rendered exactly as
// authored, with merge tags (including {{feature_line}} / {{fit_angle}})
// substituted from the AI research pass. No Claude rewrite is invoked,
// so the email goes out word-for-word as the template author wrote it.
// Used when Template.verbatim = true and either the template doesn't
// reference feature_line, or research produced one.
export interface VerbatimDraftInput extends DraftBase {
  kind: 'verbatim'
  body: string
  featureLine?: string | null
  fitAngle?: string | null
}

// Fallback mode — generic email used when AI generation fails. Reachable as
// a deliberate input choice, not just an exception recovery path.
export interface FallbackDraftInput extends DraftBase {
  kind: 'fallback'
}

export type DraftInput = TemplateDraftInput | AiDraftInput | VerbatimDraftInput | FallbackDraftInput
