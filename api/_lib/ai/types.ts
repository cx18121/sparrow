export interface EmailDraft {
  subject: string
  body: string
}

export interface GenerateEmailParams {
  contact: {
    name: string | null
    title: string | null
  }
  company: {
    name: string
    description: string | null
    oneLiner: string | null
    stage: string | null
    industry: string | null
    isHiring: boolean
  }
  interestHook: string | null
  userTemplate: string | null
  senderContext: string
  styleInstruction?: string | null
  subjectTemplate: string | null
  senderName: string | null
  apiKey: string
}
