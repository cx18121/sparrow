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
}

// Fields shared across every draft kind. The subject is template-driven in all
// modes — AI never generates the subject line, only the body.
interface DraftBase {
  contact: DraftContact
  company: DraftCompany
  subjectTemplate: string | null
  senderName: string | null
}

// Verbatim mode — the template body is delivered as-is with {{variable}}
// substitution only. ADR-0002: AI must not rewrite a user-authored Template.
export interface TemplateDraftInput extends DraftBase {
  kind: 'template'
  body: string
}

// AI mode — Anthropic generates the body from sender context, company info,
// and an optional interest hook. styleInstruction tunes voice.
export interface AiDraftInput extends DraftBase {
  kind: 'ai'
  interestHook: string | null
  senderContext: string
  styleInstruction?: string | null
  exampleBodies?: string[] | null
  apiKey: string
}

// Fallback mode — generic email used when AI generation fails. Reachable as
// a deliberate input choice, not just an exception recovery path.
export interface FallbackDraftInput extends DraftBase {
  kind: 'fallback'
}

export type DraftInput = TemplateDraftInput | AiDraftInput | FallbackDraftInput
